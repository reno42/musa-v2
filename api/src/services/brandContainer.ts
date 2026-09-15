import { v4 as uuid } from "uuid";
import type { BrandGuideline, DesignTemplate } from "../types.js";
import { getSupabase } from "./supabase.js";
import { createTemplate, updateTemplate, getTemplate, listTemplatesPaginated } from "./templates.js";
import { emitBrandVault } from "./brainNotes.js";

// ─── Brand containers (migración v47) ────────────────────────────────────
// One brand = three files in the Diseño → Design Systems tab:
//   ds            → the Design System itself (canonical frames 01–08)
//   plantillas    → frames the human curated from regular files
//   communication → the Brand Strategy (essence, tone, voice) as frames
// `brand_container_kind` (templates column, v47) + data.brandContainerKind
// mark them; they never appear in the Archivos grid (isBrandManual=true).

export const CONTAINER_KINDS = ["ds", "plantillas", "communication"] as const;
export type ContainerKind = (typeof CONTAINER_KINDS)[number];

export type BrandContainerInfo = {
  designSystemTemplateId?: string;
  plantillasTemplateId?: string;
  communicationTemplateId?: string;
  createdPlantillas: boolean;
  createdCommunication: boolean;
};

// ─── DTCG token helpers (deterministic, no external deps) ────────────────

type TokenLeaf = { path: string; type: string; value: unknown };

/** Walk a DTCG tokens document and yield leaves ($type/$value nodes). */
export function walkTokens(doc: unknown, prefix = "", out: TokenLeaf[] = []): TokenLeaf[] {
  if (!doc || typeof doc !== "object") return out;
  for (const [key, node] of Object.entries(doc as Record<string, unknown>)) {
    if (key.startsWith("$")) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (node && typeof node === "object" && "$value" in (node as Record<string, unknown>)) {
      const leaf = node as Record<string, unknown>;
      out.push({ path, type: String(leaf.$type || "unknown"), value: leaf.$value });
    } else {
      walkTokens(node, path, out);
    }
  }
  return out;
}

function safeParse(json: string | null | undefined): any | null {
  if (!json || !json.trim()) return null;
  try { return JSON.parse(json); } catch { return null; }
}

export type TokenSummary = {
  colors: string[];
  fonts: string[];
  counts: { color: number; typography: number; spacing: number; radius: number; shadow: number };
  parsed: boolean;
};

export function summarizeTokens(tokensJson: string | null | undefined): TokenSummary {
  const doc = safeParse(tokensJson);
  if (!doc) {
    return { colors: [], fonts: [], counts: { color: 0, typography: 0, spacing: 0, radius: 0, shadow: 0 }, parsed: false };
  }
  const leaves = walkTokens(doc);
  const colors: string[] = [];
  const fonts: string[] = [];
  const counts = { color: 0, typography: 0, spacing: 0, radius: 0, shadow: 0 };
  for (const leaf of leaves) {
    if (leaf.type === "color") { counts.color += 1; colors.push(String(leaf.value)); }
    else if (leaf.type === "typography" || leaf.type === "fontFamily") {
      counts.typography += 1;
      const family = typeof leaf.value === "object" && leaf.value && "fontFamily" in (leaf.value as any)
        ? String((leaf.value as any).fontFamily)
        : String(leaf.value);
      fonts.push(family);
    }
    else if (leaf.type === "spacing" || leaf.type === "dimension") counts.spacing += 1;
    else if (leaf.type === "borderRadius") counts.radius += 1;
    else if (leaf.type === "shadow" || leaf.type === "boxShadow") counts.shadow += 1;
  }
  return { colors: [...new Set(colors)], fonts: [...new Set(fonts)], counts, parsed: true };
}

// ─── Completeness (deterministic, n/total checks) ─────────────────────────

export type CompletenessCheck = { id: string; label: string; ok: boolean };
export type Completeness = { score: number; total: number; checks: CompletenessCheck[] };

function buildCompleteness(checks: CompletenessCheck[]): Completeness {
  return { score: checks.filter(c => c.ok).length, total: checks.length, checks };
}

/** Design System completeness from the brand's stored artifacts (cheap —
 *  no frame reads needed for the list view). */
export function computeDsCompleteness(brand: Pick<BrandGuideline, "tokensJson" | "designMd" | "sharedCss">): Completeness {
  const tokens = summarizeTokens(brand.tokensJson);
  return buildCompleteness([
    { id: "palette_basics", label: "Paleta básica (≥4 colores)", ok: tokens.counts.color >= 4 },
    { id: "palette_extended", label: "Paleta extendida (≥8 colores)", ok: tokens.counts.color >= 8 },
    { id: "typography_family", label: "Tipografía definida", ok: tokens.fonts.length >= 1 },
    { id: "typography_scale", label: "Escala tipográfica (≥3 estilos)", ok: tokens.counts.typography >= 3 },
    { id: "spacing", label: "Espaciados", ok: tokens.counts.spacing >= 4 },
    { id: "radius", label: "Radios", ok: tokens.counts.radius >= 2 },
    { id: "elevation", label: "Elevación / sombras", ok: tokens.counts.shadow >= 1 },
    { id: "design_md", label: "DESIGN.md documentado", ok: Boolean(brand.designMd && brand.designMd.trim()) },
  ]);
}

const TONE_AXES = ["formal", "calido", "energia", "minimal", "tecnico"] as const;

function emptyStrategy(value: unknown): Record<string, any> {
  return (value && typeof value === "object" && !Array.isArray(value)) ? value as Record<string, any> : {};
}

/** Brand Strategy completeness (BRAND_STRATEGY_V1): 11 checks across the
 *  5 progressive sections of the canvas. */
export function computeStrategyCompleteness(strategyJson: string | null | undefined): Completeness {
  const s = emptyStrategy(safeParse(strategyJson));
  const essence = emptyStrategy(s.essence);
  const tone = emptyStrategy(s.tone);
  const axes = emptyStrategy(tone.axes);
  const audience = emptyStrategy(s.audience);
  const personas = Array.isArray(audience.personas) ? audience.personas : [];
  const voice = emptyStrategy(s.voice);
  const advanced = emptyStrategy(s.advanced);
  return buildCompleteness([
    { id: "mission", label: "Misión", ok: Boolean(String(essence.mission || "").trim()) },
    { id: "vision", label: "Visión", ok: Boolean(String(essence.vision || "").trim()) },
    { id: "values", label: "Valores (≥1)", ok: Array.isArray(essence.values) && essence.values.length >= 1 },
    { id: "value_proposition", label: "Propuesta de valor", ok: Boolean(String(essence.valueProposition || "").trim()) },
    { id: "tone_axes", label: "Tono (5 ejes)", ok: TONE_AXES.every(axis => typeof axes[axis] === "number") },
    { id: "tone_person", label: "Persona gramatical", ok: typeof tone.person === "string" },
    { id: "emoji_policy", label: "Política de emojis", ok: typeof tone.emojiPolicy === "string" },
    { id: "personas", label: "Personas sintéticas (≥1)", ok: personas.length >= 1 && personas.every((p: any) => String(p?.name || "").trim()) },
    { id: "vocabulary", label: "Vocabulario sí/no (≥3 sí)", ok: Array.isArray(voice.vocabularyYes) && voice.vocabularyYes.length >= 3 },
    { id: "cta_patterns", label: "Patrones de CTA (≥1)", ok: Array.isArray(voice.ctaPatterns) && voice.ctaPatterns.length >= 1 },
    { id: "archetype", label: "Arquetipo", ok: Boolean(String(advanced.archetype || "").trim()) },
  ]);
}

/** Plantillas completeness: curated frames count (a brand with zero curated
 *  frames just hasn't chosen its favorites yet). */
export function computePlantillasCompleteness(frameCount: number): Completeness {
  return buildCompleteness([
    { id: "first_template", label: "Primera plantilla curada", ok: frameCount >= 1 },
    { id: "three_templates", label: "3+ plantillas curadas", ok: frameCount >= 3 },
  ]);
}

export function combineCompleteness(parts: Completeness[]): Completeness {
  const checks = parts.flatMap(p => p.checks);
  return buildCompleteness(checks);
}

// ─── Brand Strategy V1: validation + merge + digest ───────────────────────

export type BrandStrategyV1 = {
  $version: 1;
  essence?: { mission?: string; vision?: string; values?: string[]; valueProposition?: string; positioning?: string };
  tone?: { axes?: Record<string, number>; person?: "tu" | "usted" | "nosotros"; emojiPolicy?: "never" | "occasional" | "free" };
  audience?: { personas?: Array<{ name: string; description?: string }> };
  voice?: {
    vocabularyYes?: string[]; vocabularyNo?: string[]; bannedTells?: string[];
    hookStructures?: string[]; ctaPatterns?: string[]; lengthByChannel?: Record<string, string>;
  };
  advanced?: { archetype?: string };
};

export type StrategyValidation =
  | { ok: true; value: BrandStrategyV1 }
  | { ok: false; issues: string[] };

const STRING_LIMITS: Array<[string, number]> = [
  ["essence.mission", 400], ["essence.vision", 400], ["essence.valueProposition", 400], ["essence.positioning", 240],
];

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanStringList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => cleanString(item, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

/** Validate + normalize an incoming strategy object (sections may be partial).
 *  Unknown keys are stripped, never silently coerced out of range. */
export function validateStrategy(incoming: unknown): StrategyValidation {
  const issues: string[] = [];
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return { ok: false, issues: ["strategy must be an object"] };
  }
  const raw = incoming as Record<string, any>;
  const out: any = { $version: 1 as const };

  if (raw.essence !== undefined) {
    if (typeof raw.essence !== "object" || raw.essence === null) issues.push("essence must be an object");
    else {
      const e = raw.essence;
      const essence: any = {};
      for (const [path, max] of STRING_LIMITS.filter(([p]) => p.startsWith("essence."))) {
        const field = path.split(".")[1];
        const value = cleanString(e[field], max);
        if (e[field] !== undefined && typeof e[field] !== "string") issues.push(`${path} must be a string`);
        if (value) essence[field] = value;
      }
      if (e.values !== undefined) {
        if (!Array.isArray(e.values)) issues.push("essence.values must be an array");
        else essence.values = cleanStringList(e.values, 10, 60);
      }
      if (Object.keys(essence).length) out.essence = essence;
    }
  }

  if (raw.tone !== undefined) {
    if (typeof raw.tone !== "object" || raw.tone === null) issues.push("tone must be an object");
    else {
      const t = raw.tone;
      const tone: any = {};
      if (t.axes !== undefined) {
        if (typeof t.axes !== "object" || t.axes === null) issues.push("tone.axes must be an object");
        else {
          const axes: Record<string, number> = {};
          for (const axis of TONE_AXES) {
            const value = (t.axes as any)[axis];
            if (value === undefined) continue;
            if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
              issues.push(`tone.axes.${axis} must be an integer 0–100`);
              continue;
            }
            axes[axis] = value;
          }
          if (Object.keys(axes).length) tone.axes = axes;
        }
      }
      if (t.person !== undefined) {
        if (!["tu", "usted", "nosotros"].includes(t.person)) issues.push("tone.person must be tu | usted | nosotros");
        else tone.person = t.person;
      }
      if (t.emojiPolicy !== undefined) {
        if (!["never", "occasional", "free"].includes(t.emojiPolicy)) issues.push("tone.emojiPolicy must be never | occasional | free");
        else tone.emojiPolicy = t.emojiPolicy;
      }
      if (Object.keys(tone).length) out.tone = tone;
    }
  }

  if (raw.audience !== undefined) {
    if (typeof raw.audience !== "object" || raw.audience === null) issues.push("audience must be an object");
    else {
      const a = raw.audience;
      const audience: any = {};
      if (a.personas !== undefined) {
        if (!Array.isArray(a.personas)) issues.push("audience.personas must be an array");
        else {
          const personas = (a.personas as any[]).slice(0, 5).map((p: any) => ({
            name: cleanString(p?.name, 80),
            description: cleanString(p?.description, 400),
          })).filter((p: { name: string }) => p.name);
          if (personas.length) audience.personas = personas;
        }
      }
      if (Object.keys(audience).length) out.audience = audience;
    }
  }

  if (raw.voice !== undefined) {
    if (typeof raw.voice !== "object" || raw.voice === null) issues.push("voice must be an object");
    else {
      const v = raw.voice;
      const voice: any = {};
      for (const field of ["vocabularyYes", "vocabularyNo", "bannedTells", "hookStructures", "ctaPatterns"] as const) {
        if (v[field] !== undefined) {
          if (!Array.isArray(v[field])) issues.push(`voice.${field} must be an array`);
          else {
            const list = cleanStringList(v[field], 20, 40);
            if (list.length) voice[field] = list;
          }
        }
      }
      if (v.lengthByChannel !== undefined) {
        if (typeof v.lengthByChannel !== "object" || v.lengthByChannel === null) issues.push("voice.lengthByChannel must be an object");
        else {
          const byChannel: Record<string, string> = {};
          for (const [channel, value] of Object.entries(v.lengthByChannel).slice(0, 8)) {
            const clean = cleanString(value, 120);
            if (clean) byChannel[channel.slice(0, 40)] = clean;
          }
          if (Object.keys(byChannel).length) voice.lengthByChannel = byChannel;
        }
      }
      if (Object.keys(voice).length) out.voice = voice;
    }
  }

  if (raw.advanced !== undefined) {
    if (typeof raw.advanced !== "object" || raw.advanced === null) issues.push("advanced must be an object");
    else {
      const archetype = cleanString((raw.advanced as any).archetype, 60);
      if (archetype) out.advanced = { archetype };
    }
  }

  if (issues.length) return { ok: false, issues };
  return { ok: true, value: out as BrandStrategyV1 };
}

/** Section-level merge: sections present in `incoming` replace the previous
 *  ones entirely; absent sections survive untouched. */
export function mergeStrategy(prevJson: string | null | undefined, incoming: BrandStrategyV1): BrandStrategyV1 {
  const prev = emptyStrategy(safeParse(prevJson));
  return {
    $version: 1,
    essence: incoming.essence ?? prev.essence,
    tone: incoming.tone ?? prev.tone,
    audience: incoming.audience ?? prev.audience,
    voice: incoming.voice ?? prev.voice,
    advanced: incoming.advanced ?? prev.advanced,
  } as BrandStrategyV1;
}

/** Compact, IA-readable digest of a strategy (playbook + notes). */
export function strategyDigest(strategyJson: string | null | undefined): string {
  const s = emptyStrategy(safeParse(strategyJson));
  const parts: string[] = [];
  const essence = emptyStrategy(s.essence);
  if (essence.valueProposition) parts.push(`Propuesta: ${essence.valueProposition}`);
  if (essence.mission) parts.push(`Misión: ${essence.mission}`);
  const tone = emptyStrategy(s.tone);
  const axes = emptyStrategy(tone.axes);
  const axisText = TONE_AXES.filter(a => typeof axes[a] === "number").map(a => `${a} ${axes[a]}/100`).join(", ");
  if (axisText) parts.push(`Tono: ${axisText}${tone.person ? ` (habla de ${tone.person})` : ""}${tone.emojiPolicy ? `, emojis: ${tone.emojiPolicy}` : ""}`);
  const personas = Array.isArray(emptyStrategy(s.audience).personas) ? emptyStrategy(s.audience).personas : [];
  if (personas.length) parts.push(`Personas: ${personas.map((p: any) => p.name).join(", ")}`);
  const voice = emptyStrategy(s.voice);
  if (Array.isArray(voice.vocabularyYes) && voice.vocabularyYes.length) parts.push(`Usar: ${voice.vocabularyYes.join(", ")}`);
  if (Array.isArray(voice.vocabularyNo) && voice.vocabularyNo.length) parts.push(`Evitar: ${voice.vocabularyNo.join(", ")}`);
  if (Array.isArray(voice.ctaPatterns) && voice.ctaPatterns.length) parts.push(`CTAs: ${voice.ctaPatterns.join(" | ")}`);
  const advanced = emptyStrategy(s.advanced);
  if (advanced.archetype) parts.push(`Arquetipo: ${advanced.archetype}`);
  return parts.join(" · ") || "Estrategia aún vacía";
}

// ─── Canonical seed frames ────────────────────────────────────────────────

const W = 1920;
const H = 1080;

function frameShell(brandName: string, section: string, title: string, inner: string, accent = "#6366f1"): string {
  return `<div style="width:${W}px;height:${H}px;background:#0d0d1a;color:#f4f4fb;font-family:Inter,system-ui,sans-serif;display:flex;flex-direction:column;padding:72px 96px;box-sizing:border-box;position:relative;overflow:hidden">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:22px;letter-spacing:4px;text-transform:uppercase;color:${accent}">${brandName}</span>
    <span style="font-size:20px;color:rgba(244,244,251,0.45)">Design System · ${section}</span>
  </div>
  <h1 style="font-size:84px;margin:64px 0 24px;font-weight:700;line-height:1.05">${title}</h1>
  ${inner}
  <div style="position:absolute;bottom:48px;left:96px;right:96px;display:flex;justify-content:space-between;font-size:20px;color:rgba(244,244,251,0.35)">
    <span>Design Systems · Futuraria</span><span>pendiente de completar</span>
  </div>
</div>`;
}

function pendingPill(text: string): string {
  return `<span style="display:inline-block;padding:10px 22px;border:1px dashed rgba(244,244,251,0.4);border-radius:999px;font-size:22px;color:rgba(244,244,251,0.65)">${text}</span>`;
}

/** Canonical DS skeleton (harness/DS_CONTAINER_CONVENTION.md): 8 visible
 *  placeholder sections the human (or an IA) fills by editing each frame. */
export function seedDsFrames(brandName: string, tokensJson?: string | null): DesignTemplate["frames"] {
  const tokens = summarizeTokens(tokensJson);
  const palette = tokens.colors.length
    ? tokens.colors.slice(0, 8).map((color, i) => `<div style="flex:1;height:180px;border-radius:16px;background:${color};display:flex;align-items:flex-end;padding:14px;font-size:18px;color:rgba(0,0,0,0.55)">${i + 1}</div>`).join("")
    : Array.from({ length: 8 }, (_, i) => `<div style="flex:1;height:180px;border-radius:16px;border:1px dashed rgba(244,244,251,0.35);display:flex;align-items:center;justify-content:center;font-size:20px;color:rgba(244,244,251,0.5)">pendiente</div>`).join("");
  const fontNames = tokens.fonts.length ? tokens.fonts.slice(0, 2) : ["Tipografía pendiente"];

  const mk = (name: string, inner: string, accent?: string) => ({
    id: `frame_${uuid().slice(0, 12)}`,
    name, x: 0, y: 0, width: W, height: H,
    html: frameShell(brandName, name.split("—")[0].trim(), name.split("—")[1]?.trim() || name, inner, accent),
    css: "",
  });

  return [
    mk("01 — Portada", `<div style="margin-top:8px">${pendingPill("v1 · esqueleto canónico")}</div>`),
    mk("02 — Logo", `<div style="margin:24px 0;display:flex;gap:32px"><div style="width:420px;height:240px;border:1px dashed rgba(244,244,251,0.35);border-radius:20px;display:flex;align-items:center;justify-content:center;color:rgba(244,244,251,0.5);font-size:24px">Logo principal pendiente</div><div style="width:220px;height:240px;border:1px dashed rgba(244,244,251,0.25);border-radius:20px;display:flex;align-items:center;justify-content:center;color:rgba(244,244,251,0.4);font-size:22px">Isotipo</div></div>`),
    mk("03 — Paleta", `<div style="display:flex;gap:16px;margin-top:16px">${palette}</div>`),
    mk("04 — Tipografía", fontNames.map((font, i) => `<div style="margin:28px 0"><div style="font-size:${i === 0 ? 96 : 56}px;font-weight:${i === 0 ? 700 : 400};line-height:1.1">${font}</div><div style="font-size:22px;color:rgba(244,244,251,0.45);margin-top:8px">${i === 0 ? "Display" : "Texto"} — define pesos y tamaños</div></div>`).join("")),
    mk("05 — Componentes", `<div style="display:flex;gap:24px;margin-top:24px;align-items:center"><span style="padding:18px 44px;border-radius:14px;font-size:26px;background:#6366f1;color:white">Botón primario</span><span style="padding:18px 44px;border-radius:14px;font-size:26px;border:2px solid rgba(244,244,251,0.4)">Botón secundario</span>${pendingPill("define tus componentes")}</div>`),
    mk("06 — Retícula y espaciado", `<div style="display:flex;gap:16px;margin-top:24px;align-items:flex-end">${[8, 16, 24, 32, 48, 64].map(step => `<div style="text-align:center"><div style="width:96px;height:${step * 2}px;background:rgba(99,102,241,0.5);border-radius:8px"></div><div style="margin-top:10px;font-size:20px;color:rgba(244,244,251,0.55)">${step}</div></div>`).join("")}</div>`),
    mk("07 — Fotografía e ilustración", `<div style="margin:24px 0;display:flex;gap:24px"><div style="flex:1;height:280px;border-radius:20px;border:1px dashed rgba(244,244,251,0.35);display:flex;align-items:center;justify-content:center;color:rgba(244,244,251,0.5);font-size:24px">Estilo fotográfico pendiente</div><div style="flex:1;height:280px;border-radius:20px;border:1px dashed rgba(244,244,251,0.25);display:flex;align-items:center;justify-content:center;color:rgba(244,244,251,0.4);font-size:24px">Ilustración pendiente</div></div>`),
    mk("08 — Do & Don't", `<div style="display:flex;gap:32px;margin-top:24px"><div style="flex:1;padding:28px;border-radius:20px;border:2px solid rgba(74,222,128,0.6)"><div style="font-size:30px;margin-bottom:12px">✅ Hacer</div><div style="font-size:22px;color:rgba(244,244,251,0.6)">Describe aquí los usos correctos de la marca.</div></div><div style="flex:1;padding:28px;border-radius:20px;border:2px solid rgba(248,113,113,0.6)"><div style="font-size:30px;margin-bottom:12px">🚫 No hacer</div><div style="font-size:22px;color:rgba(244,244,251,0.6)">Describe aquí lo que nunca debe hacerse.</div></div></div>`),
  ] as DesignTemplate["frames"];
}

/** Seed for the Plantillas file: a single instructions frame. Curated frames
 *  are appended by add_frame_to_brand (collection=plantillas). */
export function seedPlantillasFrames(brandName: string): DesignTemplate["frames"] {
  return [{
    id: `frame_${uuid().slice(0, 12)}`,
    name: "00 — Cómo usar plantillas",
    x: 0, y: 0, width: W, height: H,
    html: frameShell(brandName, "00", "Plantillas de marca", `<div style="margin-top:16px;max-width:1100px;font-size:28px;line-height:1.6;color:rgba(244,244,251,0.7)">Este archivo reúne los frames que marques como plantilla de la marca. Los frames originales <b>nunca salen</b> de sus archivos: aquí viven copias con el formato «{original} — de {archivo}». El batchamator clona estas plantillas para producir series.</div><div style="margin-top:28px">${pendingPill("Marca frames con «Guardar como plantilla de marca» o pídeselo a tu IA")}</div>`),
    css: "",
  }] as DesignTemplate["frames"];
}

/** V-frames: the Communication file's render of strategyJson. Regenerated on
 *  every strategy save — V-frames are excluded from visual extraction. */
export function generateStrategyFrames(brandName: string, strategyJson: string | null | undefined): DesignTemplate["frames"] {
  const s = emptyStrategy(safeParse(strategyJson));
  const essence = emptyStrategy(s.essence);
  const tone = emptyStrategy(s.tone);
  const axes = emptyStrategy(tone.axes);
  const voice = emptyStrategy(s.voice);
  const list = (value: unknown, fallback: string) => Array.isArray(value) && value.length
    ? (value as string[]).map(item => `<li style="margin:6px 0">${item}</li>`).join("")
    : `<li style="margin:6px 0;color:rgba(244,244,251,0.45)">${fallback}</li>`;

  const essenceInner = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:8px">
      ${[["Misión", essence.mission], ["Visión", essence.vision], ["Propuesta de valor", essence.valueProposition], ["Posicionamiento", essence.positioning]]
        .map(([label, value]) => `<div style="padding:26px;border-radius:18px;background:rgba(255,255,255,0.04)"><div style="font-size:20px;letter-spacing:3px;text-transform:uppercase;color:#6366f1;margin-bottom:12px">${label}</div><div style="font-size:26px;line-height:1.5">${value || "pendiente"}</div></div>`).join("")}
    </div>
    <div style="margin-top:24px;font-size:24px;color:rgba(244,244,251,0.6)">Valores: ${Array.isArray(essence.values) && essence.values.length ? essence.values.join(" · ") : "pendiente"}</div>`;

  const toneInner = `
    <div style="margin-top:16px;display:flex;flex-direction:column;gap:22px;max-width:1200px">
      ${TONE_AXES.map(axis => {
        const value = typeof axes[axis] === "number" ? axes[axis] as number : null;
        return `<div><div style="display:flex;justify-content:space-between;font-size:22px;margin-bottom:8px"><span style="text-transform:capitalize">${axis}</span><span style="color:rgba(244,244,251,0.5)">${value === null ? "pendiente" : `${value}/100`}</span></div><div style="height:14px;border-radius:999px;background:rgba(255,255,255,0.08)"><div style="height:100%;width:${value ?? 0}%;border-radius:999px;background:#6366f1"></div></div></div>`;
      }).join("")}
    </div>
    <div style="margin-top:26px;font-size:24px;color:rgba(244,244,251,0.6)">Habla de «${tone.person || "tú"}» · Emojis: ${tone.emojiPolicy || "pendiente"}</div>`;

  const voiceInner = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px;margin-top:8px">
      <div style="padding:26px;border-radius:18px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.35)"><div style="font-size:22px;margin-bottom:12px">✅ Sí usar</div><ul style="font-size:22px;line-height:1.5;padding-left:22px">${list(voice.vocabularyYes, "define tu vocabulario")}</ul></div>
      <div style="padding:26px;border-radius:18px;background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.35)"><div style="font-size:22px;margin-bottom:12px">🚫 Evitar</div><ul style="font-size:22px;line-height:1.5;padding-left:22px">${list(voice.vocabularyNo, "define qué no se dice")}</ul></div>
      <div style="padding:26px;border-radius:18px;background:rgba(255,255,255,0.04)"><div style="font-size:22px;margin-bottom:12px">🎯 CTAs</div><ul style="font-size:22px;line-height:1.5;padding-left:22px">${list(voice.ctaPatterns, "define tus llamados a la acción")}</ul></div>
    </div>`;

  const mk = (name: string, inner: string) => ({
    id: `frame_${uuid().slice(0, 12)}`,
    name, x: 0, y: 0, width: W, height: H,
    html: frameShell(brandName, name.split("—")[0].trim(), name.split("—")[1]?.trim() || name, inner),
    css: "",
  });

  return [
    mk("V-01 — Esencia", essenceInner),
    mk("V-02 — Tono", toneInner),
    mk("V-03 — Voz", voiceInner),
  ] as DesignTemplate["frames"];
}

// ─── Container file management ────────────────────────────────────────────

async function setKindColumn(templateId: string, kind: ContainerKind): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("templates").update({ brand_container_kind: kind }).eq("id", templateId);
  if (error) console.warn(`[brandContainer] kind column write failed (${templateId}):`, error.message);
}

export function containerFileName(brandName: string, kind: Exclude<ContainerKind, "ds">): string {
  return kind === "plantillas" ? `${brandName} — Plantillas` : `${brandName} — Comunicación`;
}

type ContainerRef = { id: string; kind: ContainerKind };

/** Find live container files for a brand (kind column first, data fallback). */
export async function findContainers(workspaceId: string, brandId: string): Promise<ContainerRef[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("templates")
      .select("id, brand_container_kind, brandId:data->>brandId")
      .eq("workspace_id", workspaceId)
      .in("brand_container_kind", [...CONTAINER_KINDS])
      .is("deleted_at", null);
    if (!error && data) {
      return (data as any[])
        .filter(row => row.brandId === brandId)
        .map(row => ({ id: row.id, kind: row.brand_container_kind as ContainerKind }));
    }
  }
  // Local fallback: scan the paginated list by canonical file names.
  const { data } = await listTemplatesPaginated(200, 0, workspaceId);
  const known = new Set([brandId]);
  return (data || [])
    .filter((t: any) => t.brandId && known.has(t.brandId) && (CONTAINER_KINDS as readonly string[]).includes(t.brandContainerKind))
    .map((t: any) => ({ id: t.id, kind: t.brandContainerKind as ContainerKind }));
}

async function createContainerFile(brand: BrandGuideline, kind: Exclude<ContainerKind, "ds">, userId?: string): Promise<string> {
  const name = containerFileName(brand.name, kind);
  const tpl = await createTemplate(name, W, H, undefined, userId || "system", brand.workspaceId);
  const frames = kind === "plantillas"
    ? seedPlantillasFrames(brand.name)
    : generateStrategyFrames(brand.name, brand.strategyJson);
  await updateTemplate(tpl.id, {
    isBrandManual: true,
    brandId: brand.id,
    brandContainerKind: kind,
    frames,
  } as any);
  await setKindColumn(tpl.id, kind);
  return tpl.id;
}

/** Make sure all three container files exist for the brand. Idempotent —
 *  safe to call on every brand creation, restore or before curation. */
export async function ensureBrandContainerFiles(brand: BrandGuideline, userId?: string): Promise<BrandContainerInfo> {
  const info: BrandContainerInfo = {
    designSystemTemplateId: brand.designSystemTemplateId,
    plantillasTemplateId: undefined,
    communicationTemplateId: undefined,
    createdPlantillas: false,
    createdCommunication: false,
  };
  try {
    // Normalize the DS file: kind column + skeleton when it was born empty.
    if (brand.designSystemTemplateId) {
      const ds = await getTemplate(brand.designSystemTemplateId);
      if (ds) {
        const updates: Record<string, unknown> = {};
        if (!ds.brandContainerKind) updates.brandContainerKind = "ds";
        if ((!ds.frames || ds.frames.length === 0)) updates.frames = seedDsFrames(brand.name, brand.tokensJson);
        if (Object.keys(updates).length) {
          await updateTemplate(ds.id, { ...updates, isBrandManual: true, brandId: brand.id } as any);
          await setKindColumn(ds.id, "ds");
        }
      }
    }
    const existing = await findContainers(brand.workspaceId, brand.id);
    for (const ref of existing) {
      if (ref.kind === "plantillas") info.plantillasTemplateId = ref.id;
      if (ref.kind === "communication") info.communicationTemplateId = ref.id;
    }
    if (!info.plantillasTemplateId) {
      info.plantillasTemplateId = await createContainerFile(brand, "plantillas", userId);
      info.createdPlantillas = true;
    }
    if (!info.communicationTemplateId) {
      info.communicationTemplateId = await createContainerFile(brand, "communication", userId);
      info.createdCommunication = true;
    }
  } catch (error) {
    // Containers are best-effort: brand creation never fails because of them.
    console.warn("[brandContainer] ensure failed:", (error as Error).message);
  }
  // The whole brand vault (marca, crm, ds, plantillas, estrategia,
  // copywriting + personas) regenerates idempotently — human blocks survive.
  await emitBrandVault(brand.workspaceId, brand.id).catch(() => { /* brain notes are best-effort */ });
  return info;
}

// ─── Token diff + proposals (merge proposals, deterministic) ──────────────

export type TokenDecision = { path: string; action: "use" | "keep" | "combine"; value?: unknown };
export type TokenDiff = {
  added: Array<{ path: string; value: unknown }>;
  removed: Array<{ path: string; value: unknown }>;
  changed: Array<{ path: string; current: unknown; incoming: unknown }>;
};

function flattenLeaves(doc: unknown): Map<string, TokenLeaf> {
  return new Map(walkTokens(doc).map(leaf => [leaf.path, leaf]));
}

/** Deterministic diff between the brand's saved tokens and an incoming
 *  tokens document. `added`/`removed`/`changed` feed the merge proposal. */
export function diffTokens(prevJson: string | null | undefined, nextJson: string): TokenDiff {
  const prev = flattenLeaves(safeParse(prevJson) || {});
  const next = flattenLeaves(safeParse(nextJson) || {});
  const diff: TokenDiff = { added: [], removed: [], changed: [] };
  for (const [path, leaf] of next) {
    const current = prev.get(path);
    if (!current) diff.added.push({ path, value: leaf.value });
    else if (JSON.stringify(current.value) !== JSON.stringify(leaf.value)) {
      diff.changed.push({ path, current: current.value, incoming: leaf.value });
    }
  }
  for (const [path, leaf] of prev) {
    if (!next.has(path)) diff.removed.push({ path, value: leaf.value });
  }
  return diff;
}

/** Default proposal: everything incoming is suggested; the human or the IA
 *  answers with resolve_brand_token_proposal decisions. */
export function buildTokenProposal(diff: TokenDiff): TokenDecision[] {
  return [
    ...diff.added.map(item => ({ path: item.path, action: "use" as const, value: item.value })),
    ...diff.changed.map(item => ({ path: item.path, action: "use" as const, value: item.incoming })),
  ];
}

function setByPath(root: any, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!node[parts[i]] || typeof node[parts[i]] !== "object") node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = { $type: "unknown", $value: value };
}

function removeByPath(root: any, path: string): void {
  const parts = path.split(".");
  let node = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!node[parts[i]] || typeof node[parts[i]] !== "object") return;
    node = node[parts[i]];
  }
  delete node[parts[parts.length - 1]];
}

export type AppliedTokenDecisions = {
  tokensJson: string;
  applied: number;
  fingerprint?: string;
};

/** Apply human/IA decisions ("use" = take incoming, "keep" = keep current,
 *  "combine" = add as a new token next to the current one). */
export async function applyTokenDecisions(
  prevJson: string | null | undefined,
  incomingJson: string,
  decisions: TokenDecision[],
): Promise<AppliedTokenDecisions> {
  const prevDoc = safeParse(prevJson) || {};
  const prev = flattenLeaves(prevDoc);
  const next = flattenLeaves(safeParse(incomingJson) || {});
  const doc: any = JSON.parse(JSON.stringify(prevDoc));
  let applied = 0;

  for (const decision of decisions) {
    const incoming = next.get(decision.path);
    const current = prev.get(decision.path);
    if (decision.action === "use" && incoming) {
      setByPath(doc, decision.path, incoming.value);
      applied += 1;
    } else if (decision.action === "keep" && current) {
      applied += 1; // nothing to write — kept
    } else if (decision.action === "combine" && incoming) {
      setByPath(doc, `${decision.path}.alternativa`, incoming.value);
      applied += 1;
    } else if (decision.action === "keep" && !current && decision.value !== undefined) {
      setByPath(doc, decision.path, decision.value);
      applied += 1;
    }
  }

  const tokensJson = JSON.stringify(doc, null, 2);
  let fingerprint: string | undefined;
  try {
    const mod = await import("../../../netlify/functions/design-extractor.mjs") as any;
    fingerprint = mod.computeFingerprintFromTokensJson(tokensJson);
  } catch {
    // Fingerprint is enrichment, not a requirement.
  }
  return { tokensJson, applied, fingerprint };
}
