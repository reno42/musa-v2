/**
 * REQ-053 — ampliar el subconjunto editable de MotionSpec (lógica pura).
 *
 * Fases cubiertas acá (el wiring vive en el compilador standalone
 * `api/src/services/motionProjectCompiler.ts` y en los shims MCP — archivos
 * en edición por otra sesión; la integración queda documentada en
 * docs/requirements/REQ-053):
 *
 *  - F4 Transiciones standalone: `type` valida contra `shared/videoEffectsCatalog.ts`
 *    (los 35 ids únicos, misma fuente que los DOS renderers) y los params pasan
 *    por `sanitizeTransitionParams` — cero geometría nueva, paridad gratis.
 *  - F1 Geometría animable: validadores de `clipPath/width/height/top/left`
 *    (unidades, rangos, formas de clip-path acotadas). El compilador decide
 *    cuándo habilitarlas; acá solo se admite lo que ambos renderers aplican
 *    igual (ya viven en `ANIMATION_PROPS` del schema).
 *  - F5 Efectos tipados: `fx-lut` → LOOKS (intensidad 0..1 → css(intensity)),
 *    `fx-overlay` → OVERLAY_FX, `fx-text-anim` → TEXT_ANIMS — params del
 *    catálogo, no css crudo.
 *
 * Honesty rules (mismo contrato que el resto del arnés):
 *  - Funciones puras, sin DOM ni I/O — node-testable.
 *  - Nunca lanza: toda entrada malformada vuelve como issue estructurado.
 *  - Determinista: misma entrada → misma salida (re-apply idempotente).
 *  - Clamps nunca rechazan el spec entero salvo desconocidos (ahí el error
 *    lista los ids válidos — accionable por la IA).
 */

import {
  TRANSITIONS,
  transitionDef,
  sanitizeTransitionParams,
  LOOKS,
  OVERLAY_FX,
  TEXT_ANIMS,
  type TransitionParams,
} from "./videoEffectsCatalog.ts";

export interface SubsetIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

const asObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

// ── F4 — Transiciones standalone desde el catálogo ───────────────────────

export interface NormalizedTransition {
  id: string;
  /** Uno de los 35 ids de TRANSITIONS — la única fuente de verdad. */
  type: string;
  durationMs: number;
  fromNodeId?: string;
  toNodeId?: string;
  /** Saneados: clamped a los rangos del catálogo, claves desconocidas fuera. */
  params?: TransitionParams;
}

export interface SpecTransitionsResult {
  transitions: NormalizedTransition[];
  issues: SubsetIssue[];
}

/**
 * Normaliza `$.transitions[]` del spec contra el catálogo. Aceptación F4:
 * un id desconocido devuelve error que lista los ids válidos; params fuera
 * de rango se clampan (nunca se rechaza el spec entero).
 */
export function validateSpecTransitions(
  raw: unknown,
  opts: { knownNodeIds?: Set<string>; canvasDurationMs?: number; maxTransitions?: number } = {},
): SpecTransitionsResult {
  const issues: SubsetIssue[] = [];
  const out: NormalizedTransition[] = [];
  const items = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const max = opts.maxTransitions ?? 200;
  if (items.length > max) {
    issues.push({ severity: "error", code: "TRANSITION_LIMIT", path: "$.transitions", message: `Máximo ${max} transiciones.` });
  }
  const usedIds = new Set<string>();
  const validIds = TRANSITIONS.map(t => t.id).join(", ");

  items.slice(0, max).forEach((item, index) => {
    const path = `$.transitions[${index}]`;
    const o = asObj(item);
    if (!o) {
      issues.push({ severity: "error", code: "TRANSITION_INVALID", path, message: "La transición debe ser un objeto." });
      return;
    }
    let id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : `transition-${index}`;
    while (usedIds.has(id)) id = `${id}+`;
    usedIds.add(id);

    const type = typeof o.type === "string" ? o.type.trim() : "";
    if (!type) {
      issues.push({ severity: "error", code: "TRANSITION_TYPE_REQUIRED", path: `${path}.type`, message: "La transición requiere type." });
      return;
    }
    const def = transitionDef(type);
    if (!def) {
      issues.push({ severity: "error", code: "TRANSITION_UNKNOWN", path: `${path}.type`, message: `Transición desconocida: ${type}. Ids válidos: ${validIds}.` });
      return;
    }

    const from = typeof o.fromNodeId === "string" && o.fromNodeId.trim() ? o.fromNodeId.trim() : undefined;
    const to = typeof o.toNodeId === "string" && o.toNodeId.trim() ? o.toNodeId.trim() : undefined;
    if (from && opts.knownNodeIds && !opts.knownNodeIds.has(from)) {
      issues.push({ severity: "error", code: "TRANSITION_FROM_MISSING", path: `${path}.fromNodeId`, message: `No existe el nodo ${from}.` });
      return;
    }
    if (to && opts.knownNodeIds && !opts.knownNodeIds.has(to)) {
      issues.push({ severity: "error", code: "TRANSITION_TO_MISSING", path: `${path}.toNodeId`, message: `No existe el nodo ${to}.` });
      return;
    }

    const defMs = Math.round(def.durationSec * 1_000);
    const cap = Math.max(1, Math.min(30_000, opts.canvasDurationMs ?? 30_000));
    let durationMs = typeof o.durationMs === "number" && Number.isFinite(o.durationMs) ? Math.round(o.durationMs) : defMs;
    if (durationMs < 1) durationMs = defMs;
    if (durationMs > cap) {
      issues.push({ severity: "warning", code: "TRANSITION_DURATION_CLAMPED", path: `${path}.durationMs`, message: `durationMs ${durationMs} se recorta a ${cap} (duración del canvas).` });
      durationMs = cap;
    }

    const rawParams = asObj(o.params) as TransitionParams | null;
    const params = sanitizeTransitionParams(type, rawParams);
    if (rawParams) {
      const kept = new Set(def.params?.map(p => p.key) ?? []);
      const dropped = Object.keys(rawParams).filter(k => !kept.has(k));
      if (dropped.length) {
        issues.push({ severity: "warning", code: "TRANSITION_PARAMS_DROPPED", path: `${path}.params`, message: `Claves fuera del catálogo se descartan: ${dropped.join(", ")}.` });
      }
    }

    const transition: NormalizedTransition = { id, type, durationMs };
    if (from) transition.fromNodeId = from;
    if (to) transition.toNodeId = to;
    if (params) transition.params = params;
    out.push(transition);
  });

  return { transitions: out, issues };
}

/** Payload para la futura tool de catálogo (y para el error de id desconocido). */
export function motionTransitionCatalogPayload(): Record<string, unknown> {
  return {
    transitions: TRANSITIONS.map(t => ({
      id: t.id,
      family: t.family,
      label: t.label,
      durationMs: Math.round(t.durationSec * 1_000),
      params: "params" in t ? t.params : [],
    })),
    note: "type valida contra estos ids; los params se clampan a los rangos declarados — nunca se rechaza el spec por un valor fuera de rango.",
  };
}

// ── F1 — Geometría animable ─────────────────────────────────────────────

export const GEOMETRY_PROPS = ["clipPath", "width", "height", "top", "left"] as const;
export type GeometryProp = (typeof GEOMETRY_PROPS)[number];

/** Formas de clip-path admitidas: las que los dos renderers resuelven igual.
 *  Sin url()/var()/calc()/attr() — cualquier función desconocida rechaza. */
const CLIP_PATH_SHAPE = /^none$|^(inset|circle|ellipse|polygon)\(([-\d.,%\sa-z]*)\)$/i;
const CLIP_PATH_FORBIDDEN = /\b(url|var|calc|attr|env|image|gradient)\s*\(/i;
const LENGTH_UNIT = /^(-?[\d.]+)(px|%)?$/;

export interface GeometryValueResult {
  ok: boolean;
  /** Valor normalizado: número px, "N%" o el clip-path saneado. */
  value?: number | string;
  issue?: SubsetIssue;
}

/** Valida y normaliza UNA propiedad geométrica del spec (REQ-053 F1). */
export function validateGeometryValue(prop: GeometryProp, value: unknown, path = "$"): GeometryValueResult {
  const fail = (code: string, message: string): GeometryValueResult => ({ ok: false, issue: { severity: "error", code, path: `${path}.${prop}`, message } });

  if (prop === "clipPath") {
    if (value === "none") return { ok: true, value: "none" };
    if (typeof value !== "string") return fail("GEOMETRY_INVALID", "clipPath debe ser un string (inset/circle/ellipse/polygon o none).");
    if (CLIP_PATH_FORBIDDEN.test(value)) return fail("GEOMETRY_CLIP_UNSAFE", "clipPath con funciones no permitidas (url/var/calc/attr/…): solo inset, circle, ellipse, polygon o none.");
    if (!CLIP_PATH_SHAPE.test(value.trim())) return fail("GEOMETRY_INVALID", "clipPath malformado: usa inset(...), circle(...), ellipse(...), polygon(...) o none.");
    return { ok: true, value: value.trim() };
  }

  // width/height/top/left: número px o "Npx"/"N%".
  let n: number;
  let unit: string | undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    n = value;
  } else if (typeof value === "string") {
    const m = value.trim().match(LENGTH_UNIT);
    if (!m) return fail("GEOMETRY_INVALID", `${prop} debe ser un número px o un string "Npx"/"N%" (llegó "${value}").`);
    n = Number(m[1]);
    unit = m[2];
  } else {
    return fail("GEOMETRY_INVALID", `${prop} debe ser número px o "Npx"/"N%".`);
  }
  if (!Number.isFinite(n)) return fail("GEOMETRY_INVALID", `${prop} no es finito.`);
  if ((prop === "width" || prop === "height") && n < 0) return fail("GEOMETRY_NEGATIVE", `${prop} no puede ser negativo.`);
  if (unit === "%") return { ok: true, value: `${n}%` };
  return { ok: true, value: n };
}

/** Payload del subconjunto ampliado para tools/list y documentación. */
export function motionSubsetPropsPayload(): Record<string, unknown> {
  return {
    geometryProps: GEOMETRY_PROPS,
    note: "width/height/top/left aceptan número px o \"Npx\"/\"N%\" (width/height sin negativos); clipPath solo inset/circle/ellipse/polygon/none — el preview y el export los resuelven con el mismo resolver del schema.",
  };
}

// ── F5 — Efectos tipados del catálogo ───────────────────────────────────

export type SpecEffectKind = "look" | "overlay" | "text-anim";

export interface ResolvedSpecEffect {
  kind: SpecEffectKind;
  /** Id dentro de su familia del catálogo. */
  catalogId: string;
  params: Record<string, number | string>;
  /** Solo looks: el filter string EXACTO que preview y export aplican. */
  cssFilter?: string;
}

export interface SpecEffectResult {
  resolved?: ResolvedSpecEffect;
  issues: SubsetIssue[];
}

const EFFECT_KINDS: Record<string, SpecEffectKind> = {
  "fx-lut": "look",
  "fx-overlay": "overlay",
  "fx-text-anim": "text-anim",
};

const clamp01 = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(1, Math.max(0, n));
};

/**
 * Resuelve UN efecto del spec contra su familia del catálogo (REQ-053 F5).
 * Params fuera de rango se clampan; id desconocido es error con lista.
 * El css de un look sale de la MISMA función `css(intensity)` que usan el
 * picker del editor y el export — paridad por construcción.
 */
export function resolveSpecEffect(effectId: unknown, rawParams: unknown, path = "$.effects"): SpecEffectResult {
  const issues: SubsetIssue[] = [];
  const id = typeof effectId === "string" ? effectId.trim() : "";
  const kind = EFFECT_KINDS[id];
  if (!kind) {
    return { issues: [{ severity: "error", code: "EFFECT_UNKNOWN", path: `${path}.effectId`, message: `Efecto desconocido: ${id || "(vacío)"}. Families válidas: ${Object.keys(EFFECT_KINDS).join(", ")}.` }] };
  }
  const params = asObj(rawParams) ?? {};

  if (kind === "look") {
    const lookId = typeof params.look === "string" ? params.look.trim() : "none";
    const look = LOOKS.find(l => l.id === lookId);
    if (!look) {
      return { issues: [{ severity: "error", code: "EFFECT_LOOK_UNKNOWN", path: `${path}.params.look`, message: `Look desconocido: ${lookId}. Ids válidos: ${LOOKS.map(l => l.id).join(", ")}.` }] };
    }
    const intensity = clamp01(params.intensity, 1);
    const resolved: ResolvedSpecEffect = {
      kind,
      catalogId: look.id,
      params: { look: look.id, intensity },
      cssFilter: look.css(intensity),
    };
    if (look.id === "none") {
      issues.push({ severity: "warning", code: "EFFECT_NOOP", path, message: "look=none no aplica filter (identidad) — considera omitir el efecto." });
    }
    return { resolved, issues };
  }

  if (kind === "overlay") {
    const overlayId = typeof params.overlay === "string" ? params.overlay.trim() : "";
    const overlay = OVERLAY_FX.find(o => o.id === overlayId);
    if (!overlay) {
      return { issues: [{ severity: "error", code: "EFFECT_OVERLAY_UNKNOWN", path: `${path}.params.overlay`, message: `Overlay desconocido: ${overlayId || "(vacío)"}. Ids válidos: ${OVERLAY_FX.map(o => o.id).join(", ")}.` }] };
    }
    return { resolved: { kind, catalogId: overlay.id, params: { overlay: overlay.id } }, issues };
  }

  const animId = typeof params.anim === "string" ? params.anim.trim() : "fade";
  const anim = TEXT_ANIMS.find(a => a.id === animId);
  if (!anim) {
    return { issues: [{ severity: "error", code: "EFFECT_TEXT_ANIM_UNKNOWN", path: `${path}.params.anim`, message: `Anim de texto desconocida: ${animId}. Ids válidos: ${TEXT_ANIMS.map(a => a.id).join(", ")}.` }] };
  }
  return { resolved: { kind, catalogId: anim.id, params: { anim: anim.id } }, issues };
}

/** Payload del vocabulario de efectos para tools/list. */
export function motionEffectsPayload(): Record<string, unknown> {
  return {
    effects: [
      { effectId: "fx-lut", params: { look: `LOOKS id (${LOOKS.length} disponibles)`, intensity: "0..1, default 1 (se clampea)" } },
      { effectId: "fx-overlay", params: { overlay: `OVERLAY_FX id (${OVERLAY_FX.map(o => o.id).join("|")})` } },
      { effectId: "fx-text-anim", params: { anim: `TEXT_ANIMS id (${TEXT_ANIMS.length} disponibles)` } },
    ],
    note: "Los params salen del catálogo compartido con el editor — nada de css crudo.",
  };
}
