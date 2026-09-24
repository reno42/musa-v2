/**
 * intentRouter — ROUTER v1 del ChatFAB: portero ONNX antes del LLM.
 *
 * Clasifica el mensaje del usuario contra 69 clases (68 tools de Musa +
 * "otros") con un xlm-roberta-base int8 (~280MB). Si la confianza es alta
 * (≥0.8), la clase no es "otros" y la tool es ruteable (no generativa —
 * ver NON_ROUTABLE_TOOLS), el ChatFAB ejecuta la tool directo sin gastar
 * un solo token de LLM; cualquier otro caso cae al flujo normal.
 *
 * Contrato de fallo-suave (fail-soft): el router NUNCA rompe ni bloquea el
 * chat. Un 404 del modelo, un navegador viejo, un OOM de wasm — cualquier
 * error devuelve { route: "llm" } y el runtime queda cacheado como no
 * disponible para el resto de la sesión (sin loops de reintento de 280MB).
 *
 * Presupuesto de arranque: el primer mensaje tras un cold-load puede llegar
 * antes de que el runtime esté listo; routeIntent corre contra un budget de
 * 1500ms y, si no alcanza, responde "llm" al instante mientras la carga
 * sigue en background.
 *
 * Assets (dev: public/router/ — prod: Cloudflare R2 mapeado a /router/*):
 *   model_int8.onnx  280MB  NUNCA entra a git ni al bundle (.gitignore)
 *   tokenizer.json / tokenizer_config.json / labels.json  metadatos sí en git
 */

export type IntentRoute = "direct" | "llm";

export interface IntentResult {
  /** Clase ganadora del clasificador (nombre de tool, u "otros"), o null si el runtime no está disponible. */
  label: string | null;
  /** Confianza softmax [0..1] de la clase ganadora. */
  confidence: number;
  /** "direct" ⇒ ejecutar la tool sin LLM; "llm" ⇒ flujo normal del chat. */
  route: IntentRoute;
  /** true ⇒ el label ganó con confianza pero es generativa (NON_ROUTABLE_TOOLS): escala al LLM a propósito. */
  nonRoutable?: boolean;
}

const ROUTER_BASE = "/router";
const MODEL_URL = `${ROUTER_BASE}/model_int8.onnx`;
/** Umbral del spec v1: por debajo de esto (o clase "otros") va al LLM. */
const DIRECT_THRESHOLD = 0.8;
/** Truncado del tokenizer — el dataset se entrenó con frases cortas. */
const MAX_SEQ_LEN = 256;
/** Presupuesto de routeIntent tras cold-load: nunca frena el chat. */
const READY_BUDGET_MS = 1500;

const LLM_FALLBACK: IntentResult = { label: null, confidence: 0, route: "llm" };
/**
 * Versión de los assets del tokenizer. @xenova cachea en la Cache API
 * ('transformers-cache') con la URL como clave: sin purge, un fix del
 * artifact nunca llegaría a navegadores que ya cargaron el anterior.
 * Subir esta constante purga UNA sola vez por dispositivo.
 * v2: Metaspace add_prefix_space (fix de los ▁ ausentes → ids fuera de
 * distribución → el modelo veía basura y respondía "otros" con ~0.999).
 */
const ROUTER_ASSET_VERSION = "2";

/**
 * Tools no-ruteables: su resultado primario es contenido nuevo (copy, HTML,
 * decks, imágenes, paletas, sugerencias, charts), así que ejecutarlas con
 * args por defecto sería una ejecución muerta. Siempre escalan al LLM sin
 * importar la confianza; el log (tool_used=label + resolved_by="llm") deja
 * huella de la escala intencional para que la v2 aprenda de estos casos.
 * Quedan FUERA a propósito: add_content_idea (crea fila con copy vacío, no
 * genera contenido), create_frame (artboard mecánica) y set_html (aplica
 * contenido existente del usuario).
 */
const NON_ROUTABLE_TOOLS = new Set([
  "ai_generate_image",
  "ai_generate_text",
  "ai_palette",
  "ai_suggest_layout",
  "create_chart",
  "create_copy_recipe",
  "create_deck",
  "create_html_carousel",
  "create_html_frame",
  "create_html_template",
  "create_template",
]);

type RouterRuntime = {
  labels: string[];
  tokenize: (text: string) => { ids: bigint[]; mask: bigint[] };
  run: (ids: bigint[], mask: bigint[]) => Promise<Float32Array>;
};

/** Singleton de carga: null ⇒ runtime roto, cacheado como caído por sesión. */
let runtimePromise: Promise<RouterRuntime | null> | null = null;

async function loadRuntime(): Promise<RouterRuntime | null> {
  try {
    const [ortMod, tfMod, labelsRes] = await Promise.all([
      import("onnxruntime-web"),
      import("@xenova/transformers"),
      fetch(`${ROUTER_BASE}/labels.json`).then(r => {
        if (!r.ok) throw new Error(`labels.json HTTP ${r.status}`);
        return r.json();
      }),
    ]);
    const ort = ortMod;
    const labels: string[] = Array.isArray(labelsRes?.labels) ? labelsRes.labels.map(String) : [];
    if (!labels.length) throw new Error("labels.json vacío o inválido");

    // Wasm de ORT desde el CDN de jsDelivr fijado a la versión instalada
    // (index.html no define CSP; en prod R2 sirve /router/* y el wasm sigue
    // viniendo del CDN, igual que hoy hace el runtime del Worker).
    // NOTA: ort.env.version viene undefined en el bundle 1.22.0 — el fallback
    // explícito es el que manda; mantener sincronizado con package.json.
    const ORT_VERSION: string = (ort.env as { version?: string }).version || "1.22.0";
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

    // Tokenizer XLMRoberta desde archivos locales (/router/*.json) — sin red
    // remota: el mismo origen sirve todo en dev y vía R2 en prod.
    const tf = tfMod;
    tf.env.allowLocalModels = true;
    tf.env.allowRemoteModels = false;
    // Los archivos resuelven como localModelPath + <repo>/<file>: con base
    // en el origen, from_pretrained("router") lee {origin}/router/*.json.
    tf.env.localModelPath = `${window.location.origin}/`;
    // Cache-bust versionado (ver ROUTER_ASSET_VERSION): purga las entradas
    // viejas del router en la Cache API una única vez tras cada fix.
    try {
      const ASSET_LS = "intentRouter_asset_version";
      if (localStorage.getItem(ASSET_LS) !== ROUTER_ASSET_VERSION) {
        const hubCache = await caches.open("transformers-cache");
        await Promise.all(
          ["tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"].map(file =>
            hubCache.delete(`${window.location.origin}/${ROUTER_BASE.slice(1)}/${file}`).catch(() => {})
          )
        );
        localStorage.setItem(ASSET_LS, ROUTER_ASSET_VERSION);
      }
    } catch { /* Cache API ausente o bloqueada: el fetch normal sigue. */ }
    const tokenizer = await tf.AutoTokenizer.from_pretrained(ROUTER_BASE.slice(1));

    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`model_int8.onnx HTTP ${res.status}`);
    const modelBuffer = await res.arrayBuffer();
    const session = await ort.InferenceSession.create(modelBuffer, { executionProviders: ["wasm"] });
    // xlm-roberta no usa token_type_ids; solo se lo alimenta si el grafo lo pide.
    const wantsTokenTypeIds = session.inputNames.includes("token_type_ids");

    return {
      labels,
      tokenize: (text) => {
        const enc: any = tokenizer(text, { truncation: true, max_length: MAX_SEQ_LEN });
        const ids = Array.from(enc.input_ids?.data ?? enc.input_ids ?? []).map(v => BigInt(Math.round(Number(v))));
        const mask = Array.from(enc.attention_mask?.data ?? enc.attention_mask ?? []).map(v => BigInt(Math.round(Number(v))));
        return { ids, mask };
      },
      run: async (ids, mask) => {
        const len = ids.length;
        const feed: Record<string, InstanceType<typeof ort.Tensor>> = {
          input_ids: new ort.Tensor("int64", BigInt64Array.from(ids), [1, len]),
          attention_mask: new ort.Tensor("int64", BigInt64Array.from(mask), [1, len]),
        };
        if (wantsTokenTypeIds) feed.token_type_ids = new ort.Tensor("int64", new BigInt64Array(len), [1, len]);
        const output = await session.run(feed);
        const first = output[Object.keys(output)[0]];
        return first.data as Float32Array;
      },
    };
  } catch (err: any) {
    console.warn("[intentRouter] runtime no disponible — router desactivado en esta sesión:", err?.message || err);
    return null;
  }
}

function getRuntime(): Promise<RouterRuntime | null> {
  if (!runtimePromise) runtimePromise = loadRuntime();
  return runtimePromise;
}

/** Precalienta el runtime (ORT + tokenizer + modelo) sin clasificar nada. */
export function warmRouter(): void {
  void getRuntime();
}

/**
 * Clasifica un mensaje. NUNCA lanza y NUNCA tarda más de READY_BUDGET_MS
 * tras un cold-load: ante cualquier duda responde { route: "llm" }.
 */
export async function routeIntent(text: string): Promise<IntentResult> {
  try {
    if (!text || !text.trim()) return LLM_FALLBACK;
    const work = (async (): Promise<IntentResult> => {
      const rt = await getRuntime();
      if (!rt) return LLM_FALLBACK;
      const { ids, mask } = rt.tokenize(text);
      if (!ids.length) return LLM_FALLBACK;
      const logits = await rt.run(ids, mask);
      if (!logits?.length) return LLM_FALLBACK;
      // Softmax con resta del máximo (estabilidad numérica).
      let max = -Infinity;
      for (const v of logits) if (v > max) max = v;
      let sum = 0;
      const exps = new Array<number>(logits.length);
      for (let i = 0; i < logits.length; i++) {
        exps[i] = Math.exp(logits[i] - max);
        sum += exps[i];
      }
      let bestIdx = 0;
      for (let i = 1; i < logits.length; i++) if (exps[i] > exps[bestIdx]) bestIdx = i;
      const confidence = exps[bestIdx] / sum;
      const label = rt.labels[bestIdx] ?? null;
      const nonRoutable = !!label && NON_ROUTABLE_TOOLS.has(label);
      if (!label || nonRoutable || label === "otros" || confidence < DIRECT_THRESHOLD) {
        return { label, confidence, route: "llm", nonRoutable };
      }
      return { label, confidence, route: "direct" };
    })();
    const result = await Promise.race([
      work,
      new Promise<IntentResult>(resolve => setTimeout(() => resolve(LLM_FALLBACK), READY_BUDGET_MS)),
    ]);
    // El work sigue y termina solo; su fallo ya está contenido adentro.
    work.catch(() => {});
    return result;
  } catch {
    return LLM_FALLBACK;
  }
}
