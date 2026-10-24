/**
 * MusaSceneSpec v1 — contrato declarativo de escenas 3D para video (REQ-052).
 *
 * paralelo a shared/motionSpec.ts: el arnés genera JSON, el harness NUNCA
 * evalúa código. La escena vive en las mismas tablas musa_video_* como un
 * material kind=scene por referencia (sceneSpecId); el render es 100% del
 * navegador (WebGL2), porque los Workers free no tienen CPU para rasterizar.
 *
 * Invariantes duras:
 *   · sampleSceneAt es EL ÚNICO sampler: preview y export observan exactamente
 *     el mismo resultado para el mismo (spec, timeMs) — cero drift por diseño.
 *   · Las partículas son closed-form (mulberry32 seed × índice × t): no hay
 *     estado acumulado que pueda divergir entre preview y export.
 *   · Todo lo que el renderer no soporta (bloom, GLB por URL, texturas) se
 *     PERSISTE y se REPORTA en fidelity.unsupported — jamás se degrada en
 *     silencio.
 *   · seed, lightType, mode y primitivas son estáticos adrede: animarlos
 *     cambiaría el mapeado determinista de partículas/luces y rompe la
 *     paridad preview/export.
 */

export const MUSA_SCENE_SPEC_VERSION = "1.0";

export const SCENE_NODE_KINDS = ["camera", "light", "mesh", "text3d", "particles"] as const;
export type SceneNodeKind = (typeof SCENE_NODE_KINDS)[number];

export const SCENE_PRIMITIVES = ["box", "sphere", "plane", "cylinder", "cone", "torus", "glb"] as const;
export type ScenePrimitive = (typeof SCENE_PRIMITIVES)[number];

export const SCENE_EDITABILITIES = ["editable", "atomic", "baked", "unsupported"] as const;
export type SceneEditability = (typeof SCENE_EDITABILITIES)[number];

export const SCENE_LIGHT_TYPES = ["directional", "point", "ambient"] as const;
export type SceneLightType = (typeof SCENE_LIGHT_TYPES)[number];

export const SCENE_PARTICLE_MODES = ["fountain", "snow", "orbit"] as const;
export type SceneParticleMode = (typeof SCENE_PARTICLE_MODES)[number];

export const SCENE_EFFECT_TYPES = ["bloom", "vignette", "grain", "dof"] as const;
export type SceneEffectType = (typeof SCENE_EFFECT_TYPES)[number];

export type SceneSourceKind = "musa" | "musa-js" | "three-manifest-subset";

export const SCENE_EASINGS = ["linear", "ease-in", "ease-out", "ease-in-out"] as const;
export type SceneEasing = (typeof SCENE_EASINGS)[number];

export interface SceneAsset {
  id: string;
  kind: "glb" | "texture";
  url: string;
}

export interface SceneNode {
  id: string;
  kind: SceneNodeKind;
  name?: string;
  visible?: boolean;
  editability?: SceneEditability;
  /** mesh */
  primitive?: ScenePrimitive;
  assetId?: string;
  color?: string;
  metalness?: number;
  roughness?: number;
  /** light */
  lightType?: SceneLightType;
  /** text3d */
  text?: string;
  textColor?: string;
  billboard?: boolean;
  /** particles */
  mode?: SceneParticleMode;
  seed?: number;
  /** valores numéricos por nodo; las claves whitelisteadas viven en
   *  PROPS_BY_KIND y son las únicas que keyframes/variables pueden tocar */
  props?: Record<string, number>;
}

export interface SceneKeyframe {
  nodeId: string;
  prop: string;
  tMs: number;
  value: number;
  easing?: SceneEasing;
}

export interface SceneEffect {
  id: string;
  type: SceneEffectType;
  params?: Record<string, unknown>;
}

export type SceneVariableTarget =
  | { nodeId: string; prop: string }
  | { canvas: true; prop: "background" };

export interface SceneVariable {
  id: string;
  label?: string;
  type: "number" | "color" | "boolean" | "select";
  default: number | string | boolean;
  min?: number;
  max?: number;
  options?: string[];
  target: SceneVariableTarget;
}

export interface MusaSceneSpec {
  version: string;
  id?: string;
  name?: string;
  canvas: {
    width: number;
    height: number;
    fps: number;
    durationMs: number;
    background: string;
  };
  assets: SceneAsset[];
  nodes: SceneNode[];
  keyframes: SceneKeyframe[];
  effects: SceneEffect[];
  variables: SceneVariable[];
}

export interface SceneIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface SceneUnsupportedItem {
  path: string;
  reason: string;
}

export interface SceneFidelityReport {
  issues: SceneIssue[];
  unsupported: SceneUnsupportedItem[];
}

export interface SceneSpecValidationResult {
  valid: boolean;
  spec: MusaSceneSpec | null;
  issues: SceneIssue[];
  fidelity: SceneFidelityReport;
  fingerprint: string | null;
}

export interface SceneApplyPlan {
  sceneSpecId: string;
  canvas: MusaSceneSpec["canvas"];
  track: { id: string; type: string; zOrder: number };
  material: { id: string; kind: "scene"; nodeId: string; payload: Record<string, unknown> };
  segment: {
    id: string;
    nodeId: string;
    trackId: string;
    materialId: string;
    targetStartUs: number;
    targetDurUs: number;
    clip: null;
  };
  bindings: Array<{
    nodeId: string;
    nodeKind: string;
    entityKind: "track" | "material" | "segment";
    entityId: string;
    editability: SceneEditability;
    metadata?: Record<string, unknown>;
  }>;
  unsupported: SceneUnsupportedItem[];
}

export interface SceneSpecDiff {
  changed: boolean;
  canvasChanged: boolean;
  addedNodes: string[];
  removedNodes: string[];
  changedProps: Array<{ nodeId: string; prop: string }>;
  keyframesChanged: boolean;
  assetsChanged: boolean;
  variablesChanged: boolean;
}

// ── Límites (GPU-sanos, freemium-friendly) ─────────────────────────────────

export const SCENE_LIMITS = {
  maxNodes: 512,
  maxLights: 8,
  maxMeshes: 256,
  maxParticlesPerNode: 20_000,
  maxKeyframes: 8_000,
  maxAssets: 64,
  maxEffects: 32,
  maxVariables: 64,
  maxTextLen: 4_000,
  maxCanvasSize: 4_096,
  minCanvasSize: 16,
  maxDurationMs: 600_000,
  minDurationMs: 100,
  maxFps: 60,
  payloadBytes: 65_536,
};

// El harness nunca guarda código ejecutable dentro de una escena. Estas claves
// (en cualquier nivel del JSON) indican HTML/JS/GLSL/WASM y se rechazan.
const FORBIDDEN_SOURCE_KEYS = new Set([
  "script", "scripts", "javascript", "js", "jsx", "tsx", "html", "htm", "css",
  "glsl", "shader", "shaders", "wasm", "eval", "import", "require", "function",
]);

// ── Whitelists de propiedades por kind ──────────────────────────────────────

const COMMON_3D = ["x", "y", "z", "rx", "ry", "rz", "scale"];

export const PROPS_BY_KIND: Record<SceneNodeKind, Set<string>> = {
  camera: new Set([...COMMON_3D, "tx", "ty", "tz", "fov"]),
  light: new Set([...COMMON_3D, "intensity"]),
  mesh: new Set([...COMMON_3D, "sx", "sy", "sz", "opacity", "metalness", "roughness"]),
  text3d: new Set([...COMMON_3D, "sx", "sy", "sz", "opacity", "quadWidth", "quadHeight", "fontSizePx"]),
  particles: new Set(["x", "y", "z", "opacity", "size", "count", "speed", "spread", "gravity", "drift", "spin", "area"]),
};

// seed/mode/lightType/primitive/assetId/text son ESTÁTICOS por contrato:
// animarlos rompería el mapeado determinista (partículas) o el sampling de
// luces. Solo estas props son keyframeables/variables.
export const KEYABLE_BY_KIND: Record<SceneNodeKind, Set<string>> = {
  camera: new Set(["x", "y", "z", "tx", "ty", "tz", "fov"]),
  light: new Set(["x", "y", "z", "intensity"]),
  mesh: new Set([...COMMON_3D, "sx", "sy", "sz", "opacity", "metalness", "roughness"]),
  text3d: new Set([...COMMON_3D, "sx", "sy", "sz", "opacity", "quadWidth", "quadHeight"]),
  particles: new Set(["x", "y", "z", "opacity", "size", "speed", "spread", "gravity", "drift", "spin", "area", "count"]),
};

// Rango duro por propknown: fuera de rango se clampea (mismo criterio de
// normalizar clip transforms en videoProjects.ts).
const PROP_RANGES: Record<string, [number, number]> = {
  x: [-1000, 1000], y: [-1000, 1000], z: [-1000, 1000],
  rx: [-3600, 3600], ry: [-3600, 3600], rz: [-3600, 3600],
  tx: [-1000, 1000], ty: [-1000, 1000], tz: [-1000, 1000],
  fov: [10, 120],
  scale: [0.01, 100], sx: [0.01, 100], sy: [0.01, 100], sz: [0.01, 100],
  opacity: [0, 1], metalness: [0, 1], roughness: [0, 1],
  intensity: [0, 20],
  quadWidth: [0.01, 100], quadHeight: [0.01, 100], fontSizePx: [8, 512],
  size: [1, 64], count: [1, SCENE_LIMITS.maxParticlesPerNode],
  speed: [0.01, 20], spread: [0, 100], gravity: [0, 50], drift: [0, 20],
  spin: [0, 20], area: [0.1, 100],
};

const COLOR_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const NODE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ASSET_ID_RE = /^[A-Za-z0-9_-]{3,64}$/;
const VARIABLE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const URL_RE = /^(https?:\/\/|\/)/;

// REQ-052 v2 multi-tenant: los ids del plan NUNCA son globales. Se derivan del
// projectId (fnv1a-8 sobre el dominio "scene-plan:") para que N proyectos de
// escena convivan sin chocar las PKs globales de
// musa_video_tracks/materials/segments. Deterministas: el mismo proyecto
// regenera siempre los mismos ids → re-aplicar sigue siendo upsert limpio.
export function sceneGeneratedIds(projectId: string): {
  trackId: string;
  materialId: string;
  segmentId: string;
} {
  const suffix = fnv1a(`scene-plan:${projectId}`, 0x811c9dc5).slice(0, 8);
  return {
    trackId: `vidtrk_scene_${suffix}`,
    materialId: `vidmat_scene_${suffix}`,
    segmentId: `vidseg_scene_${suffix}`,
  };
}

// ── Hash determinista (fnv1a-64 como ms1-/ss1- en motionSpec) ───────────────

function fnv1a(text: string, seedH: number): string {
  let h1 = seedH >>> 0;
  let h2 = (seedH ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** JSON estable (claves ordenadas) para que dos specs semánticamente
 *  idénticas produzcan el mismo fingerprint. */
export function stableSceneStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableSceneStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableSceneStringify(v)}`).join(",")}}`;
}

export function sceneSpecHash(spec: MusaSceneSpec): string {
  return `ss1-${fnv1a(stableSceneStringify(spec), 0x811c9dc5)}`;
}

/** scenespec_<hash16> — o el id explícito si ya valida (re-aplicaciones
 *  estables). La forma corta es la que persiste en material.payload. */
export function resolveSceneSpecId(spec: MusaSceneSpec): string {
  if (typeof spec.id === "string" && /^scenespec_[A-Za-z0-9_-]{6,64}$/.test(spec.id)) return spec.id;
  return `scenespec_${fnv1a(stableSceneStringify(spec), 0x811c9dc5).slice(0, 16)}`;
}

// ── Normalización / validación ──────────────────────────────────────────────

function walkForbiddenKeys(value: unknown, path: string, issues: SceneIssue[]): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkForbiddenKeys(item, `${path}[${i}]`, issues));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_SOURCE_KEYS.has(lower)) {
      issues.push({
        severity: "error",
        code: "FORBIDDEN_SOURCE_KEY",
        path: `${path}.${key}`,
        message: `La clave «${key}» indica código ejecutable (HTML/JS/GLSL/WASM). MusaSceneSpec es declarativo: el navegador renderiza, el harness no evalúa.`,
      });
      continue;
    }
    walkForbiddenKeys(child, `${path}.${key}`, issues);
  }
}

const clampNum = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function normalizeProps(
  kind: SceneNodeKind,
  raw: Record<string, unknown> | undefined,
  path: string,
  issues: SceneIssue[],
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  const allowed = PROPS_BY_KIND[kind];
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (!allowed.has(key)) {
      issues.push({ severity: "error", code: "SCENE_PROP_UNKNOWN", path: `${path}.${key}`, message: `La propiedad «${key}» no existe para kind=${kind}. Permitidas: ${[...allowed].join(", ")}.` });
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push({ severity: "error", code: "SCENE_PROP_INVALID", path: `${path}.${key}`, message: `«${key}» debe ser un número finito (recibido: ${JSON.stringify(value)}).` });
      continue;
    }
    const range = PROP_RANGES[key];
    out[key] = range ? clampNum(value, range[0], range[1]) : value;
  }
  return out;
}

function normalizeNode(rawNode: unknown, index: number, seenIds: Set<string>, issues: SceneIssue[]): SceneNode | null {
  const path = `nodes[${index}]`;
  if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
    issues.push({ severity: "error", code: "SCENE_NODE_INVALID", path, message: "Cada nodo debe ser un objeto." });
    return null;
  }
  const raw = rawNode as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!NODE_ID_RE.test(id)) {
    issues.push({ severity: "error", code: "SCENE_NODE_ID_INVALID", path: `${path}.id`, message: "id debe coincidir con [A-Za-z0-9_-]{1,64}." });
    return null;
  }
  if (seenIds.has(id)) {
    issues.push({ severity: "error", code: "SCENE_NODE_DUPLICATE", path: `${path}.id`, message: `id duplicado: ${id}.` });
    return null;
  }
  seenIds.add(id);
  const kind = (typeof raw.kind === "string" ? raw.kind : "") as SceneNodeKind;
  if (!SCENE_NODE_KINDS.includes(kind)) {
    issues.push({ severity: "error", code: "SCENE_NODE_KIND_INVALID", path: `${path}.kind`, message: `kind debe ser uno de: ${SCENE_NODE_KINDS.join(", ")}.` });
    return null;
  }
  const editability = (typeof raw.editability === "string" && SCENE_EDITABILITIES.includes(raw.editability as SceneEditability)
    ? raw.editability
    : "editable") as SceneEditability;
  const node: SceneNode = { id, kind, editability };
  if (typeof raw.name === "string" && raw.name.trim()) node.name = raw.name.trim().slice(0, 120);
  if (typeof raw.visible === "boolean") node.visible = raw.visible;

  if (kind === "mesh") {
    const primitive = (typeof raw.primitive === "string" ? raw.primitive : "box") as ScenePrimitive;
    if (!SCENE_PRIMITIVES.includes(primitive)) {
      issues.push({ severity: "error", code: "SCENE_PRIMITIVE_INVALID", path: `${path}.primitive`, message: `primitive debe ser uno de: ${SCENE_PRIMITIVES.join(", ")}.` });
      return null;
    }
    node.primitive = primitive;
    if (primitive === "glb") {
      node.editability = "atomic";
      if (typeof raw.assetId !== "string" || !raw.assetId) {
        issues.push({ severity: "error", code: "ASSET_REQUIRED", path: `${path}.assetId`, message: "mesh primitive=glb requiere assetId con un asset kind=glb (por referencia, nunca inline)." });
        return null;
      }
      node.assetId = raw.assetId;
    }
    if (typeof raw.color === "string") {
      if (!COLOR_RE.test(raw.color)) {
        issues.push({ severity: "error", code: "SCENE_COLOR_INVALID", path: `${path}.color`, message: `color debe ser hex #rrggbb[aa] (recibido: ${raw.color}).` });
        return null;
      }
      node.color = raw.color;
    }
  }
  if (kind === "light") {
    const lightType = (typeof raw.lightType === "string" ? raw.lightType : "directional") as SceneLightType;
    if (!SCENE_LIGHT_TYPES.includes(lightType)) {
      issues.push({ severity: "error", code: "SCENE_LIGHT_TYPE_INVALID", path: `${path}.lightType`, message: `lightType debe ser uno de: ${SCENE_LIGHT_TYPES.join(", ")}.` });
      return null;
    }
    node.lightType = lightType;
    if (typeof raw.color === "string") {
      if (!COLOR_RE.test(raw.color)) {
        issues.push({ severity: "error", code: "SCENE_COLOR_INVALID", path: `${path}.color`, message: "color de luz debe ser hex." });
        return null;
      }
      node.color = raw.color;
    }
  }
  if (kind === "text3d") {
    if (typeof raw.text !== "string" || !raw.text.trim()) {
      issues.push({ severity: "error", code: "SCENE_TEXT_REQUIRED", path: `${path}.text`, message: "text3d requiere text no vacío." });
      return null;
    }
    if (raw.text.length > SCENE_LIMITS.maxTextLen) {
      issues.push({ severity: "error", code: "SCENE_TEXT_TOO_LONG", path: `${path}.text`, message: `text supera ${SCENE_LIMITS.maxTextLen} caracteres.` });
      return null;
    }
    node.text = raw.text;
    if (typeof raw.textColor === "string") {
      if (!COLOR_RE.test(raw.textColor)) {
        issues.push({ severity: "error", code: "SCENE_COLOR_INVALID", path: `${path}.textColor`, message: "textColor debe ser hex." });
        return null;
      }
      node.textColor = raw.textColor;
    }
    if (typeof raw.billboard === "boolean") node.billboard = raw.billboard;
  }
  if (kind === "particles") {
    const mode = (typeof raw.mode === "string" ? raw.mode : "fountain") as SceneParticleMode;
    if (!SCENE_PARTICLE_MODES.includes(mode)) {
      issues.push({ severity: "error", code: "SCENE_PARTICLE_MODE_INVALID", path: `${path}.mode`, message: `mode debe ser uno de: ${SCENE_PARTICLE_MODES.join(", ")}.` });
      return null;
    }
    node.mode = mode;
    if (typeof raw.seed !== "number" || !Number.isInteger(raw.seed) || raw.seed < 0) {
      issues.push({ severity: "error", code: "PARTICLES_SEED_REQUIRED", path: `${path}.seed`, message: "particles requiere seed entero >= 0: sin semilla no hay mapeado determinista entre preview y export." });
      return null;
    }
    node.seed = raw.seed;
    if (typeof raw.color === "string") {
      if (!COLOR_RE.test(raw.color)) {
        issues.push({ severity: "error", code: "SCENE_COLOR_INVALID", path: `${path}.color`, message: "color de partículas debe ser hex." });
        return null;
      }
      node.color = raw.color;
    }
  }
  node.props = normalizeProps(kind, raw.props as Record<string, unknown> | undefined, `${path}.props`, issues);
  return node;
}

export function normalizeSceneSpec(raw: unknown): SceneSpecValidationResult {
  const issues: SceneIssue[] = [];
  const emptyFidelity: SceneFidelityReport = { issues: [], unsupported: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    issues.push({ severity: "error", code: "SCENE_SPEC_INVALID", path: "", message: "MusaSceneSpec debe ser un objeto JSON." });
    return { valid: false, spec: null, issues, fidelity: emptyFidelity, fingerprint: null };
  }
  const source = raw as Record<string, unknown>;
  walkForbiddenKeys(source, "spec", issues);

  const version = typeof source.version === "string" ? source.version : MUSA_SCENE_SPEC_VERSION;
  if (version !== MUSA_SCENE_SPEC_VERSION) {
    issues.push({ severity: "error", code: "SCENE_VERSION_UNSUPPORTED", path: "version", message: `version «${version}» no soportada; la única es ${MUSA_SCENE_SPEC_VERSION}.` });
  }

  // canvas
  const canvasRaw = (source.canvas && typeof source.canvas === "object" ? source.canvas : {}) as Record<string, unknown>;
  const num = (v: unknown, def: number) => (typeof v === "number" && Number.isFinite(v) ? v : def);
  const width = Math.round(num(canvasRaw.width, 1080));
  const height = Math.round(num(canvasRaw.height, 1920));
  if (width < SCENE_LIMITS.minCanvasSize || width > SCENE_LIMITS.maxCanvasSize || height < SCENE_LIMITS.minCanvasSize || height > SCENE_LIMITS.maxCanvasSize) {
    issues.push({ severity: "error", code: "SCENE_CANVAS_INVALID", path: "canvas", message: `canvas debe estar entre ${SCENE_LIMITS.minCanvasSize} y ${SCENE_LIMITS.maxCanvasSize} px por lado (recibido: ${width}x${height}).` });
  }
  const fps = Math.round(num(canvasRaw.fps, 30));
  if (fps < 1 || fps > SCENE_LIMITS.maxFps) {
    issues.push({ severity: "error", code: "SCENE_FPS_INVALID", path: "canvas.fps", message: `fps debe ser 1..${SCENE_LIMITS.maxFps} (recibido: ${fps}).` });
  }
  const durationMs = Math.round(num(canvasRaw.durationMs, 5_000));
  if (durationMs < SCENE_LIMITS.minDurationMs || durationMs > SCENE_LIMITS.maxDurationMs) {
    issues.push({ severity: "error", code: "SCENE_DURATION_INVALID", path: "canvas.durationMs", message: `durationMs debe ser ${SCENE_LIMITS.minDurationMs}..${SCENE_LIMITS.maxDurationMs} (recibido: ${durationMs}).` });
  }
  let background = typeof canvasRaw.background === "string" ? canvasRaw.background : "#05060a";
  if (!COLOR_RE.test(background)) {
    issues.push({ severity: "error", code: "SCENE_COLOR_INVALID", path: "canvas.background", message: "background debe ser hex #rrggbb[aa]." });
    background = "#05060a";
  }

  // assets
  const assets: SceneAsset[] = [];
  const assetIds = new Set<string>();
  const rawAssets = Array.isArray(source.assets) ? source.assets : [];
  if (rawAssets.length > SCENE_LIMITS.maxAssets) {
    issues.push({ severity: "error", code: "SCENE_ASSETS_LIMIT", path: "assets", message: `máximo ${SCENE_LIMITS.maxAssets} assets.` });
  }
  rawAssets.forEach((rawAsset, i) => {
    const path = `assets[${i}]`;
    if (!rawAsset || typeof rawAsset !== "object" || Array.isArray(rawAsset)) {
      issues.push({ severity: "error", code: "SCENE_ASSET_INVALID", path, message: "asset debe ser un objeto." });
      return;
    }
    const asset = rawAsset as Record<string, unknown>;
    const id = typeof asset.id === "string" ? asset.id.trim() : "";
    if (!ASSET_ID_RE.test(id)) {
      issues.push({ severity: "error", code: "SCENE_ASSET_ID_INVALID", path: `${path}.id`, message: "asset.id debe coincidir con [A-Za-z0-9_-]{3,64}." });
      return;
    }
    if (assetIds.has(id)) {
      issues.push({ severity: "error", code: "SCENE_ASSET_DUPLICATE", path: `${path}.id`, message: `asset.id duplicado: ${id}.` });
      return;
    }
    assetIds.add(id);
    const kind = asset.kind === "texture" ? "texture" : asset.kind === "glb" ? "glb" : null;
    if (!kind) {
      issues.push({ severity: "error", code: "SCENE_ASSET_KIND_INVALID", path: `${path}.kind`, message: "asset.kind debe ser glb|texture." });
      return;
    }
    const url = typeof asset.url === "string" ? asset.url.trim() : "";
    if (!URL_RE.test(url)) {
      issues.push({ severity: "error", code: "SCENE_ASSET_URL_INVALID", path: `${path}.url`, message: "asset.url debe ser http(s) o ruta (los binarios van a Storage por URL, nunca inline)." });
      return;
    }
    assets.push({ id, kind, url });
  });

  // nodes
  const nodes: SceneNode[] = [];
  const seenIds = new Set<string>();
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
  if (!rawNodes.length) {
    issues.push({ severity: "error", code: "SCENE_NODES_REQUIRED", path: "nodes", message: "la escena requiere al menos un nodo." });
  }
  if (rawNodes.length > SCENE_LIMITS.maxNodes) {
    issues.push({ severity: "error", code: "SCENE_NODES_LIMIT", path: "nodes", message: `máximo ${SCENE_LIMITS.maxNodes} nodos (recibidos: ${rawNodes.length}).` });
  }
  rawNodes.forEach((rawNode, i) => {
    const node = normalizeNode(rawNode, i, seenIds, issues);
    if (node) nodes.push(node);
  });

  const cameras = nodes.filter((n) => n.kind === "camera");
  if (cameras.length > 1) {
    issues.push({ severity: "error", code: "SCENE_CAMERA_MULTIPLE", path: "nodes", message: `máximo una cámara por escena (recibidas: ${cameras.length}).` });
  }
  if (cameras.length === 0) {
    issues.push({ severity: "warning", code: "SCENE_CAMERA_DEFAULT", path: "nodes", message: "sin nodo camera: se inyecta la default (0, 0.6, 5 → 0,0,0, fov 50)." });
    nodes.unshift({ id: "camera_default", kind: "camera", editability: "editable", props: {} });
  }
  const lights = nodes.filter((n) => n.kind === "light");
  if (lights.length > SCENE_LIMITS.maxLights) {
    issues.push({ severity: "error", code: "SCENE_LIGHTS_LIMIT", path: "nodes", message: `máximo ${SCENE_LIMITS.maxLights} luces (recibidas: ${lights.length}).` });
  }
  if (!lights.length) {
    issues.push({ severity: "warning", code: "SCENE_LIGHTS_NONE", path: "nodes", message: "sin luces: la escena se ilumina solo con el término ambiente (0.06)." });
  }
  const meshes = nodes.filter((n) => n.kind === "mesh");
  if (meshes.length > SCENE_LIMITS.maxMeshes) {
    issues.push({ severity: "error", code: "SCENE_MESHES_LIMIT", path: "nodes", message: `máximo ${SCENE_LIMITS.maxMeshes} meshes.` });
  }
  for (const mesh of meshes) {
    if (mesh.primitive === "glb" && mesh.assetId && !assetIds.has(mesh.assetId)) {
      issues.push({ severity: "error", code: "ASSET_UNKNOWN", path: `node:${mesh.id}.assetId`, message: `assetId «${mesh.assetId}» no existe en assets[].` });
    }
  }
  for (const node of nodes) {
    if (node.kind === "particles" && typeof node.props?.count === "number" && node.props.count > SCENE_LIMITS.maxParticlesPerNode) {
      issues.push({ severity: "error", code: "SCENE_PARTICLES_LIMIT", path: `node:${node.id}.props.count`, message: `count supera ${SCENE_LIMITS.maxParticlesPerNode}.` });
    }
  }

  // keyframes
  const keyframes: SceneKeyframe[] = [];
  const rawKeyframes = Array.isArray(source.keyframes) ? source.keyframes : [];
  if (rawKeyframes.length > SCENE_LIMITS.maxKeyframes) {
    issues.push({ severity: "error", code: "SCENE_KEYFRAMES_LIMIT", path: "keyframes", message: `máximo ${SCENE_LIMITS.maxKeyframes} keyframes.` });
  }
  rawKeyframes.forEach((rawKf, i) => {
    const path = `keyframes[${i}]`;
    if (!rawKf || typeof rawKf !== "object" || Array.isArray(rawKf)) {
      issues.push({ severity: "error", code: "SCENE_KEYFRAME_INVALID", path, message: "keyframe debe ser un objeto." });
      return;
    }
    const kf = rawKf as Record<string, unknown>;
    const nodeId = typeof kf.nodeId === "string" ? kf.nodeId : "";
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) {
      issues.push({ severity: "error", code: "SCENE_KEYFRAME_NODE_UNKNOWN", path: `${path}.nodeId`, message: `nodeId «${nodeId}» no existe.` });
      return;
    }
    const prop = typeof kf.prop === "string" ? kf.prop : "";
    if (!KEYABLE_BY_KIND[node.kind].has(prop)) {
      issues.push({ severity: "error", code: "SCENE_KEYFRAME_PROP_INVALID", path: `${path}.prop`, message: `«${node.kind}.${prop}» no es animable. Permitidas: ${[...KEYABLE_BY_KIND[node.kind]].join(", ")} (seed/mode/lightType/primitive/text son estáticos por determinismo).` });
      return;
    }
    const tMs = kf.tMs;
    if (typeof tMs !== "number" || !Number.isInteger(tMs) || tMs < 0 || tMs > durationMs) {
      issues.push({ severity: "error", code: "SCENE_KEYFRAME_T_INVALID", path: `${path}.tMs`, message: `tMs debe ser entero 0..${durationMs}.` });
      return;
    }
    if (typeof kf.value !== "number" || !Number.isFinite(kf.value)) {
      issues.push({ severity: "error", code: "SCENE_KEYFRAME_VALUE_INVALID", path: `${path}.value`, message: "value debe ser un número finito." });
      return;
    }
    const range = PROP_RANGES[prop];
    const easing = (typeof kf.easing === "string" ? kf.easing : "linear") as SceneEasing;
    if (!SCENE_EASINGS.includes(easing)) {
      issues.push({ severity: "warning", code: "SCENE_EASING_UNKNOWN", path: `${path}.easing`, message: `easing «${kf.easing}» desconocido; se muestrea como linear.` });
    }
    keyframes.push({
      nodeId,
      prop,
      tMs,
      value: range ? clampNum(kf.value, range[0], range[1]) : kf.value,
      easing: SCENE_EASINGS.includes(easing) ? easing : "linear",
    });
  });

  // effects — aceptados y persistidos, reportados como unsupported (fase 2)
  const effects: SceneEffect[] = [];
  const rawEffects = Array.isArray(source.effects) ? source.effects : [];
  if (rawEffects.length > SCENE_LIMITS.maxEffects) {
    issues.push({ severity: "error", code: "SCENE_EFFECTS_LIMIT", path: "effects", message: `máximo ${SCENE_LIMITS.maxEffects} efectos.` });
  }
  rawEffects.forEach((rawFx, i) => {
    const path = `effects[${i}]`;
    if (!rawFx || typeof rawFx !== "object" || Array.isArray(rawFx)) {
      issues.push({ severity: "error", code: "SCENE_EFFECT_INVALID", path, message: "effect debe ser un objeto." });
      return;
    }
    const fx = rawFx as Record<string, unknown>;
    const type = typeof fx.type === "string" ? fx.type : "";
    if (!SCENE_EFFECT_TYPES.includes(type as SceneEffectType)) {
      issues.push({ severity: "error", code: "SCENE_EFFECT_TYPE_INVALID", path: `${path}.type`, message: `effect.type debe ser uno de: ${SCENE_EFFECT_TYPES.join(", ")}.` });
      return;
    }
    const id = typeof fx.id === "string" && NODE_ID_RE.test(fx.id.trim()) ? fx.id.trim() : `fx_${i}`;
    effects.push({
      id,
      type: type as SceneEffectType,
      params: fx.params && typeof fx.params === "object" && !Array.isArray(fx.params) ? fx.params as Record<string, unknown> : {},
    });
  });

  // variables — el panel que la IA expone a la persona
  const variables: SceneVariable[] = [];
  const rawVariables = Array.isArray(source.variables) ? source.variables : [];
  if (rawVariables.length > SCENE_LIMITS.maxVariables) {
    issues.push({ severity: "error", code: "SCENE_VARIABLES_LIMIT", path: "variables", message: `máximo ${SCENE_LIMITS.maxVariables} variables.` });
  }
  const varIds = new Set<string>();
  rawVariables.forEach((rawVar, i) => {
    const path = `variables[${i}]`;
    if (!rawVar || typeof rawVar !== "object" || Array.isArray(rawVar)) {
      issues.push({ severity: "error", code: "SCENE_VARIABLE_INVALID", path, message: "variable debe ser un objeto." });
      return;
    }
    const v = rawVar as Record<string, unknown>;
    const id = typeof v.id === "string" ? v.id.trim() : "";
    if (!VARIABLE_ID_RE.test(id) || varIds.has(id)) {
      issues.push({ severity: "error", code: "SCENE_VARIABLE_ID_INVALID", path: `${path}.id`, message: `variable.id inválido o duplicado: ${id}.` });
      return;
    }
    varIds.add(id);
    const type = v.type;
    if (type !== "number" && type !== "color" && type !== "boolean" && type !== "select") {
      issues.push({ severity: "error", code: "SCENE_VARIABLE_TYPE_INVALID", path: `${path}.type`, message: "variable.type debe ser number|color|boolean|select." });
      return;
    }
    const targetRaw = (v.target && typeof v.target === "object" && !Array.isArray(v.target) ? v.target : null) as Record<string, unknown> | null;
    if (!targetRaw) {
      issues.push({ severity: "error", code: "SCENE_VARIABLE_TARGET_INVALID", path: `${path}.target`, message: "variable.target requiere {nodeId, prop} o {canvas:true, prop:'background'}." });
      return;
    }
    let target: SceneVariableTarget | null = null;
    if (targetRaw.canvas === true && targetRaw.prop === "background") {
      if (type !== "color") {
        issues.push({ severity: "error", code: "SCENE_VARIABLE_TARGET_INVALID", path: `${path}.target`, message: "el fondo del canvas solo admite variables type=color." });
        return;
      }
      target = { canvas: true, prop: "background" };
    } else {
      const nodeId = typeof targetRaw.nodeId === "string" ? targetRaw.nodeId : "";
      const prop = typeof targetRaw.prop === "string" ? targetRaw.prop : "";
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) {
        issues.push({ severity: "error", code: "SCENE_VARIABLE_TARGET_INVALID", path: `${path}.target.nodeId`, message: `nodeId «${nodeId}» no existe.` });
        return;
      }
      if (prop === "color" || prop === "textColor") {
        if (type !== "color") {
          issues.push({ severity: "error", code: "SCENE_VARIABLE_TARGET_INVALID", path: `${path}.target.prop`, message: `«${node.kind}.${prop}» solo admite variables type=color.` });
          return;
        }
        target = { nodeId, prop };
      } else if (KEYABLE_BY_KIND[node.kind].has(prop)) {
        if (type === "color") {
          issues.push({ severity: "error", code: "SCENE_VARIABLE_TARGET_INVALID", path: `${path}.target.prop`, message: `«${node.kind}.${prop}» es numérica; usa type=number|select|boolean.` });
          return;
        }
        target = { nodeId, prop };
      } else {
        issues.push({ severity: "error", code: "SCENE_VARIABLE_TARGET_INVALID", path: `${path}.target.prop`, message: `«${node.kind}.${prop}» no es expuesta. Permitidas: ${[...KEYABLE_BY_KIND[node.kind]].join(", ")}, color, textColor.` });
        return;
      }
    }
    const variable: SceneVariable = { id, type: type as SceneVariable["type"], default: v.default as number | string | boolean, target };
    if (typeof v.label === "string" && v.label.trim()) variable.label = v.label.trim().slice(0, 80);
    if (type === "number") {
      if (typeof v.default !== "number" || !Number.isFinite(v.default)) {
        issues.push({ severity: "error", code: "SCENE_VARIABLE_DEFAULT_INVALID", path: `${path}.default`, message: "default numérico requerido." });
        return;
      }
      const range = PROP_RANGES[(target as { prop: string }).prop];
      if (range) variable.default = clampNum(v.default, range[0], range[1]);
      if (typeof v.min === "number" && Number.isFinite(v.min)) variable.min = v.min;
      if (typeof v.max === "number" && Number.isFinite(v.max)) variable.max = v.max;
      if (variable.min !== undefined && variable.max !== undefined && variable.min >= variable.max) {
        issues.push({ severity: "error", code: "SCENE_VARIABLE_RANGE_INVALID", path, message: "min debe ser < max." });
        return;
      }
    }
    if (type === "color") {
      if (typeof v.default !== "string" || !COLOR_RE.test(v.default)) {
        issues.push({ severity: "error", code: "SCENE_VARIABLE_DEFAULT_INVALID", path: `${path}.default`, message: "default debe ser hex." });
        return;
      }
    }
    if (type === "boolean") {
      if (typeof v.default !== "boolean") {
        issues.push({ severity: "error", code: "SCENE_VARIABLE_DEFAULT_INVALID", path: `${path}.default`, message: "default debe ser boolean." });
        return;
      }
    }
    if (type === "select") {
      if (!Array.isArray(v.options) || v.options.length < 2 || v.options.length > 12 || v.options.some((o) => typeof o !== "string")) {
        issues.push({ severity: "error", code: "SCENE_VARIABLE_OPTIONS_INVALID", path: `${path}.options`, message: "select requiere 2..12 opciones string." });
        return;
      }
      variable.options = v.options as string[];
      if (typeof v.default !== "number" || !Number.isInteger(v.default) || v.default < 0 || v.default >= variable.options.length) {
        issues.push({ severity: "error", code: "SCENE_VARIABLE_DEFAULT_INVALID", path: `${path}.default`, message: "default de select debe ser un índice válido." });
        return;
      }
    }
    variables.push(variable);
  });

  const hasErrors = issues.some((issue) => issue.severity === "error");
  if (hasErrors) {
    return { valid: false, spec: null, issues, fidelity: { issues, unsupported: [] }, fingerprint: null };
  }

  const spec: MusaSceneSpec = {
    version: MUSA_SCENE_SPEC_VERSION,
    ...(typeof source.id === "string" && /^scenespec_[A-Za-z0-9_-]{6,64}$/.test(source.id) ? { id: source.id } : {}),
    ...(typeof source.name === "string" && source.name.trim() ? { name: source.name.trim().slice(0, 120) } : {}),
    canvas: { width, height, fps, durationMs, background },
    assets,
    nodes,
    keyframes,
    effects,
    variables,
  };

  const unsupported: SceneUnsupportedItem[] = [
    ...effects.map((fx) => ({ path: `effects.${fx.id}(${fx.type})`, reason: "post FX de fase 2: se persiste pero el renderer WebGL2 actual no lo aplica (preview y export lo omiten igual)." })),
    ...assets.filter((a) => a.kind === "texture").map((a) => ({ path: `assets.${a.id}`, reason: "texturas base-color: el shader PBR-lite usa color plano; viaja persistido para fase 2." })),
  ];
  if (lights.length > 4) {
    unsupported.push({ path: "nodes(lights)", reason: `el shader soporta hasta ${SCENE_LIMITS.maxLights} luces; sobre 4 baja la calidad especular en gama media.` });
  }

  return {
    valid: true,
    spec,
    issues,
    fidelity: { issues, unsupported },
    fingerprint: sceneSpecHash(spec),
  };
}

// ── Plan de aplicación (ids derivados del proyecto → re-aplicar es upsert) ──

export function buildSceneApplyPlan(spec: MusaSceneSpec, projectId: string): SceneApplyPlan {
  const ids = sceneGeneratedIds(projectId);
  const sceneSpecId = resolveSceneSpecId(spec);
  const durationUs = Math.round(spec.canvas.durationMs * 1_000);
  const bindings: SceneApplyPlan["bindings"] = [
    {
      nodeId: `track:${ids.trackId}`,
      nodeKind: "track",
      entityKind: "track",
      entityId: ids.trackId,
      editability: "editable",
      metadata: { type: "video", zOrder: 1000 },
    },
  ];
  for (const node of spec.nodes) {
    bindings.push({
      nodeId: node.id,
      nodeKind: node.kind,
      entityKind: "material",
      entityId: ids.materialId,
      editability: node.editability || "editable",
    });
  }
  bindings.push({
    nodeId: `segment:${ids.segmentId}`,
    nodeKind: "segment",
    entityKind: "segment",
    entityId: ids.segmentId,
    editability: "editable",
  });
  return {
    sceneSpecId,
    canvas: spec.canvas,
    track: { id: ids.trackId, type: "video", zOrder: 1000 },
    material: {
      id: ids.materialId,
      kind: "scene",
      nodeId: sceneSpecId,
      payload: {
        sceneSpecId,
        durationUs,
        ...(spec.name ? { name: spec.name } : {}),
        background: spec.canvas.background,
        variables: spec.variables,
      },
    },
    segment: {
      id: ids.segmentId,
      nodeId: sceneSpecId,
      trackId: ids.trackId,
      materialId: ids.materialId,
      targetStartUs: 0,
      targetDurUs: durationUs,
      clip: null,
    },
    bindings,
    unsupported: [
      ...spec.effects.map((fx) => ({ path: `effects.${fx.id}(${fx.type})`, reason: "post FX de fase 2: persistido, no renderizado." })),
      ...spec.assets.filter((a) => a.kind === "texture").map((a) => ({ path: `assets.${a.id}`, reason: "texturas base-color: fase 2." })),
    ],
  };
}

export function mergeScenePlanFidelity(fidelity: SceneFidelityReport, plan: SceneApplyPlan): SceneFidelityReport {
  const seen = new Set<string>();
  const unsupported: SceneUnsupportedItem[] = [];
  for (const item of [...fidelity.unsupported, ...plan.unsupported]) {
    const key = `${item.path}|${item.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unsupported.push(item);
  }
  return { issues: fidelity.issues, unsupported };
}

// ── Diff semántico para re-aplicación conservadora ──────────────────────────

export function diffSceneSpecs(current: MusaSceneSpec | null, next: MusaSceneSpec): SceneSpecDiff {
  if (!current) {
    return {
      changed: true,
      canvasChanged: true,
      addedNodes: next.nodes.map((n) => n.id),
      removedNodes: [],
      changedProps: [],
      keyframesChanged: next.keyframes.length > 0,
      assetsChanged: next.assets.length > 0,
      variablesChanged: next.variables.length > 0,
    };
  }
  const curIds = new Set(current.nodes.map((n) => n.id));
  const nextIds = new Set(next.nodes.map((n) => n.id));
  const changedProps: Array<{ nodeId: string; prop: string }> = [];
  for (const node of next.nodes) {
    const prev = current.nodes.find((n) => n.id === node.id);
    if (!prev) continue;
    const prevMap = new Map(Object.entries(prev.props || {}));
    const nextMap = new Map(Object.entries(node.props || {}));
    for (const [key, value] of nextMap) {
      if (prevMap.get(key) !== value) changedProps.push({ nodeId: node.id, prop: key });
    }
    for (const key of prevMap.keys()) {
      if (!nextMap.has(key)) changedProps.push({ nodeId: node.id, prop: key });
    }
    for (const field of ["color", "text", "lightType", "primitive", "assetId", "mode", "seed"] as const) {
      if (prev[field] !== node[field]) changedProps.push({ nodeId: node.id, prop: field });
    }
  }
  // stableSceneStringify (claves ordenadas), NO JSON.stringify: el canvas
  // persistado vuelve desde Postgres JSONB con otro orden de claves y daría
  // canvasChanged=true falso sobre un spec idéntico (rompería diff-before-apply).
  const canvasChanged = stableSceneStringify(current.canvas) !== stableSceneStringify(next.canvas);
  const keyframesChanged = stableSceneStringify(current.keyframes) !== stableSceneStringify(next.keyframes);
  const assetsChanged = stableSceneStringify(current.assets) !== stableSceneStringify(next.assets);
  const variablesChanged = stableSceneStringify(current.variables) !== stableSceneStringify(next.variables);
  return {
    changed: canvasChanged || keyframesChanged || assetsChanged || variablesChanged || changedProps.length > 0
      || next.nodes.some((n) => !curIds.has(n.id)) || current.nodes.some((n) => !nextIds.has(n.id)),
    canvasChanged,
    addedNodes: next.nodes.filter((n) => !curIds.has(n.id)).map((n) => n.id),
    removedNodes: current.nodes.filter((n) => !nextIds.has(n.id)).map((n) => n.id),
    changedProps,
    keyframesChanged,
    assetsChanged,
    variablesChanged,
  };
}

// ── Conversores de fuente (declarativa únicamente) ──────────────────────────

const THREE_GEOMETRY_MAP: Record<string, ScenePrimitive> = {
  BoxGeometry: "box",
  SphereGeometry: "sphere",
  PlaneGeometry: "plane",
  CylinderGeometry: "cylinder",
  ConeGeometry: "cone",
  TorusGeometry: "torus",
};

const THREE_LIGHT_MAP: Record<string, SceneLightType> = {
  DirectionalLight: "directional",
  PointLight: "point",
  AmbientLight: "ambient",
};

const SOURCE_CODE_RE = /(\bfunction\b|\bnew\s+[A-Z]|=>|<script|\bimport\s|\brequire\s*\()/;

function containsCodeStrings(value: unknown): boolean {
  if (typeof value === "string") return SOURCE_CODE_RE.test(value);
  if (Array.isArray(value)) return value.some(containsCodeStrings);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some(containsCodeStrings);
  return false;
}

function vec3(v: unknown, def: [number, number, number]): [number, number, number] {
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x))) {
    return [v[0], v[1], v[2]];
  }
  return def;
}

/** three-manifest-subset: acepta el MANIFIESTO JSON declarativo de una escena
 *  Three.js (geometrías/luces nombradas), nunca el código. Un modelo de IA
 *  puede emitir {camera, lights, objects, particles, keyframes} y aterriza en
 *  MusaSceneSpec con la taxonomía editability resuelta. */
export function convertSceneSource(sourceKind: SceneSourceKind, source: unknown): SceneSpecValidationResult & { sourceKind: SceneSourceKind } {
  if (sourceKind === "musa" || sourceKind === "musa-js") {
    const normalized = normalizeSceneSpec(source);
    return { ...normalized, sourceKind };
  }
  const issues: SceneIssue[] = [];
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    issues.push({ severity: "error", code: "SCENE_MANIFEST_INVALID", path: "source", message: "three-manifest-subset requiere un objeto JSON manifest." });
    return { valid: false, spec: null, issues, fidelity: { issues, unsupported: [] }, fingerprint: null, sourceKind };
  }
  const manifest = source as Record<string, unknown>;
  if (containsCodeStrings(manifest)) {
    issues.push({ severity: "error", code: "SOURCE_CODE_REJECTED", path: "source", message: "El manifest contiene strings con sintaxis de código (function/new/=>/import). Convertí la escena a manifest declarativo: geometrías y luces por nombre, valores literales." });
    return { valid: false, spec: null, issues, fidelity: { issues, unsupported: [] }, fingerprint: null, sourceKind };
  }
  const nodes: Array<Record<string, unknown>> = [];
  const cam = manifest.camera as Record<string, unknown> | undefined;
  if (cam) {
    const [x, y, z] = vec3(cam.position, [0, 0.6, 5]);
    const [tx, ty, tz] = vec3(cam.target, [0, 0, 0]);
    nodes.push({
      id: "camera",
      kind: "camera",
      props: { x, y, z, tx, ty, tz, ...(typeof cam.fov === "number" ? { fov: cam.fov } : {}) },
    });
  }
  (Array.isArray(manifest.lights) ? manifest.lights : []).forEach((rawLight, i) => {
    const light = (rawLight || {}) as Record<string, unknown>;
    const type = typeof light.type === "string" ? light.type : "DirectionalLight";
    const lightType = THREE_LIGHT_MAP[type];
    if (!lightType) {
      issues.push({ severity: "error", code: "UNSUPPORTED_LIGHT", path: `lights[${i}].type`, message: `«${type}» fuera del subconjunto. Permitidas: ${Object.keys(THREE_LIGHT_MAP).join(", ")}.` });
      return;
    }
    const [x, y, z] = vec3(light.position, [0, 5, 5]);
    nodes.push({
      id: `light_${i}`,
      kind: "light",
      lightType,
      ...(typeof light.color === "string" ? { color: light.color } : {}),
      props: { x, y, z, ...(typeof light.intensity === "number" ? { intensity: light.intensity } : {}) },
    });
  });
  (Array.isArray(manifest.objects) ? manifest.objects : []).forEach((rawObj, i) => {
    const obj = (rawObj || {}) as Record<string, unknown>;
    const geometry = typeof obj.geometry === "string" ? obj.geometry : "BoxGeometry";
    const primitive = THREE_GEOMETRY_MAP[geometry];
    if (!primitive) {
      issues.push({ severity: "error", code: "UNSUPPORTED_GEOMETRY", path: `objects[${i}].geometry`, message: `«${geometry}» fuera del subconjunto. Permitidas: ${Object.keys(THREE_GEOMETRY_MAP).join(", ")} (GLB va por assetId en un SceneSpec musa).` });
      return;
    }
    const [x, y, z] = vec3(obj.position, [0, 0, 0]);
    const [rx, ry, rz] = vec3(obj.rotation, [0, 0, 0]);
    const scale = typeof obj.scale === "number" ? obj.scale : 1;
    nodes.push({
      id: `mesh_${i}`,
      kind: "mesh",
      primitive,
      ...(typeof obj.color === "string" ? { color: obj.color } : {}),
      props: {
        x, y, z,
        rx: rx * 57.29578, ry: ry * 57.29578, rz: rz * 57.29578,
        scale,
        ...(typeof obj.metalness === "number" ? { metalness: obj.metalness } : {}),
        ...(typeof obj.roughness === "number" ? { roughness: obj.roughness } : {}),
      },
    });
  });
  const parts = manifest.particles as Record<string, unknown> | undefined;
  if (parts) {
    nodes.push({
      id: "particles_0",
      kind: "particles",
      mode: typeof parts.mode === "string" ? parts.mode : "fountain",
      seed: typeof parts.seed === "number" ? Math.floor(parts.seed) : 7,
      props: {
        ...(typeof parts.count === "number" ? { count: parts.count } : {}),
        ...(typeof parts.speed === "number" ? { speed: parts.speed } : {}),
        ...(typeof parts.spread === "number" ? { spread: parts.spread } : {}),
      },
    });
  }
  const keyframes = Array.isArray(manifest.keyframes) ? manifest.keyframes : [];
  const converted: Record<string, unknown> = {
    version: MUSA_SCENE_SPEC_VERSION,
    ...(typeof manifest.name === "string" ? { name: manifest.name } : {}),
    canvas: manifest.canvas || { width: 1080, height: 1920, durationMs: 5_000 },
    assets: Array.isArray(manifest.assets) ? manifest.assets : [],
    nodes,
    keyframes,
    effects: Array.isArray(manifest.effects) ? manifest.effects : [],
    variables: Array.isArray(manifest.variables) ? manifest.variables : [],
  };
  const normalized = normalizeSceneSpec(converted);
  return {
    ...normalized,
    issues: [...issues, ...normalized.issues],
    valid: issues.length === 0 && normalized.valid,
    sourceKind,
  };
}

// ── Variables → overrides (el mecanismo del panel expuesto a la IA) ─────────

export interface SceneNodeOverrides {
  color?: string;
  textColor?: string;
  numeric?: Record<string, number>;
}

export interface SceneOverrides {
  background?: string;
  nodes: Record<string, SceneNodeOverrides>;
}

export function applySceneVariables(spec: MusaSceneSpec, values: Record<string, unknown>): SceneOverrides {
  const overrides: SceneOverrides = { nodes: {} };
  const nodeOf = (id: string) => spec.nodes.find((n) => n.id === id);
  for (const variable of spec.variables) {
    const raw = values ? values[variable.id] : undefined;
    let value: number | string | boolean = variable.default;
    if (variable.type === "number" && typeof raw === "number" && Number.isFinite(raw)) {
      const lo = variable.min ?? PROP_RANGES[(variable.target as { prop: string }).prop]?.[0] ?? -1e9;
      const hi = variable.max ?? PROP_RANGES[(variable.target as { prop: string }).prop]?.[1] ?? 1e9;
      value = clampNum(raw, lo, hi);
    } else if (variable.type === "color" && typeof raw === "string" && COLOR_RE.test(raw)) {
      value = raw;
    } else if (variable.type === "boolean" && typeof raw === "boolean") {
      value = raw ? 1 : 0;
    } else if (variable.type === "select" && typeof raw === "number" && Number.isInteger(raw) && variable.options) {
      value = clampNum(raw, 0, variable.options.length - 1);
    }
    const target = variable.target as { nodeId?: string; prop: string };
    if (target.nodeId === undefined) {
      if (typeof value === "string") overrides.background = value;
      continue;
    }
    const node = nodeOf(target.nodeId);
    if (!node) continue;
    const slot = (overrides.nodes[target.nodeId] ||= { numeric: {} });
    if (target.prop === "color" || target.prop === "textColor") {
      if (typeof value === "string") slot[target.prop] = value;
      continue;
    }
    if (typeof value === "number") {
      (slot.numeric ||= {})[target.prop] = value;
    }
  }
  return overrides;
}

// ── EL sampler determinista (preview y export lo comparten) ─────────────────

const EASING_FNS: Record<SceneEasing, (t: number) => number> = {
  linear: (t) => t,
  "ease-in": (t) => t * t * t,
  "ease-out": (t) => 1 - Math.pow(1 - t, 3),
  "ease-in-out": (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

function easeProgress(easing: SceneEasing | undefined, t01: number): number {
  const fn = EASING_FNS[easing || "linear"] || EASING_FNS.linear;
  return fn(Math.min(1, Math.max(0, t01)));
}

const PARTICLE_MODE_INDEX: Record<SceneParticleMode, number> = { fountain: 0, snow: 1, orbit: 2 };

export const DEFAULT_CAMERA: Record<string, number> = { x: 0, y: 0.6, z: 5, tx: 0, ty: 0, tz: 0, fov: 50 };

const NODE_DEFAULTS: Record<SceneNodeKind, Record<string, number>> = {
  camera: DEFAULT_CAMERA,
  light: { x: 0, y: 5, z: 5, intensity: 1 },
  mesh: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, sx: 1, sy: 1, sz: 1, opacity: 1, metalness: 0.1, roughness: 0.7 },
  text3d: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1, quadWidth: 2, quadHeight: 1, fontSizePx: 96 },
  particles: { x: 0, y: 0, z: 0, opacity: 1, size: 2, count: 500, speed: 1, spread: 2, gravity: 0, drift: 0.2, spin: 0, area: 4 },
};

export interface SampledSceneNode {
  id: string;
  kind: SceneNodeKind;
  visible: boolean;
  color?: string;
  textColor?: string;
  lightType?: SceneLightType;
  primitive?: ScenePrimitive;
  assetId?: string;
  text?: string;
  billboard?: boolean;
  numeric: Record<string, number>;
}

export interface SceneSample {
  background: string;
  camera: { x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number };
  nodes: SampledSceneNode[];
}

export function sampleSceneAt(spec: MusaSceneSpec, timeMs: number, overrides?: SceneOverrides | null): SceneSample {
  const t = Math.min(spec.canvas.durationMs, Math.max(0, timeMs));
  const keyframesByNode = new Map<string, SceneKeyframe[]>();
  for (const kf of spec.keyframes) {
    const list = keyframesByNode.get(kf.nodeId) || [];
    list.push(kf);
    keyframesByNode.set(kf.nodeId, list);
  }
  const sampleNode = (node: SceneNode): SampledSceneNode => {
    const numeric: Record<string, number> = { ...(NODE_DEFAULTS[node.kind] || {}), ...(node.props || {}) };
    const kfs = (keyframesByNode.get(node.id) || []).slice().sort((a, b) => a.tMs - b.tMs);
    for (const kf of kfs) {
      const base = numeric[kf.prop] ?? 0;
      let value = base;
      let prev: SceneKeyframe | null = null;
      let next: SceneKeyframe | null = null;
      for (const k of kfs) {
        if (k.prop !== kf.prop) continue;
        if (k.tMs <= t) prev = k;
        if (k.tMs >= t && !next) next = k;
      }
      if (prev && next && prev !== next) {
        const span = next.tMs - prev.tMs;
        value = prev.value + (next.value - prev.value) * easeProgress(next.easing, span > 0 ? (t - prev.tMs) / span : 0);
      } else if (prev) {
        value = prev.value;
      } else if (next) {
        value = next.value;
      }
      numeric[kf.prop] = value;
    }
    if (node.kind === "particles") {
      numeric.mode = PARTICLE_MODE_INDEX[node.mode || "fountain"];
      numeric.seed = node.seed ?? 7;
    }
    const nodeOverride = overrides?.nodes?.[node.id];
    if (nodeOverride) {
      Object.assign(numeric, nodeOverride.numeric || {});
    }
    return {
      id: node.id,
      kind: node.kind,
      visible: node.visible !== false,
      color: nodeOverride?.color || node.color,
      textColor: nodeOverride?.textColor || node.textColor,
      lightType: node.lightType,
      primitive: node.primitive,
      assetId: node.assetId,
      text: node.text,
      billboard: node.billboard,
      numeric,
    };
  };
  const sampledNodes = spec.nodes.map(sampleNode);
  const cameraNode = sampledNodes.find((n) => n.kind === "camera");
  const camera = {
    x: cameraNode?.numeric.x ?? 0,
    y: cameraNode?.numeric.y ?? 0.6,
    z: cameraNode?.numeric.z ?? 5,
    tx: cameraNode?.numeric.tx ?? 0,
    ty: cameraNode?.numeric.ty ?? 0,
    tz: cameraNode?.numeric.tz ?? 0,
    fov: cameraNode?.numeric.fov ?? 50,
  };
  return {
    background: overrides?.background || spec.canvas.background,
    camera,
    nodes: sampledNodes,
  };
}

// ── Muestreo closed-form de partículas (determinismo por construcción) ─────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rand01(seed: number, index: number, salt: number): number {
  return mulberry32(seed * 7919 + index * 104_729 + salt * 97)();
}

export interface ParticleParams {
  mode: SceneParticleMode | number;
  seed: number;
  speed: number;
  spread: number;
  gravity: number;
  drift: number;
  spin: number;
  area: number;
}

/** Posición de la partícula `index` en el tiempo `tSec`, resuelta en forma
 *  cerrada (sin estado): dos llamadas con los mismos argumentos devuelven lo
 *  mismo SIEMPRE, y el preview y el export no pueden divergir. */
export function particlePositionAt(params: ParticleParams, index: number, tSec: number): [number, number, number] {
  const mode = typeof params.mode === "number"
    ? (params.mode === 1 ? "snow" : params.mode === 2 ? "orbit" : "fountain")
    : params.mode;
  const seed = params.seed;
  const h = rand01(seed, index, 1);
  const h2 = rand01(seed, index, 2);
  const h3 = rand01(seed, index, 3);
  const h4 = rand01(seed, index, 4);
  const speed = Math.max(0.01, params.speed);
  const spread = Math.max(0, params.spread);
  const area = Math.max(0.1, params.area);
  if (mode === "fountain") {
    const cycle = 1.6 / speed;
    const tt = ((tSec / cycle + h) % 1 + 1) % 1;
    const age = tt * cycle;
    const up = 1.6 + h2 * 1.4;
    const x = (h3 - 0.5) * spread * age + params.drift * Math.sin(tSec * 2 + h * 6.28318);
    const z = (h4 - 0.5) * spread * age;
    const y = up * age - 0.5 * Math.max(0, params.gravity) * age * age;
    return [x, y, z];
  }
  if (mode === "snow") {
    const fall = area - (((tSec * speed * (0.5 + h2 * 0.8) + h * area) % area) + area) % area;
    const x = (h3 - 0.5) * area + params.drift * Math.sin(tSec * Math.max(0.01, params.spin) + h * 6.28318);
    const z = (h4 - 0.5) * area;
    return [x, fall - area / 2, z];
  }
  const ang = tSec * speed * (0.5 + h2) + h * 6.28318;
  const radius = Math.max(0.1, spread) * (0.4 + h3 * 0.6);
  const y = Math.sin(tSec * Math.max(0.01, params.spin) + h * 6.28318) * params.drift;
  return [Math.cos(ang) * radius, y, Math.sin(ang) * radius];
}

// ── Utilidades de color ─────────────────────────────────────────────────────

function hexChannels(hex: string): [number, number, number] {
  let body = hex.slice(1);
  if (body.length === 3 || body.length === 4) body = body.slice(0, 3).split("").map((c) => c + c).join("");
  return [parseInt(body.slice(0, 2), 16), parseInt(body.slice(2, 4), 16), parseInt(body.slice(4, 6), 16)];
}

/** Interpolación lineal en sRGB entre dos hex. */
export function lerpSceneColor(a: string, b: string, t01: number): string {
  const t = Math.min(1, Math.max(0, t01));
  const ca = hexChannels(a);
  const cb = hexChannels(b);
  const mix = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
