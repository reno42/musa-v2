// REQ-027 — flows-runtime: orquestación de ejecución compartida por las tools
// flow_* (mcp.mjs) y el trigger de webhook (/api/flows/webhook/:flowId/:secret
// en api/src/index.ts). Aquí vive SOLO pegamento: storage + executeFlow +
// idempotencia por requestId + cap de concurrencia + reconcile de runs muertos
// + cifrado de credenciales. El engine puro vive en flows-core.mjs; la
// red/fuentes en flows-sources.mjs.
//
// callTool es INYECTADO por el host:
// - mcp.mjs y api/index.ts pasan un bridge al MISMO dispatcher (handleMethod)
//   que usa cualquier IA vía /mcp — MCP-first: una sola implementación del
//   producto, cero drift entre lo que hace la IA, la UI y un flow.
// - En tests, un stub.

import crypto from "node:crypto";
import { createFlowsStore, executeFlow, LIMITS, flowError, cryptoRandom12 } from "./flows-core.mjs";
import { decrypt } from "./keys.mjs";

export const flowsBaseUrl = () => String(process.env.URL || "https://design.futuraria.com").replace(/\/$/, "");

/** Kill switch de emergencia: FLOWS_DISABLED=true apaga el builder completo
 *  (tools + webhook) sin deploy. */
export function flowsDisabled() {
  return process.env.FLOWS_DISABLED === "true";
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function newWebhookSecret() {
  return crypto.randomBytes(LIMITS.webhookSecretBytes).toString("hex");
}

/** URL del webhook de un flow. En DB vive SOLO el sha256 del secreto, así que
 *  la URL cruda solo puede construirse al crearla o rotarla — el parámetro es
 *  obligatorio y las tools la muestran exactamente una vez. */
export function flowWebhookUrl(flow, rawSecret) {
  if (!rawSecret) throw flowError("CONFIG", "La URL del webhook solo puede construirse con el secreto recién generado (creación o rotación).");
  return `${flowsBaseUrl()}/api/flows/webhook/${flow.id}/${rawSecret}`;
}

function timingSafeHexEqual(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/** ¿Esta llamada de webhook corresponde al flow? El secreto ES la credencial
 *  (mismo modelo que el dispatch interno de webhooks de la plataforma). El
 *  tenant no se adivina: el flow se carga por id y su propio workspace_id. */
export function webhookTriggerMatches(flow, rawSecret) {
  if (!flow || flow.trigger?.type !== "webhook") {
    return { ok: false, status: 404, code: "FLOW_NOT_WEBHOOK", message: "Flow no encontrado o sin trigger webhook." };
  }
  if (!timingSafeHexEqual(sha256Hex(rawSecret), flow.trigger.secretHash)) {
    return { ok: false, status: 401, code: "BAD_WEBHOOK_SECRET", message: "Secreto de webhook inválido (la URL anterior quedó muerta; rota con flow_webhook_rotate)." };
  }
  return { ok: true };
}

export function createFlowRuntime({ sb, callTool, resolveTemplateWorkspace, resolveDns } = {}) {
  const store = createFlowsStore(sb);
  // Default seguro: null = workspace del template desconocido. El chequeo
  // cross-workspace del nodo template solo se aplica cuando hay resolver
  // (mcp.mjs); en el webhook el templateId viene del flow ya acotado por
  // tenant, no del input del caller — null no abre ningún hueco.
  const resolveTemplateWorkspaceSafe = resolveTemplateWorkspace ?? (async () => null);

  // Las tools de credenciales devuelven metadata sin secreto; este mapper SÍ
  // descifra (executeFlow necesita firmar requests) y jamás se expone fuera
  // del engine.
  async function getCredentialDecrypted(workspaceId, id) {
    const row = await store.getCredential(id, workspaceId);
    if (!row) return null;
    let secret = "";
    try { secret = decrypt(row.secret_crypted) || ""; } catch { secret = ""; }
    return { ...row, secret };
  }

  /** Ejecuta un flow UNA vez con todas las garantías de estabilidad:
   *  1. reconciliación perezosa de runs "running" muertos (timeout del Worker),
   *  2. idempotencia: mismo (flowId, requestId) → el run original,
   *  3. rate cap por flow (240/h — un webhook en loop no quema el free tier),
   *  4. cap de concurrencia por workspace (máx N runs vivos),
   *  5. persistencia del run ANTES de ejecutar (crash-safe) y al terminar,
   *  6. prune best-effort del historial.
   *  Lanza flowError con códigos estables (CONCURRENCY_LIMIT, FLOW_RATE_LIMITED, DISABLED, ...). */
  async function runFlow(flow, { input, requestId } = {}) {
    if (flowsDisabled()) throw flowError("DISABLED", "Flows está deshabilitado en este entorno (FLOWS_DISABLED=true).");
    const workspaceId = flow.workspace_id;
    await store.reconcileStaleRuns(workspaceId);

    if (requestId) {
      const existing = await store.findRunByRequestId(flow.id, requestId);
      if (existing) {
        return { runId: existing.id, status: existing.status, steps: existing.steps ?? [], error: existing.error, outputs: {}, idempotent: true };
      }
    }

    // Rate cap por flow (freemium): los reintentos idempotentes ya volvieron
    // arriba, esto frena runs NUEVOS en loop.
    const recent = await store.countRunsSince(flow.id, new Date(Date.now() - 3_600_000).toISOString());
    if (recent >= LIMITS.runsPerFlowPerHour) {
      throw flowError("FLOW_RATE_LIMITED", `El flow superó ${LIMITS.runsPerFlowPerHour} runs en la última hora (protección freemium). Revisa triggers/reintentos y consulta flow_history.`);
    }

    const running = await store.countRunningRuns(workspaceId);
    if (running >= LIMITS.maxRunningPerWorkspace) {
      throw flowError("CONCURRENCY_LIMIT", `El workspace ya tiene ${running} runs en marcha (límite ${LIMITS.maxRunningPerWorkspace}). Espera a que terminen (flow_history) y reintenta.`);
    }

    const run = await store.insertRun({
      id: `run_${cryptoRandom12()}`,
      flow_id: flow.id,
      workspace_id: workspaceId,
      status: "running",
      input: input ?? null,
      request_id: requestId ?? null,
      started_at: new Date().toISOString(),
    });

    const finish = (patch) => store.updateRun(run.id, { finished_at: new Date().toISOString(), ...patch }).catch(() => {});

    try {
      const result = await executeFlow(flow, input ?? {}, {
        callTool,
        getCredential: getCredentialDecrypted,
        resolveTemplateWorkspace: resolveTemplateWorkspaceSafe,
        resolveDns,
        workspaceId,
        deadline: Date.now() + LIMITS.runTimeoutMs,
      });
      await finish({ status: result.status, steps: result.steps, error: result.error });
      store.pruneRuns(flow.id).catch(() => {});
      return { runId: run.id, status: result.status, steps: result.steps, error: result.error, outputs: result.outputs ?? {}, idempotent: false };
    } catch (error) {
      // Crash del runtime (no confundir con fallo de un nodo: eso executeFlow
      // lo captura por nodo y devuelve status:"failed").
      await finish({ status: "failed", steps: [], error: `${error?.flowCode ?? "RUN_ERROR"}: ${String(error?.message ?? error).slice(0, 1_000)}` });
      throw error;
    }
  }

  return { store, runFlow, getCredentialDecrypted };
}

// NOTA (decisión de producto): NO existe scheduler server-side. El trigger
// schedule es declarativo: la IA del usuario consulta flow_due_check desde
// su propio loop y llama flow_run con requestId "cron:<flowId>:<slot>" —
// el server solo ejecuta cuando le llaman.
