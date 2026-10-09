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
import { createFlowsStore, executeFlow, resumeFlow, LIMITS, flowError, cryptoRandom12 } from "./flows-core.mjs";
import { guardedFetch, readLimited } from "./flows-sources.mjs";
// REQ-040 — wake: webhook saliente cuando el run queda waiting (push, no pull).
import { scheduleFlowWake } from "./flows-wake.mjs";
import { decrypt, encrypt } from "./keys.mjs";

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

// F6 — OAuth2 (apps propias del usuario): state del consentimiento. Se cifra
// con la MISMA llave AES-256-GCM que las credenciales y expira en 10 min.
// El callback público solo acepta state válido: es la ÚNICA llave que toca
// esa credencial y ata la conexión al workspace correcto.
export function oauth2StateEncode(payload) {
  return encrypt(JSON.stringify({ ...payload, k: "oauth2", exp: Date.now() + 600_000 }));
}
export function oauth2StateDecode(state) {
  let payload = null;
  try {
    const parsed = JSON.parse(decrypt(String(state ?? "")) || "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed;
  } catch { payload = null; }
  if (!payload || payload.k !== "oauth2" || !Number(payload.exp) || Date.now() > Number(payload.exp)) return null;
  return payload;
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

  // F6 — resuelve el access_token de una credencial oauth2 para executeHttp.
  // Usa el refresh_token guardado cifrado; refresca con margen de 60s y
  // persiste el token nuevo (fail-open: si la persistencia falla, el run
  // igual usa el token fresco en memoria).
  async function getOAuth2AccessToken(credential, { forceRefresh = false } = {}) {
    const cfg = credential.oauth_config && typeof credential.oauth_config === "object" && !Array.isArray(credential.oauth_config) ? credential.oauth_config : {};
    const tokenUrl = String(cfg.tokenUrl ?? "").trim();
    const clientId = String(cfg.clientId ?? "").trim();
    const clientSecret = String(credential.secret ?? "");
    if (!tokenUrl || !clientId || !clientSecret) {
      throw flowError("CREDENTIAL_MISSING", `La credencial OAuth2 "${credential.name}" está incompleta (clientId/client_secret/tokenUrl); vuélvela a guardar con flow_credentials_set type:"oauth2".`);
    }
    let tokens = null;
    if (credential.oauth_tokens) {
      try {
        const parsed = JSON.parse(decrypt(String(credential.oauth_tokens)) || "");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) tokens = parsed;
      } catch { tokens = null; }
    }
    if (!forceRefresh && tokens?.access_token && Number(tokens.expires_at) > Date.now() + 60_000) return String(tokens.access_token);
    if (!tokens?.refresh_token) {
      throw flowError("OAUTH2_NOT_CONNECTED", `La credencial OAuth2 "${credential.name}" no tiene refresh_token: abre la authUrl de flow_oauth2_connect y completa el consentimiento del proveedor.`);
    }
    const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(tokens.refresh_token), client_id: clientId, client_secret: clientSecret });
    if (cfg.scope) form.set("scope", String(cfg.scope));
    const res = await guardedFetch(tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form.toString() }, { timeoutMs: 10_000 });
    const raw = await readLimited(res);
    if (!res.ok) throw flowError("OAUTH2_REFRESH", `El proveedor rechazó el refresh de "${credential.name}" (HTTP ${res.status}); reautoriza con flow_oauth2_connect.`);
    let payload = null;
    try { payload = JSON.parse(raw); } catch { payload = null; }
    if (!payload || typeof payload !== "object" || !payload.access_token) {
      throw flowError("OAUTH2_REFRESH", `El token endpoint de "${credential.name}" no devolvió access_token.`);
    }
    const merged = { ...tokens, access_token: String(payload.access_token), expires_at: Date.now() + (Number(payload.expires_in) > 0 ? Number(payload.expires_in) * 1000 : 3_600_000) };
    if (payload.refresh_token) merged.refresh_token = String(payload.refresh_token);
    try { await store.updateCredentialTokens(credential.id, encrypt(JSON.stringify(merged))); } catch { /* fail-open: el token fresco queda en memoria */ }
    return merged.access_token;
  }

  /** Ejecuta un flow UNA vez con todas las garantías de estabilidad:
   *  1. reconciliación perezosa de runs "running" muertos (timeout del Worker),
   *  2. idempotencia: mismo (flowId, requestId) → el run original,
   *  3. rate cap por flow (240/h — un webhook en loop no quema el free tier),
   *  4. cap de concurrencia por workspace (máx N runs vivos),
   *  5. persistencia del run ANTES de ejecutar (crash-safe) y al terminar,
   *  6. prune best-effort del historial.
   *  Lanza flowError con códigos estables (CONCURRENCY_LIMIT, FLOW_RATE_LIMITED, DISABLED, ...). */
  /** @param {{ input?: unknown, requestId?: string | null, waitUntil?: ((p: Promise<unknown>) => void) | null }} opts */
  async function runFlow(flow, { input, requestId, waitUntil } = {}) {
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

    // REQ-042 (feedback en vivo): executeFlow acepta onStep por nodo; el runtime
    // lo usa para persistir steps INCREMENTALMENTE (un updateRun chico por nodo,
    // ≤25/run). flow_history los expone al vuelo y el canvas pinta verde/check/
    // rojo/X en tiempo real. Solo gasta MIENTRAS ejecuta — cero cron (freemium).
    const liveSteps = [];
    const onStep = (step) => {
      liveSteps.push(step);
      return store.updateRun(run.id, { steps: [...liveSteps] }).catch(() => {});
    };
    try {
      const result = await executeFlow(flow, input ?? {}, {
        callTool,
        getCredential: getCredentialDecrypted,
        resolveTemplateWorkspace: resolveTemplateWorkspaceSafe,
        resolveDns,
        oauth2Token: getOAuth2AccessToken,
        workspaceId,
        deadline: Date.now() + LIMITS.runTimeoutMs,
        onStep,
      });
      if (result.status === "waiting") {
        // Plan B5: el run QUEDA en espera — persiste token+estado (columnas
        // v64: resume_token/pending_state). Sin la migración, se marca fallado
        // con mensaje accionable en vez de perder el estado en silencio.
        const wait = result.wait;
        let persisted = true;
        try {
          await store.updateRun(run.id, { status: "waiting", steps: result.steps, error: null, resume_token: wait.resumeToken, pending_state: wait.state });
        } catch {
          persisted = false;
        }
        if (!persisted) {
          const msg = "WAIT_STATE: la DB no tiene las columnas de espera (aplica supabase_migrations_v64.sql); el run no puede pausarse.";
          await finish({ status: "failed", error: msg });
          return { runId: run.id, status: "failed", steps: result.steps, error: msg, outputs: result.outputs ?? {}, idempotent: false };
        }
        store.pruneRuns(flow.id).catch(() => {});
        // REQ-040: run YA persistido en waiting → dispara el wake. Fire-and-
        // forget: scheduleFlowWake retorna YA, jamás lanza y jamás bloquea ni
        // falla el run; sin config en el workspace es no-op (cero regresión).
        scheduleFlowWake({ sb, flow, runId: run.id, wait, workspaceId, waitUntil });
        return { runId: run.id, status: "waiting", steps: result.steps, error: null, wait: { nodeId: wait.nodeId, kind: wait.kind, message: wait.message, ...(wait.title ? { title: wait.title } : {}), resumeToken: wait.resumeToken, expiresAt: wait.expiresAt }, outputs: result.outputs ?? {}, idempotent: false };
      }
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

  /** Plan B5: continúa un run pausado (wait_webhook/approval) con el payload
   *  del webhook o la decisión humana. MISMO runId: el historial queda en una
   *  sola ejecución. Valida token/status/expiración antes de reanudar. */
  /** @param {{ resumeToken: string, payload?: unknown, waitUntil?: ((p: Promise<unknown>) => void) | null }} opts */
  async function resumeFlowRun(flow, { resumeToken, payload, waitUntil } = {}) {
    if (flowsDisabled()) throw flowError("DISABLED", "Flows está deshabilitado en este entorno (FLOWS_DISABLED=true).");
    const workspaceId = flow.workspace_id;
    const token = String(resumeToken ?? "").trim();
    if (!token) throw flowError("VALIDATION", "resumeToken es requerido (lo devuelve flow_run cuando status es waiting).");
    const run = await store.findRunByResumeToken(token, workspaceId);
    if (!run) throw flowError("RESUME_NOT_FOUND", "No hay run en espera con ese resumeToken en este workspace (flow_history para ver los runs).");
    if (run.status !== "waiting") throw flowError("RESUME_INVALID", `El run ${run.id} ya no está en espera (status: ${run.status}).`);
    const state = run.pending_state && typeof run.pending_state === "object" ? run.pending_state : null;
    if (!state?.waitingNodeId) throw flowError("RESUME_INVALID", "El run guardado no tiene estado de espera válido (¿migración v64 aplicada a medias?).");
    if (state.expiresAt && Date.now() > Date.parse(state.expiresAt)) {
      await store.updateRun(run.id, { status: "failed", error: "WAIT_EXPIRED: la espera expiró antes de recibir flow_resume.", finished_at: new Date().toISOString(), resume_token: null });
      throw flowError("WAIT_EXPIRED", `La espera del run ${run.id} expiró a las ${state.expiresAt}. Vuelve a lanzar el flow con flow_run.`);
    }
    // REQ-042 B (requiredKeys): un ai_task puede declarar las claves que SU
    // payload debe traer (p. ej. ["copys"]). Si la IA cliente entrega algo
    // vacío o incompleto, el run SIGUE esperando con el MISMO token — la fila
    // no se toca (cero escrituras, cero wake): el agente corrige y reintenta.
    // Explícito > continuar el flow con una salida vacía.
    if (state.kind === "ai") {
      const pendingNode = Array.isArray(flow.nodes) ? flow.nodes.find((n) => n?.id === state.waitingNodeId) : null;
      const requiredKeys = Array.isArray(pendingNode?.config?.requiredKeys) ? pendingNode.config.requiredKeys.filter((k) => typeof k === "string" && k.trim()) : null;
      if (requiredKeys?.length) {
        const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
        const missing = requiredKeys.filter((key) => {
          const value = source[key];
          return value == null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length);
        });
        if (missing.length) {
          return {
            runId: run.id, status: "waiting", steps: Array.isArray(run.steps) ? run.steps : [], error: null,
            payloadRejected: true, missingKeys: missing,
            wait: { nodeId: state.waitingNodeId, kind: "ai", ...(state.message ? { message: state.message } : {}), ...(state.title ? { title: state.title } : {}), resumeToken: token, expiresAt: state.expiresAt ?? null },
            outputs: {}, idempotent: false,
          };
        }
      }
    }
    // Finalizador del run REANUDADO (mismo patrón que runFlow): marca finished_at
    // y limpia resume_token/pending_state al cerrar (éxito o crash).
    const finish = (patch) => store.updateRun(run.id, { finished_at: new Date().toISOString(), ...patch }).catch(() => {});
    // Feedback en vivo también al REANUDAR: mismos steps incrementales por nodo.
    const liveSteps = Array.isArray(run.steps) ? [...run.steps] : [];
    const onStep = (step) => {
      liveSteps.push(step);
      return store.updateRun(run.id, { steps: [...liveSteps] }).catch(() => {});
    };
    await store.updateRun(run.id, { status: "running", error: null });
    try {
      const result = await resumeFlow(flow, { state, payload: payload ?? {}, expiresAt: state.expiresAt ?? null }, {
        callTool,
        getCredential: getCredentialDecrypted,
        resolveTemplateWorkspace: resolveTemplateWorkspaceSafe,
        resolveDns,
        oauth2Token: getOAuth2AccessToken,
        workspaceId,
        deadline: Date.now() + LIMITS.runTimeoutMs,
        onStep,
      });
      if (result.status === "waiting") {
        // El run volvió a pausar (otro nodo de espera tras reanudar): persiste
        // el NUEVO token+estado — mismo patrón que el branch waiting de runFlow.
        const wait = result.wait;
        let persisted = true;
        try {
          await store.updateRun(run.id, { status: "waiting", steps: result.steps, error: null, resume_token: wait.resumeToken, pending_state: wait.state });
        } catch {
          persisted = false;
        }
        if (!persisted) {
          const msg = "WAIT_STATE: la DB no tiene las columnas de espera (aplica supabase_migrations_v64.sql); el run no puede pausarse.";
          await finish({ status: "failed", error: msg });
          return { runId: run.id, status: "failed", steps: result.steps, error: msg, outputs: result.outputs ?? {}, idempotent: false };
        }
        store.pruneRuns(flow.id).catch(() => {});
        // REQ-040: run YA persistido en waiting → dispara el wake. Fire-and-
        // forget: scheduleFlowWake retorna YA, jamás lanza y jamás bloquea ni
        // falla el run; sin config en el workspace es no-op (cero regresión).
        scheduleFlowWake({ sb, flow, runId: run.id, wait, workspaceId, waitUntil });
        return { runId: run.id, status: "waiting", steps: result.steps, error: null, wait: { nodeId: wait.nodeId, kind: wait.kind, message: wait.message, ...(wait.title ? { title: wait.title } : {}), resumeToken: wait.resumeToken, expiresAt: wait.expiresAt }, outputs: result.outputs ?? {}, idempotent: false };
      }
      // Terminal: el resume_token queda en la fila (post-mortem en flow_history);
      // el gate status !== "waiting" de arriba es lo que impide un doble resume.
      await finish({ status: result.status, steps: result.steps, error: result.error });
      store.pruneRuns(flow.id).catch(() => {});
      return { runId: run.id, status: result.status, steps: result.steps, error: result.error, outputs: result.outputs ?? {}, idempotent: false };
    } catch (error) {
      await finish({ status: "failed", steps: run.steps ?? [], error: `${error?.flowCode ?? "RUN_ERROR"}: ${String(error?.message ?? error).slice(0, 1_000)}` });
      throw error;
    }
  }

  return { store, runFlow, resumeFlowRun, getCredentialDecrypted, getOAuth2AccessToken };
}

// NOTA (decisión de producto): NO existe scheduler server-side. El trigger
// schedule es declarativo: la IA del usuario consulta flow_due_check desde
// su propio loop y llama flow_run con requestId "cron:<flowId>:<slot>" —
// el server solo ejecuta cuando le llaman.
