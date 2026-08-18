// ═══════════════════════════════════════════════════════════════
// musa-batch-core.mjs — Musa batch v2 pipeline
// ═══════════════════════════════════════════════════════════════
//
// The design_kanban_tasks board is the SINGLE source of truth.
// The daily batch advances every enabled card by role, one step
// per run, until it reaches `done`:
//
//   backlog/research/draft → leader step   → design
//   design                 → implementer   → review
//   review                 → reviewer      → done | feedback
//   feedback / done        → never touched
//
// Shared by:
//   - musa-batch.mjs (Netlify scheduled function, background ~15 min)
//   - mcp.mjs process_daily_batch (manual trigger / dryRun testing)
//
// LLM keys are resolved per-user via BYOK (getUserKey) with a
// global BATCH_LLM_KEY fallback for workspaces without a valid owner.
// ═══════════════════════════════════════════════════════════════

import { getSupabaseAdmin } from "../../api/src/services/supabase.js";
import * as templates from "../../api/src/services/templates.js";
import { getUserKey } from "./keys.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Provider-default models — resolved in resolveBatchKey so every step
// (leader, implementer, reviewer) always receives a valid model string.
// user_api_keys.model can be null/empty, which used to produce
// "LLM 400: model: invalid type: null, expected a string".
const DEFAULT_MODELS = {
  deepseek: "deepseek-chat",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
};

const PROVIDER_ENDPOINTS = {
  deepseek: "https://api.deepseek.com/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

// Statuses the batch is allowed to advance. feedback = human, done = final.
const PROCESSABLE_STATUSES = ["backlog", "research", "draft", "design", "review"];

// Cards updated by a human in the last N ms are skipped (hands-off guard).
// Hourly-cron safety: each run advances a card ONE step and every status
// write carries a .eq("status", <fetched status>) guard, so overlapping
// runs (hourly cron + manual trigger) can never double-process a card nor
// yank one that another run already advanced. The hands-off guard on top
// protects cards a human just edited.
const HANDS_OFF_MS = 2 * 60_000;

// ─────────────────────────────────────────────────────────────
// LLM helpers
// ─────────────────────────────────────────────────────────────

/**
 * Single-shot LLM call (no tool loop). Returns raw text content.
 * Used by the leader and reviewer steps.
 */
async function runLLMStep({ system, user, llmKey, provider, model, maxTokens = 2048 }) {
  const endpoint = PROVIDER_ENDPOINTS[provider] || PROVIDER_ENDPOINTS.deepseek;
  if (provider === "anthropic") {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": llmKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model, max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!resp.ok) throw new Error(`LLM ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const data = await resp.json();
    return data.content?.map(b => b.text || "").join("") || "";
  }
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${llmKey}`,
    },
    body: JSON.stringify({
      model, max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`LLM ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

/** Extract a JSON object from an LLM reply (tolerates fences/prose). */
function parseLlmJson(text) {
  const cleaned = String(text || "").replace(/```json/gi, "").replace(/```/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Design action builder (card → executeDesignCreation contract)
// ─────────────────────────────────────────────────────────────

/** Canvas size per card type/format, with sensible defaults. */
function canvasForCard(card) {
  const format = (card.format || "").toLowerCase();
  const type = card.type || "post";
  if (format.includes("story") || format.includes("9:16")) return { width: 1080, height: 1920 };
  if (format.includes("banner") || format.includes("1200x627")) return { width: 1200, height: 627 };
  if (format.includes("landing") || format.includes("page")) return { width: 1440, height: 2000 };
  if (format.includes("square") || format.includes("post")) return { width: 1080, height: 1080 };
  const dims = format.match(/(\d{3,4})x(\d{3,4})/);
  if (dims) return { width: parseInt(dims[1], 10), height: parseInt(dims[2], 10) };
  switch (type) {
    case "banner": return { width: 1200, height: 627 };
    case "deck": return { width: 1920, height: 1080 };
    case "story": return { width: 1080, height: 1920 };
    case "landing": return { width: 1440, height: 2000 };
    default: return { width: 1080, height: 1080 };
  }
}

function buildDesignActionFromCard(card) {
  const { width, height } = canvasForCard(card);
  const parts = [];
  if (card.title) parts.push(`Título: ${card.title}`);
  if (card.brief) parts.push(`Brief: ${card.brief}`);
  if (card.copy_draft) parts.push(`Copy aprobado: ${card.copy_draft}`);
  if (card.tone) parts.push(`Tono: ${card.tone}`);
  if (card.cta) parts.push(`CTA: ${card.cta}`);
  const styleNote = card.style_name ? `Estilo visual: ${card.style_name}.` : "";
  return {
    type: "create_design",
    name: card.title || `Batch design ${new Date().toISOString().slice(0, 10)}`,
    width,
    height,
    frameCount: normalizeFrameCount(card.frame_count),
    cta: card.cta || undefined,
    instructions: parts.filter(Boolean).join("\n") || "Diseño sin instrucciones — creá algo limpio y profesional.",
    style: styleNote || undefined,
  };
}

/** Clamp card.frame_count to a safe 1..10 (null/undefined/0 → 1). */
export function normalizeFrameCount(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 10);
}

/**
 * Deterministic per-frame role for multi-frame cards (no LLM decisions):
 * frame 1 = cover/hook, last = closing/CTA, middle = one key idea each.
 */
export function frameHint(index, total, cta) {
  if (total <= 1) return "";
  if (index === 1) return "This is the COVER frame: dominant title, strong hook, minimal text.";
  if (index === total) return `This is the CLOSING frame: reinforce the call to action${cta ? ` ("${cta}")` : ""}.`;
  return `This is a DEVELOPMENT frame (${index} of ${total}): communicate ONE key idea with supporting detail.`;
}

// ─────────────────────────────────────────────────────────────
// Leader step — backlog/research/draft → design
// ─────────────────────────────────────────────────────────────

/** Gather server-side context so the leader prompt is grounded. */
async function gatherLeaderContext(sb, card) {
  const lines = [];
  if (card.brand_id) {
    try {
      const { data: brand } = await sb.from("brands").select("id, name, description").eq("id", card.brand_id).maybeSingle();
      if (brand) lines.push(`Marca: ${brand.name}${brand.description ? ` — ${brand.description}` : ""}`);
    } catch { /* non-fatal */ }
  }
  if (card.workspace_id) {
    try {
      const { data: recent } = await sb.from("templates")
        .select("id, name").eq("workspace_id", card.workspace_id)
        .order("updated_at", { ascending: false }).limit(5);
      if (recent?.length) lines.push(`Templates recientes del workspace: ${recent.map(t => t.name).join(" | ")}`);
    } catch { /* non-fatal */ }
  }
  return lines.join("\n");
}

/**
 * Server-side brand resolution — the LLM NEVER decides database IDs
 * (a hallucinated brand_id caused FK violations). Resolution order:
 *   1. The card's own brand_id, if the row still exists (stale-FK defense)
 *   2. The workspace's single brand, if exactly one exists
 *   3. null (the column is nullable — "no brand" is valid)
 */
export async function resolveBrandId(sb, card) {
  try {
    if (card.brand_id) {
      const { data: own } = await sb.from("brands").select("id").eq("id", card.brand_id).maybeSingle();
      if (own) return card.brand_id;
    }
    if (card.workspace_id) {
      const { data: brands } = await sb.from("brands").select("id")
        .eq("workspace_id", card.workspace_id).limit(2);
      if (brands && brands.length === 1) return brands[0].id;
    }
  } catch { /* non-fatal → null */ }
  return null;
}

/**
 * Moves a card backlog/research/draft → design.
 * - If the card already carries approved copy (copy_draft), the LLM is
 *   SKIPPED entirely — deterministic pass-through, no hallucination risk.
 * - Otherwise one LLM call writes ONLY the copy (copy_draft, tone, cta).
 *   brand_id is resolved server-side (see resolveBrandId), never by the LLM.
 * Returns { status: "design" } or throws.
 */
async function runLeaderStep(sb, card, llm) {
  const brandId = await resolveBrandId(sb, card);
  const hasCopy = !!(card.copy_draft && String(card.copy_draft).trim());

  if (hasCopy) {
    // ── Fast path: copy already on the card → no LLM call at all ──
    const now = new Date().toISOString();
    const { data: updated, error } = await sb.from("design_kanban_tasks")
      .update({
        brand_id: brandId,
        status: "design",
        assigned_to: "musa-batch-leader",
        updated_at: now,
      })
      .eq("id", card.id).eq("status", card.status).select().maybeSingle();
    if (error) throw new Error("Leader step update failed: " + error.message);
    if (!updated) throw new Error(`Leader step: card ${card.id} changed concurrently (was ${card.status})`);

    await logActivity(sb, card.id, card.status, "design", "Leader batch: copy ya presente en la tarjeta — LLM omitido", "musa-batch-leader");
    return { status: "design", notes: "copy ya presente (LLM omitido)", skippedLLM: true };
  }

  // ── LLM path: copy generation ONLY — no IDs, no sizes, no DB fields ──
  const context = await gatherLeaderContext(sb, card);
  const system = `Eres el LEADER de un pipeline de diseño autónomo. Tu trabajo: escribir el COPY (los textos) del diseño a partir de la tarjeta. NO generás HTML. NO inventás IDs de base de datos, marcas ni medidas — solo contenido textual.
Resolvé ambigüedades con decisiones razonables. Respondé SOLO JSON válido con esta forma:
{
  "copy_draft": "texto final que debe aparecer en el diseño (2-5 frases)",
  "tone": "tono del contenido (profesional, casual, elegante, etc.)",
  "cta": "llamado a la acción corto, o null",
  "ready": true,
  "notes": "decisiones tomadas en una línea"
}`;
  const user = [
    `Tarjeta: ${card.title}`,
    `Tipo/Formato: ${card.type || "post"} / ${card.format || "auto"}`,
    `Brief: ${card.brief || "(sin brief — inventá uno coherente con el título)"}`,
    card.tone ? `Tono actual: ${card.tone}` : "",
    card.cta ? `CTA actual: ${card.cta}` : "",
    context ? `Contexto resuelto:\n${context}` : "",
  ].filter(Boolean).join("\n");

  const raw = await runLLMStep({ system, user, llmKey: llm.llmKey, provider: llm.provider, model: llm.model });
  const parsed = parseLlmJson(raw);
  if (!parsed || parsed.ready !== true) {
    throw new Error("Leader step: LLM no devolvió JSON válido. Respuesta: " + raw.slice(0, 200));
  }

  const now = new Date().toISOString();
  const update = {
    copy_draft: parsed.copy_draft || card.copy_draft || null,
    tone: parsed.tone || card.tone || null,
    cta: typeof parsed.cta === "string" ? parsed.cta : null,
    brand_id: brandId, // server-side resolution — never from the LLM
    status: "design",
    assigned_to: "musa-batch-leader",
    updated_at: now,
  };
  const { data: updated, error } = await sb.from("design_kanban_tasks")
    .update(update).eq("id", card.id).eq("status", card.status).select().maybeSingle();
  if (error) throw new Error("Leader step update failed: " + error.message);
  if (!updated) throw new Error(`Leader step: card ${card.id} changed concurrently (was ${card.status})`);

  await logActivity(sb, card.id, card.status, "design", `Leader batch: ${parsed.notes || "copy generado"}`, "musa-batch-leader");
  return { status: "design", notes: parsed.notes || null };
}

// ─────────────────────────────────────────────────────────────
// Implementer step — design → review (reuses headless generator)
// ─────────────────────────────────────────────────────────────

async function executeDesignCreation(action, llmConfig) {
  if (!action || action.type !== "create_design") {
    throw new Error("Invalid action type: " + (action?.type || "none"));
  }

  const provider = llmConfig.provider || "deepseek";
  const llmKey = llmConfig.llmKey || "";
  if (!llmKey) throw new Error("NO_LLM_KEY: configurá tu API key en Ajustes de IA para que el batch pueda generar diseños.");

  const model = llmConfig.model ||
    (provider === "anthropic" ? "claude-3-5-sonnet-20241022" :
     provider === "openai" ? "gpt-4o-mini" :
     "deepseek-chat");

  const width = action.width || 1080;
  const height = action.height || 1080;
  const name = action.name || `Batch design ${new Date().toISOString().slice(0, 10)}`;
  const styleNote = action.style ? `Estilo visual: ${action.style}.` : "";
  const frameCount = normalizeFrameCount(action.frameCount);

  const systemPrompt = `You are a design generator. You receive instructions for a visual design and return ONLY raw HTML and CSS code. No markdown, no explanations.

Rules:
- The design must fit exactly ${width}x${height} pixels. Nothing overflows.
- Return HTML first inside a block delimited by <HTML> and </HTML> tags.
- Then return CSS inside a block delimited by <CSS> and </CSS> tags.
- Use only system fonts or Google Fonts via @import.
- The HTML is a single root <div> container. No <html>, <head>, or <body> tags.
- Text must be readable, properly sized, and positioned within bounds.
- Colors must be hex (#RRGGBB). No CSS variables in the output.
${styleNote}`;

  // ── One LLM call per frame (multi-frame cards honor card.frame_count) ──
  const frameContents = [];
  for (let i = 1; i <= frameCount; i++) {
    const userPrompt = frameCount > 1
      ? `Design instructions: ${action.instructions}\n\nThis design has ${frameCount} frames shown in sequence as a set. ${frameHint(i, frameCount, action.cta)}\nDesign ONLY frame ${i} of ${frameCount}. Do not repeat other frames' content.`
      : `Design instructions: ${action.instructions}`;

    const llmResponse = await runLLMStep({ system: systemPrompt, user: userPrompt, llmKey, provider, model, maxTokens: 4096 });

    const htmlMatch = llmResponse.match(/<HTML>\s*([\s\S]*?)\s*<\/HTML>/i);
    const cssMatch = llmResponse.match(/<CSS>\s*([\s\S]*?)\s*<\/CSS>/i);
    let html = htmlMatch ? htmlMatch[1].trim() : "";
    let css = cssMatch ? cssMatch[1].trim() : "";

    if (!html) {
      const fenced = llmResponse.match(/```html\s*([\s\S]*?)```/i);
      if (fenced) html = fenced[1].trim();
    }
    if (!css) {
      const fenced = llmResponse.match(/```css\s*([\s\S]*?)```/i);
      if (fenced) css = fenced[1].trim();
    }
    if (!html || html.length < 20) {
      throw new Error(`LLM did not produce valid HTML for frame ${i}/${frameCount}. Response: ` + llmResponse.slice(0, 200));
    }
    frameContents.push({ html, css });
  }

  const tpl = await templates.createTemplate(name, width, height, null, null, llmConfig.workspaceId || null);
  if (!tpl) throw new Error("Failed to create template");

  // Top-level html/css = frame 1 (legacy consumers + reviewer C4 check).
  // Multi-frame: real frames[] with per-frame html/css — the same shape
  // MCP create_frame/update_html_frame persists and EditorV2 loads
  // natively (each frame renders in its own isolated shadow root).
  tpl.engine = "html";
  tpl.html = frameContents[0].html;
  tpl.css = frameContents[0].css;
  tpl.frames = frameCount > 1
    ? frameContents.map((f, idx) => ({
        id: `frame_batch_${Date.now().toString(36)}_${idx + 1}`,
        templateId: tpl.id,
        name: `Frame ${idx + 1}`,
        x: idx * (width + 120), y: 0,
        width, height,
        fill: "#ffffff", background: "#ffffff",
        opacity: 1, order: idx,
        objects: [],
        parentFrameId: null,
        layoutMode: "NONE",
        clipsContent: true,
        constraints: {},
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        html: f.html,
        css: f.css,
      }))
    : (tpl.frames || []);

  await templates.updateTemplate(tpl.id, {
    engine: "html",
    html: tpl.html,
    css: tpl.css,
    frames: tpl.frames,
  });

  const verify = await templates.getTemplate(tpl.id);
  if (!verify || !verify.html || verify.html.length < 20) {
    throw new Error("Template verification failed — no HTML content after save");
  }
  if (frameCount > 1 && (!Array.isArray(verify.frames) || verify.frames.length !== frameCount)) {
    throw new Error(`Template verification failed — expected ${frameCount} frames, persisted ${Array.isArray(verify.frames) ? verify.frames.length : 0}`);
  }

  return {
    templateId: tpl.id,
    renderUrl: null, // render happens lazily on first editor open
    width,
    height,
    frameCount,
  };
}

async function runDesignStep(sb, card, llm) {
  const action = buildDesignActionFromCard(card);
  const result = await executeDesignCreation(action, { llmKey: llm.llmKey, provider: llm.provider, model: llm.model, workspaceId: card.workspace_id });

  const now = new Date().toISOString();
  const { data: updated, error } = await sb.from("design_kanban_tasks")
    .update({
      status: "review",
      template_id: result.templateId,
      render_url: result.renderUrl,
      checkpoint_json: {},
      assigned_to: "musa-batch-implementer",
      updated_at: now,
    })
    .eq("id", card.id).eq("status", "design").select().maybeSingle();
  if (error) throw new Error("Design step update failed: " + error.message);
  if (!updated) throw new Error(`Design step: card ${card.id} changed concurrently (was design)`);

  await logActivity(sb, card.id, "design", "review", `Implementer batch: template ${result.templateId} generado (${result.frameCount || 1} frame${(result.frameCount || 1) > 1 ? "s" : ""})`, "musa-batch-implementer");
  return { status: "review", templateId: result.templateId, frameCount: result.frameCount || 1 };
}

// ─────────────────────────────────────────────────────────────
// Reviewer step — review → done | feedback
// ─────────────────────────────────────────────────────────────

/**
 * Validate C1-C5. C1/C4/C5 are checked in code (environment, persistence,
 * session closure); C2 (acceptance) and C3 (geometry) are judged by the
 * reviewer LLM against the generated HTML/CSS.
 */
async function runReviewerStep(sb, card, llm) {
  // ── Code-side checks ──
  const codeChecks = [];
  codeChecks.push({ id: "C1", passed: true, description: "Entorno listo", notes: "Batch runtime conectado a Supabase y LLM." });

  let html = "";
  let css = "";
  if (card.template_id) {
    const tpl = await templates.getTemplate(card.template_id);
    if (tpl) { html = tpl.html || ""; css = tpl.css || ""; }
  }
  const persists = !!(card.template_id && html && html.length >= 20);
  codeChecks.push({
    id: "C4",
    passed: persists,
    description: "Persistencia del template",
    notes: persists ? `Template ${card.template_id} verificado con contenido.` : "No se pudo verificar el template generado.",
  });
  codeChecks.push({ id: "C5", passed: true, description: "Sesión cerrada", notes: "Pipeline autónomo: estado escrito por el batch en esta corrida." });

  const acceptance = Array.isArray(card.acceptance)
    ? card.acceptance
    : typeof card.acceptance === "string"
      ? card.acceptance.split("\n").map(s => s.trim()).filter(Boolean)
      : [];

  // ── LLM checks (C2 acceptance + C3 geometry) ──
  const system = `Eres el REVIEWER de un pipeline de diseño autónomo. Evaluás el HTML/CSS generado contra los criterios de aceptación y la calidad geométrica. Sé estricto pero pragmático: solo rechazá si el diseño NO cumple el criterio de forma objetiva.
Respondé SOLO JSON válido con esta forma:
{
  "c2": [{ "item": "texto del criterio", "passed": true, "notes": "evidencia en una línea" }],
  "c3": { "passed": true, "notes": "evaluación de desbordes/texto cortado/solapamientos" }
}`;
  const user = [
    `Tarjeta: ${card.title}`,
    `Brief: ${card.brief || "(sin brief)"}`,
    `Copy: ${card.copy_draft || "(sin copy)"}`,
    acceptance.length ? `Criterios de aceptación:\n${acceptance.map((a, i) => `${i + 1}. ${a}`).join("\n")}` : "Sin criterios de aceptación formales — evaluá solo calidad general.",
    "",
    "HTML generado:",
    html.length > 9000 ? html.slice(0, 9000) + "\n... (truncado)" : (html || "(vacío)"),
    "",
    "CSS generado:",
    css.length > 6000 ? css.slice(0, 6000) + "\n... (truncado)" : (css || "(vacío)"),
  ].join("\n");

  let c2 = acceptance.map(item => ({ item, passed: null, notes: null }));
  let c3 = { passed: null, notes: null };
  try {
    const raw = await runLLMStep({ system, user, llmKey: llm.llmKey, provider: llm.provider, model: llm.model, maxTokens: 1500 });
    const parsed = parseLlmJson(raw);
    if (parsed) {
      if (Array.isArray(parsed.c2) && parsed.c2.length === acceptance.length) c2 = parsed.c2;
      if (parsed.c3 && typeof parsed.c3.passed === "boolean") c3 = parsed.c3;
    }
  } catch (e) {
    // LLM failure in review = do not approve silently.
    c3 = { passed: false, notes: "Review LLM falló: " + (e?.message || e).slice(0, 200) };
  }

  // ── Persist checkpoints (harness_checkpoints + card.checkpoint_json) ──
  const now = new Date().toISOString();
  const verdicts = [];
  for (const check of codeChecks) {
    verdicts.push(check);
    await upsertCheckpoint(sb, card, check, now);
  }
  for (const item of c2) {
    const check = {
      id: `C2_${c2.indexOf(item) + 1}`,
      passed: item.passed === true,
      description: "Acceptance: " + (item.item || "").slice(0, 200),
      notes: item.notes || null,
    };
    verdicts.push(check);
    await upsertCheckpoint(sb, card, check, now);
  }
  const c3Check = {
    id: "C3",
    passed: c3.passed === true,
    description: "Calidad geométrica (sin desbordes ni texto cortado)",
    notes: c3.notes || null,
  };
  verdicts.push(c3Check);
  await upsertCheckpoint(sb, card, c3Check, now);

  const approved = verdicts.every(v => v.passed === true);
  const checkpointJson = {};
  for (const v of verdicts) {
    checkpointJson[v.id] = { passed: v.passed, description: v.description, notes: v.notes, reviewedAt: now };
  }

  if (approved) {
    await sb.from("design_kanban_tasks")
      .update({ status: "done", completed_at: now, updated_at: now, checkpoint_json: checkpointJson, assigned_to: "musa-batch-reviewer" })
      .eq("id", card.id).eq("status", "review");
    await logActivity(sb, card.id, "review", "done", "Reviewer batch: C1-C5 aprobados", "musa-batch-reviewer");
    return { status: "done", approved: true };
  }

  const reasons = verdicts.filter(v => v.passed !== true).map(v => `${v.id}: ${v.notes || v.description}`).join(" | ");
  await sb.from("design_kanban_tasks")
    .update({ status: "feedback", blocker_reason: reasons.slice(0, 500), updated_at: now, checkpoint_json: checkpointJson, assigned_to: "musa-batch-reviewer" })
    .eq("id", card.id).eq("status", "review");
  await logActivity(sb, card.id, "review", "feedback", "Reviewer batch: cambios requeridos — " + reasons.slice(0, 300), "musa-batch-reviewer");
  return { status: "feedback", approved: false, reason: reasons.slice(0, 300) };
}

async function upsertCheckpoint(sb, card, check, now) {
  const { data: existing } = await sb.from("harness_checkpoints")
    .select("id").eq("task_id", card.id).eq("checkpoint_id", check.id).maybeSingle();
  const payload = {
    account_id: UUID_RE.test(card.account_id || "") ? card.account_id : null,
    task_id: card.id,
    checkpoint_id: check.id,
    description: check.description || "",
    passed: check.passed === true,
    reviewer_agent: "musa-batch-reviewer",
    reviewed_at: now,
    notes: check.notes || null,
  };
  if (existing) {
    await sb.from("harness_checkpoints").update(payload).eq("id", existing.id);
  } else {
    await sb.from("harness_checkpoints").insert({ id: "hc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8), ...payload });
  }
}

async function logActivity(sb, taskId, fromStatus, toStatus, comment, createdBy) {
  try {
    await sb.from("design_kanban_activity_log").insert({
      id: "log_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
      task_id: taskId,
      from_status: fromStatus,
      to_status: toStatus,
      comment,
      created_by: createdBy,
    });
  } catch { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────────
// Key resolution (BYOK per owner, env fallback)
// ─────────────────────────────────────────────────────────────

async function resolveBatchKey(sb, ws) {
  const provider = ws.batch_llm_provider || "deepseek";
  let llmKey = "";
  let llmModel = null;
  let llmSource = "none";

  const { data: wsRow } = await sb.from("workspaces")
    .select("owner_id").eq("id", ws.workspace_id).maybeSingle();
  const ownerId = wsRow?.owner_id || null;

  if (ownerId && UUID_RE.test(ownerId)) {
    try {
      const { key, model } = await getUserKey(ownerId, provider);
      if (key) { llmKey = key; llmModel = model; llmSource = "byok"; }
    } catch { /* decrypt failure — fall through */ }
  }
  if (!llmKey && process.env.BATCH_LLM_KEY) {
    llmKey = process.env.BATCH_LLM_KEY;
    llmSource = "env";
  }
  // Single fallback point: null/empty model (empty user_api_keys.model
  // or the env-key path) → provider default, so runLLMStep and
  // executeDesignCreation always receive a valid model string.
  const model = (llmModel && String(llmModel).trim()) || DEFAULT_MODELS[provider] || DEFAULT_MODELS.deepseek;
  return { llmKey, provider, model, llmSource };
}

// ─────────────────────────────────────────────────────────────
// Per-card dispatcher
// ─────────────────────────────────────────────────────────────

function nextActionFor(status) {
  switch (status) {
    case "backlog": case "research": case "draft": return { role: "leader", to: "design" };
    case "design": return { role: "implementer", to: "review" };
    case "review": return { role: "reviewer", to: "done|feedback" };
    default: return null;
  }
}

async function processCard(sb, card, llm) {
  switch (card.status) {
    case "backlog":
    case "research":
    case "draft":
      return runLeaderStep(sb, card, llm);
    case "design":
      return runDesignStep(sb, card, llm);
    case "review":
      return runReviewerStep(sb, card, llm);
    default:
      return { status: card.status, skipped: true, reason: "not processable" };
  }
}

// ─────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────

/**
 * Run one batch pass over all enabled kanban cards of every workspace
 * with auto_process_enabled = true. One role step per card per run.
 *
 * @param {{ workspaceId?: string|null, dryRun?: boolean }} opts
 */
export async function runDailyBatch({ workspaceId = null, dryRun = false } = {}) {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Batch processing requires Supabase.");

  let wsQuery = sb.from("workspace_config").select("*").eq("auto_process_enabled", true);
  if (workspaceId) wsQuery = wsQuery.eq("workspace_id", workspaceId);
  const { data: workspaces, error: wsErr } = await wsQuery;
  if (wsErr) throw new Error("Workspace config query failed: " + wsErr.message);

  if (!workspaces || workspaces.length === 0) {
    return { processed: [], message: "No workspaces have auto-process enabled." };
  }

  const batchResults = [];

  for (const ws of workspaces) {
    const llm = await resolveBatchKey(sb, ws);
    const wsResult = {
      workspaceId: ws.workspace_id,
      llmSource: llm.llmSource,
      dryRun,
      cards: [],
      success: 0,
      failed: 0,
      total: 0,
    };

    // ── Fetch cards: enabled, not hard-locked (no_tocar), not done/feedback, ordered ──
    const maxItems = ws.auto_process_max_items || 50;
    const { data: cards, error: cErr } = await sb.from("design_kanban_tasks")
      .select("*")
      .eq("workspace_id", ws.workspace_id)
      .eq("enabled", true)
      .eq("no_tocar", false)
      .in("status", PROCESSABLE_STATUSES)
      .order("priority", { ascending: true })
      .order("deadline", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(maxItems);
    if (cErr) throw new Error("Kanban query failed: " + cErr.message);

    if (!cards || cards.length === 0) {
      batchResults.push({ ...wsResult, skipped: true });
      continue;
    }
    wsResult.total = cards.length;

    // ── No key → mark cards as needing human action, skip workspace ──
    if (!llm.llmKey) {
      const noKeyMsg = "NO_LLM_KEY: configurá tu API key en Ajustes de IA para que el batch pueda procesar el Kanban.";
      if (dryRun) {
        for (const card of cards) {
          wsResult.cards.push({ cardId: card.id, title: card.title, status: card.status, wouldRun: "none", note: noKeyMsg });
        }
      } else {
        for (const card of cards) {
          try {
            // Status guard: only flip cards that are still where we
            // fetched them (an overlapping run may have advanced them).
            await sb.from("design_kanban_tasks")
              .update({ status: "feedback", blocker_reason: noKeyMsg, updated_at: new Date().toISOString() })
              .eq("id", card.id)
              .eq("status", card.status);
            await logActivity(sb, card.id, card.status, "feedback", noKeyMsg, "musa-batch");
          } catch { /* non-fatal */ }
        }
        wsResult.failed = cards.length;
      }
      batchResults.push(wsResult);
      continue;
    }

    // ── Sequential processing: one step per card, errors never abort ──
    for (const card of cards) {
      const action = nextActionFor(card.status);
      if (!action) {
        wsResult.cards.push({ cardId: card.id, status: card.status, skipped: true, reason: "not processable" });
        continue;
      }

      // Hands-off guard: human touched this card moments ago.
      if (!dryRun && card.updated_at && (Date.now() - new Date(card.updated_at).getTime()) < HANDS_OFF_MS) {
        wsResult.cards.push({ cardId: card.id, status: card.status, skipped: true, reason: "hands_off" });
        continue;
      }

      if (dryRun) {
        wsResult.cards.push({ cardId: card.id, title: card.title, status: card.status, wouldRun: action.role, nextStatus: action.to });
        continue;
      }

      try {
        const result = await processCard(sb, card, llm);
        wsResult.success++;
        wsResult.cards.push({ cardId: card.id, status: card.status, ...result });
      } catch (e) {
        const message = (e?.message || String(e)).slice(0, 300);
        try {
          // Status guard: "changed concurrently" errors (an overlapping
          // run already advanced this card) must NOT yank it back to
          // feedback — only mark cards still in the fetched status.
          await sb.from("design_kanban_tasks")
            .update({ status: "feedback", blocker_reason: "Batch error: " + message, updated_at: new Date().toISOString() })
            .eq("id", card.id)
            .eq("status", card.status);
          await logActivity(sb, card.id, card.status, "feedback", "Batch error: " + message, "musa-batch");
        } catch { /* non-fatal */ }
        wsResult.failed++;
        wsResult.cards.push({ cardId: card.id, status: card.status, error: message });
      }
    }

    batchResults.push(wsResult);

    // ── Telegram notification ──
    if (!dryRun && ws.notify_on_complete && ws.notify_chat_id) {
      try {
        const { sendTelegram, formatBatchMessage } = await import("./telegram-notify.mjs");
        const msg = formatBatchMessage({ workspaceId: ws.workspace_id, success: wsResult.success, failed: wsResult.failed, total: wsResult.total });
        await sendTelegram(ws.notify_chat_id, msg);
      } catch { /* best-effort */ }
    }
  }

  const totalSuccess = batchResults.reduce((s, r) => s + (r.success || 0), 0);
  const totalFailed = batchResults.reduce((s, r) => s + (r.failed || 0), 0);
  return {
    processed: batchResults,
    summary: { workspaces: batchResults.length, totalSuccess, totalFailed, total: totalSuccess + totalFailed, dryRun },
  };
}
