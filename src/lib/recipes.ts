// RECETAS MULTI-TOOL — ejecución encadenada en el gate instantáneo del ChatFAB.
// Cada receta orquesta tools MCP EXISTENTES via RecipeEnv.call (executeToolCall
// ya normalizado por el gate): nada de lógica duplicada, solo encadenado con
// args reales entre pasos — el output de un paso alimenta al siguiente.
//
// Contrato de fallos (transparencia total): un paso que falla lanza
// RecipeStepError; el gate detiene la receta AHI, deja el chip rojo del paso,
// explica en burbuja qué se ejecutó hasta entonces y escala al LLM con ese
// contexto. Ninguna receta inventa datos: si un dato no existe (brand, capa,
// cuentas), se detiene y lo dice.
//
// TEMP-ROUTER-V2: remove when model v2 ships — SOLO la tabla TEMP_RECIPES
// (detección regex) y el branch que la consulta son temporales. El modelo v2
// clasificará frases hacia labels recipe_* y llamará al mismo RECIPES[id];
// cuando eso pase se borra TEMP_RECIPES + matchTempRecipe y nada más.

export class RecipeStepError extends Error {
  constructor(public tool: string, message: string) {
    super(message);
    this.name = "RecipeStepError";
  }
}

/** Entorno que el gate le pasa a cada receta. begin() enciende el chip del
 *  paso; call() ejecuta la tool MCP real y lo apaga (verde/rojo). */
export interface RecipeEnv {
  workspaceId: string | undefined;
  templateId: string | undefined;
  /** Frase original del humano — las recetas parsean de aquí sus args. */
  utterance: string;
  begin(index: number, total: number, toolName: string): void;
  /** Ejecuta una tool MCP ya normalizada; reject con RecipeStepError si la
   *  tool respondió {error}. Devuelve el JSON parseado (o null si no es JSON). */
  call(toolName: string, args: Record<string, any>): Promise<any>;
  /** Burbuja assistant en el dock. */
  say(text: string): void;
}

export interface RecipeResult {
  /** true → receta completa (u honestamente detenida); el turno termina aquí. */
  ok: boolean;
  /** Burbuja final para el humano. */
  summary: string;
  /** ok:false → el gate escala al LLM adjuntando escalationContext a la
   *  conversación (lo ya ejecutado + por qué se detuvo). */
  escalationContext?: string;
}

export type Recipe = (env: RecipeEnv) => Promise<RecipeResult>;

// ── TEMP-ROUTER-V2: mapeo frase→receta 1:1 con las frases del dataset v2 ────
// Orden importa: el primer match gana. Las frases instantáneas existentes
// (pan/zoom/export/templates/LLM) NO matchean ninguna — verificado contra la
// batería de 5.
export const TEMP_RECIPES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bpublic\w*\b[^.!?]*\b(?:instagram|insta)\b/i, "recipe_publish_instagram"],
  [/\b(?:crea|haz|dise[ñn]a|genera)\b[^.!?]*\b(?:post|poster)\b[^.!?]*\b(?:brand|marca|estilo)\b/i, "recipe_post_from_brand"],
  [/\btransfiere\b[^.!?]*\b(?:estilo|dise[ñn]o)\b/i, "recipe_style_transfer"],
  [/\b(?:aplica|clona|copia)\b[^.!?]*\b(?:el\s+)?(?:estilo|dise[ñn]o)\b\s+de\b/i, "recipe_style_transfer"],
  [/\b(?:crea|haz|genera)\b[^.!?]*\b(?:deck|presentaci[óo]n)\b/i, "recipe_deck_from_template"],
  [/\banima\w*\b/i, "recipe_animate_frame"],
  [/\b(?:genera|crea|haz|arma)\b[^.!?]*\bcarrusel\b/i, "recipe_carrusel_content"],
];

export function matchTempRecipe(text: string): string | null {
  for (const [re, id] of TEMP_RECIPES) if (re.test(text)) return id;
  return null;
}

// ── Helpers de parseo (todo determinista, sobre la frase o datos reales) ────

const deburr = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function parseFormat(utterance: string): { format: "svg" | "pdf"; note: string } {
  const m = utterance.match(/\b(png|jpe?g|svg|pdf)\b/i);
  const wanted = (m?.[1] || "svg").toLowerCase();
  // export_frame SOLO produce svg|pdf hoy — se lo decimos al humano, no lo
  // simulamos. png/jpg caen a svg (vector, convertible) con la nota visible.
  if (wanted === "pdf") return { format: "pdf", note: "" };
  if (wanted === "svg") return { format: "svg", note: "" };
  return { format: "svg", note: ` (pediste ${wanted}: export_frame hoy produce svg/pdf — va en svg, convertible)` };
}

function parseSize(utterance: string): { w: number; h: number } {
  const m = utterance.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
  if (m) return { w: Number(m[1]), h: Number(m[2]) };
  if (/\bcuadrado|square\b/i.test(utterance)) return { w: 1080, h: 1080 };
  if (/\bstory|vertical\b/i.test(utterance)) return { w: 1080, h: 1920 };
  return { w: 1080, h: 1350 }; // post IG retrato, el default del dataset
}

function parseCount(utterance: string, fallback: number): number {
  const m = utterance.match(/(?:carrusel|deck|presentaci[óo]n)[^\d]*(\d{1,2})/i) || utterance.match(/(\d{1,2})\s*(?:slides?|frames?|tarjetas?|p[áa]ginas?)/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? Math.min(10, Math.max(2, n)) : fallback;
}

/** "frame 3" → 3; "primera" → 1; "segunda" → 2; "última" → -1; default → 0. */
function parseFrameRef(utterance: string): { n?: number; last?: boolean } {
  const m = utterance.match(/\bframe\s+(\d{1,3})\b/i);
  if (m) return { n: Number(m[1]) };
  if (/\b[uú]ltima\b/i.test(utterance)) return { last: true };
  if (/\bsegunda\b/i.test(utterance)) return { n: 2 };
  return {}; // "primera"/"primer"/default → la primera
}

function resolveFrame(frames: any[], ref: { n?: number; last?: boolean }): any | null {
  if (!frames.length) return null;
  if (ref.last) return frames[frames.length - 1];
  if (ref.n != null) return frames[ref.n - 1] ?? null; // 1-based; fuera de rango → null
  return frames[0];
}

function extractBrandQuery(utterance: string): string {
  const m = utterance.match(/\b(?:brand|marca|estilo)\s+(?:de|del|la|el)?\s*([^,.!?]+)["»]?/i);
  return (m?.[1] || "").replace(/\b\d{3,4}\s*[x×]\s*\d{3,4}\b/gi, "").trim();
}

function matchBrand(query: string, brands: any[]): any | null {
  if (!query || !brands.length) return null;
  const q = deburr(query);
  const exact = brands.find(b => deburr(b?.name || "").includes(q) || q.includes(deburr(b?.name || "")));
  if (exact) return exact;
  const qTokens = q.split(/\s+/).filter(t => t.length >= 4);
  return brands.find(b => {
    const name = deburr(b?.name || "");
    return qTokens.some(t => name.includes(t));
  }) || null;
}

function firstHex(text: string): string | null {
  return text?.match(/#[0-9a-f]{6}\b/i)?.[0] || null;
}

/** Paleta legible desde los hex REALES del brand (tokensJson/sharedCss). */
function paletteFromBrand(css: string): { bg: string; ink: string; accent: string } {
  const hexes = (css.match(/#[0-9a-f]{3,8}\b/gi) || []).map(h => h.toUpperCase());
  const bg = hexes[0] || "#0F172A";
  const accent = hexes[1] || hexes[0] || "#4F46E5";
  const r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
  const ink = (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#111827" : "#FFFFFF";
  return { bg, ink, accent };
}

/** Guard honesto: las recetas de contexto necesitan diseño abierto. */
function needTemplate(env: RecipeEnv): RecipeResult | null {
  if (env.templateId) return null;
  return {
    ok: false,
    summary: "✕ Esta receta opera sobre el diseño abierto y no hay ninguno — abre un diseño y vuelve a pedirlo.",
    escalationContext: "La receta necesita currentContext.templateId y no hay editor con template abierto.",
  };
}

function needWorkspace(env: RecipeEnv): RecipeResult | null {
  if (env.workspaceId) return null;
  return {
    ok: false,
    summary: "✕ No sé en qué workspace estoy — recarga el panel e inténtalo de nuevo.",
    escalationContext: "La receta necesita currentContext.workspaceId y viene undefined.",
  };
}

/** Paso tipado: enciende el chip y ejecuta. Envuelve begin+call para que las
 *  recetas se lean como la cadena que son. */
async function step<T = any>(env: RecipeEnv, index: number, total: number, toolName: string, args: Record<string, any>): Promise<T> {
  env.begin(index, total, toolName);
  return env.call(toolName, args) as Promise<T>;
}

const stepsDone = (log: string[]) => log.join(" → ");

// ── Las 6 recetas ────────────────────────────────────────────────────────────

export const RECIPES: Record<string, Recipe> = {
  /**
   * "transfiere el estilo de este diseño" — extract_design_system(source) →
   * create_brand_guideline(artifacts reales) → apply_brand_to_template(target).
   * Source y target son el diseño abierto: la transferencia v2 con DOS
   * templates distintos llega cuando el clasificador entregue args; hoy el
   * chain completo corre de verdad y deja brand reusable por otras recetas.
   */
  recipe_style_transfer: async (env) => {
    const guard = needTemplate(env) || needWorkspace(env);
    if (guard) return guard;
    const T = 5;
    const log: string[] = [];
    const tpl = await step(env, 1, T, "get_template", { templateId: env.templateId });
    log.push("get_template");
    const brandName = `Estilo de ${tpl?.name || "tu diseño"}`;
    const ext = await step(env, 2, T, "extract_design_system", {
      templateIds: [env.templateId], workspaceId: env.workspaceId, name: brandName,
    });
    log.push("extract_design_system");
    // Idempotente: si el brand ya existe (regla de unicidad por workspace),
    // se REUTILIZA en vez de chocar con el error de duplicado.
    const listB = await step(env, 3, T, "list_brand_guidelines", { workspaceId: env.workspaceId });
    log.push("list_brand_guidelines");
    const existing = (listB?.brands || []).find((b: any) => deburr(b?.name || "") === deburr(brandName));
    let brandId: string | undefined = existing?.id;
    let reused = !!existing;
    if (!brandId) {
      const brandRes = await step(env, 4, T, "create_brand_guideline", {
        workspaceId: env.workspaceId,
        name: brandName,
        tokensJson: ext?.artifacts?.tokensJson,
        designMd: ext?.artifacts?.designMd,
        sharedCss: ext?.artifacts?.sharedCss,
        sourceTemplateIds: [env.templateId],
      });
      log.push("create_brand_guideline");
      brandId = brandRes?.brand?.id;
    }
    if (!brandId) {
      return { ok: false, summary: `✕ El brand no quedó creado ni encontrado — no puedo aplicarlo. ${stepsDone(log)}`, escalationContext: `create_brand_guideline/list no produjeron brand.id para "${brandName}".` };
    }
    await step(env, 5, T, "apply_brand_to_template", { templateId: env.templateId, brandId });
    log.push("apply_brand_to_template");
    return {
      ok: true,
      summary: `✓ Receta style_transfer (${stepsDone(log)}): extraje el sistema de "${tpl?.name}" (${ext?.totalFrames ?? "?"} frames) y apliqué el brand "${brandName}"${reused ? " (ya existía — reutilizado)" : " (creado nuevo)"} a este diseño. Queda guardado para reusar ("crea un post con el brand ${brandName}").`,
    };
  },

  /**
   * "publica esta frame en instagram" — export_frame → list_social_accounts.
   * Sin cuentas conectadas la receta termina HONESTA (regla de Ren): exportado
   * + cómo conectar. Con cuentas pero sin pieza de calendario (cc_) tampoco
   * inventa: publish_content exige una entrada existente y no hay tool que
   * la cree — se lo dice y ofrece publicarla cuando exista.
   */
  recipe_publish_instagram: async (env) => {
    const guard = needTemplate(env) || needWorkspace(env);
    if (guard) return guard;
    const T = 2;
    const { format, note } = parseFormat(env.utterance);
    const ex = await step(env, 1, T, "export_frame", { templateId: env.templateId, format });
    const nFrames = Array.isArray(ex?.frames) ? ex.frames.length : (ex?.totalFrames ?? 1);
    const acc = await step(env, 2, T, "list_social_accounts", { workspaceId: env.workspaceId });
    const accounts = (acc?.connections || []).flatMap((c: any) => c?.accounts || []);
    if (accounts.length === 0) {
      return {
        ok: true,
        summary: `✓ Receta publish_instagram (parcial): exporté ${nFrames} frame(s) en ${format}${note}. Este workspace no tiene Buffer ni Zernio conectados — conéctalos en Contenidos → Conexiones y te lo publico.`,
      };
    }
    return {
      ok: true,
      summary: `✓ Receta publish_instagram (parcial): exporté ${nFrames} frame(s) en ${format}${note}. Hay ${accounts.length} cuenta(s) conectada(s), pero publicar exige una pieza de calendario (cc_) creada desde Contenidos → Publicar; dime cuál y la publico con publish_content.`,
    };
  },

  /**
   * "crea un post de 1080x1350 con el brand X" — list_brand_guidelines →
   * get_brand_guideline → create_html_frame con el sharedCss REAL del brand.
   * Brand inexistente → se detiene y lista los que sí hay (nunca inventa).
   */
  recipe_post_from_brand: async (env) => {
    const guard = needTemplate(env) || needWorkspace(env);
    if (guard) return guard;
    const T = 3;
    const list = await step(env, 1, T, "list_brand_guidelines", { workspaceId: env.workspaceId });
    const brands: any[] = list?.brands || [];
    const brand = matchBrand(extractBrandQuery(env.utterance), brands);
    if (!brand) {
      const nombres = brands.slice(0, 6).map((b: any) => b?.name).filter(Boolean).join(", ") || "(ninguno)";
      return {
        ok: false,
        summary: `✕ No encontré ese brand en tu workspace. Brands disponibles: ${nombres}.`,
        escalationContext: `El humano pidió un post de un brand que no supe resolver contra list_brand_guidelines (${nombres}). Ofrece crear el brand (create_brand_guideline) o usar uno de los existentes.`,
      };
    }
    const g = await step(env, 2, T, "get_brand_guideline", { workspaceId: env.workspaceId, brandId: brand.id });
    const palette = paletteFromBrand(`${g?.sharedCss || ""} ${g?.tokensJson || ""}`);
    const size = parseSize(env.utterance);
    // Contrato de editabilidad del normalizador: las capas con data-layer-id
    // exigen position:absolute + left/top explícitos, y el paint visible va en
    // frame.background — por eso el fondo NO va en el html, va en `background`.
    const html = [
      `<div data-layer-id="post_kicker" style="position:absolute;left:96px;top:${Math.round(size.h * 0.34)}px;font-size:28px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.75;font-family:Inter,sans-serif;">${brand.name}</div>`,
      `<div data-layer-id="post_title" style="position:absolute;left:96px;top:${Math.round(size.h * 0.40)}px;width:${size.w - 192}px;font-size:96px;font-weight:800;line-height:1.05;color:${palette.ink};font-family:Inter,sans-serif;">Post de ${brand.name}</div>`,
      `<div data-layer-id="post_accent" style="position:absolute;left:96px;top:${Math.round(size.h * 0.62)}px;width:160px;height:12px;border-radius:8px;background:${palette.accent};"></div>`,
    ].join("\n");
    const css = g?.sharedCss || `:root { --brand-bg: ${palette.bg}; --brand-ink: ${palette.ink}; --brand-accent: ${palette.accent}; }\n.frame { font-family: Inter, sans-serif; }`;
    await step(env, 3, T, "create_html_frame", {
      templateId: env.templateId,
      name: `Post ${brand.name} ${size.w}×${size.h}`,
      width: size.w, height: size.h,
      html, css,
      background: palette.bg,
    });
    return {
      ok: true,
      summary: `✓ Receta post_from_brand: creé la frame "Post ${brand.name} ${size.w}×${size.h}" (${size.w}×${size.h}) en este diseño, con el estilo real del brand "${brand.name}".`,
    };
  },

  /**
   * "crea un deck a partir de esta plantilla" — get_template(source) →
   * create_deck con las frames REALES como slides (html/css pasan tal cual).
   * Color del brand: primer hex encontrado en el contenido; si no hay, default
   * declarado en la burbuja (transparente, no silencioso).
   */
  recipe_deck_from_template: async (env) => {
    const guard = needTemplate(env) || needWorkspace(env);
    if (guard) return guard;
    const T = 2;
    const tpl = await step(env, 1, T, "get_template", { templateId: env.templateId });
    const frames: any[] = (tpl?.frames || []).filter((f: any) => f?.html || f?.css);
    if (!frames.length) {
      return {
        ok: false,
        summary: `✕ "${tpl?.name || "El diseño"}" no tiene frames con contenido para volcar al deck.`,
        escalationContext: "recipe_deck_from_template: el template fuente no tiene frames con html/css — pregunta al humano qué contenido quiere en el deck.",
      };
    }
    const foundHex = firstHex(frames.map((f: any) => `${f.css || ""} ${f.html || ""}`).join(" "));
    const color = foundHex || "#4F46E5";
    const deck = await step(env, 2, T, "create_deck", {
      workspaceId: env.workspaceId,
      name: `${tpl?.name || "Diseño"} — Deck`,
      brand: { name: tpl?.name || "Musa", color },
      slides: frames.slice(0, 10).map((f: any) => ({
        title: f.name || "Slide",
        html: f.html || `<p>${f.name || ""}</p>`,
        css: f.css || `/* sin css propio en ${f.name || "frame"} */`,
      })),
    });
    return {
      ok: true,
      summary: `✓ Receta deck_from_template: creé "${deck?.name}" con ${deck?.totalFrames ?? "?"} frames (portada + ${frames.slice(0, 10).length} slides con el contenido real). Brand color ${color}${foundHex ? "" : " (default — no encontré hex en el contenido)"}. Ábrelo: ${deck?.templateId || ""}`,
    };
  },

  /**
   * "anima la primera frame" — list_frames → list_animation_presets →
   * set_animation(preset REAL sobre una capa data-layer-id existente).
   * Frame inexistente (p.ej. "la frame 99") → el propio set_animation falla
   * con "Frame not found" y la cadena se detiene ahí: ese es el caso de
   * fallo-en-paso-2, visible chip rojo + burbuja de progreso.
   */
  recipe_animate_frame: async (env) => {
    const guard = needTemplate(env);
    if (guard) return guard;
    const T = 3;
    const lf = await step(env, 1, T, "list_frames", { templateId: env.templateId });
    const frames: any[] = lf?.frames || [];
    const frame = resolveFrame(frames, parseFrameRef(env.utterance));
    // Sin frame resuelta NO pre-fallamos ni guardamos por capa: dejamos que
    // set_animation reciba un id inexistente y sea SU error real ("Frame not
    // found") el que encienda el chip rojo — transparencia del paso exacto.
    const layerId = frame ? String(frame.html || "").match(/data-layer-id="([^"]+)"/)?.[1] : "n/a";
    const presets = await step(env, 2, T, "list_animation_presets", {});
    const preset = (presets?.presets || []).find((p: any) => p?.id === "fade-in") || presets?.presets?.[0];
    if (!preset) {
      return { ok: false, summary: "✕ El catálogo de presets de animación vino vacío.", escalationContext: "list_animation_presets no devolvió presets — revisar ANIMATION_PRESETS en shared/animationSchema.ts." };
    }
    if (frame && !layerId) {
      const nombre = frame?.name || frame?.id;
      return {
        ok: false,
        summary: `✕ La frame "${nombre}" no tiene capas con data-layer-id para animar — ábrela en el editor y agrega capas (texto, cajas) primero.`,
        escalationContext: `recipe_animate_frame: la frame "${nombre}" (${frame.id}) no tiene ninguna capa data-layer-id en su html; los presets de set_animation exigen presetLayerId existente.`,
      };
    }
    await step(env, 3, T, "set_animation", {
      templateId: env.templateId,
      frameId: frame?.id || `frame_inexistente_${parseFrameRef(env.utterance).n ?? 0}`,
      presetIds: [preset.id],
      presetLayerId: layerId,
    });
    return {
      ok: true,
      summary: `✓ Receta animate_frame: preset "${preset.label || preset.id}" aplicado a la capa "${layerId}" de la frame "${frame?.name || ""}". Compila a WAAPI en el editor.`,
    };
  },

  /**
   * "genera un carrusel de 3 slides sobre café" — ai_generate_text(brief) →
   * create_html_carousel(n, frames del texto generado). El texto es DATO real
   * del paso 1: sin respuesta no hay carrusel. El LLM de texto se resuelve
   * server-side con resolveTextLlm (env → BYOK) — multi-proveedor.
   */
  recipe_carrusel_content: async (env) => {
    const guard = needWorkspace(env);
    if (guard) return guard;
    const T = 2;
    const briefMatch = env.utterance.match(/\bcarrusel\b[^a-z0-9]*(?:acerca de|del|de|sobre)\b\s*(?:\d{1,2}\s*(?:slides?|frames?|tarjetas?)\s*)?[^a-z0-9]*(.+)/i);
    // \b tras la preposición: sin él, "de" muerde el prefijo de "del" (bug
    // visto en dogfood: "carrusel del taller SEO" → brief "l taller SEO").
    // El strip final quita una preposición sobrante ("sobre café" → "café").
    const brief = ((briefMatch?.[1] || env.utterance).replace(/\b\d{1,2}\s*(?:slides?|frames?|tarjetas?)\b/gi, "").replace(/^(?:sobre|acerca de|del|de)\s+/i, "").trim()) || "tu marca";
    const n = parseCount(env.utterance, 3);
    const gen = await step(env, 1, T, "ai_generate_text", {
      prompt: `Contenido para un carrusel de Instagram de ${n} tarjetas sobre: ${brief}. Responde EXACTAMENTE ${n} bloques separados por líneas que contengan solo '---'. Cada bloque: primera línea el título (máx 6 palabras), luego 1-2 frases de cuerpo. Español, claro y concreto, sin numerar los bloques.`,
    });
    const text = String(gen?.generated || "");
    // Separadores tolerantes: el contrato pide '---' pero los LLM reales
    // (glm-5.3-flash verificado) suelen responder con párrafos separados por
    // línea en blanco o numeración. Orden: '---' → párrafo doble → "1." —
    // gana el primero que produzca ≥2 bloques; si ninguno, la guarda de
    // abajo corta la receta de forma honesta.
    const splitBlocks = (raw: string): string[] => {
      const byDash = raw.split(/\n?\s*---+\s*\n?/).map(b => b.trim()).filter(Boolean);
      if (byDash.length >= 2) return byDash.slice(0, 10);
      const byPara = raw.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
      if (byPara.length >= 2) return byPara.slice(0, 10);
      const byNum = raw.split(/(?:^|\n)\s*\d{1,2}[.)]\s*/).map(b => b.trim()).filter(Boolean);
      if (byNum.length >= 2) return byNum.slice(0, 10);
      return byDash;
    };
    const blocks = splitBlocks(text);
    if (!blocks.length) {
      return {
        ok: false,
        summary: "✕ La generación de texto vino vacía — no invento el contenido del carrusel.",
        escalationContext: "recipe_carrusel_content: ai_generate_text respondió sin texto utilizable; reintenta o pide el brief de nuevo.",
      };
    }
    const frames = blocks.map((block, i) => {
      const [title, ...rest] = block.split("\n");
      const body = rest.join(" ").trim() || title;
      const t = (title || `Slide ${i + 1}`).slice(0, 80);
      const bg = i === 0 ? "#4F46E5" : "#FFFFFF";
      const ink = i === 0 ? "#FFFFFF" : "#0F172A";
      // Contrato de editabilidad: capas absolute con left/top, paint de fondo
      // en el css de la frame (no en un div estático).
      const html = [
        `<div data-layer-id="slide_num" style="position:absolute;left:88px;top:96px;font-size:26px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.7;color:${ink};font-family:Inter,sans-serif;">${i + 1}/${blocks.length}</div>`,
        `<div data-layer-id="slide_title" style="position:absolute;left:88px;top:420px;width:904px;font-size:76px;font-weight:800;line-height:1.08;color:${ink};font-family:Inter,sans-serif;">${t}</div>`,
        `<div data-layer-id="slide_body" style="position:absolute;left:88px;top:760px;width:904px;font-size:34px;line-height:1.45;opacity:0.85;color:${ink};font-family:Inter,sans-serif;">${body.slice(0, 220)}</div>`,
      ].join("\n");
      const css = `.frame { width: 1080px; height: 1350px; background: ${bg}; font-family: Inter, sans-serif; }`;
      return { name: `Slide ${i + 1}`, html, css };
    });
    const car = await step(env, 2, T, "create_html_carousel", {
      workspaceId: env.workspaceId,
      name: `Carrusel — ${brief.slice(0, 40)}`,
      width: 1080, height: 1350,
      frames,
    });
    return {
      ok: true,
      summary: `✓ Receta carrusel_content: generé ${frames.length} slides sobre "${brief}" y creé el carrusel "${car?.templateId}" (1080×1350).`,
    };
  },
};
