/**
 * photoTargets — inventario de fotos raster del diseño para el Modo Foto
 * (REQ-PHOTO-PLATFORM-001 §5: "una tira inferior muestra las demás fotos
 * raster usadas en el diseño").
 *
 * PURO y sin DOM: parsea el html de los frames con regex para poder correr
 * en QA de node. Nunca rasteriza el diseño — solo lista referencias.
 */

export interface PhotoTarget {
  /** frame dueño de la capa; null = objeto huérfano del lienzo. */
  frameId: string | null;
  layerId: string;
  src: string;
  name: string;
  /** Receta previa embebida en la capa (data-photo-recipe, base64url). */
  recipeAttr: string | null;
}

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const ATTR_RE = (name: string) => new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i");

function attr(tag: string, name: string): string | null {
  const m = tag.match(ATTR_RE(name));
  return m ? m[2] ?? m[1] : null;
}

/** Extrae los <img data-layer-id> de un frame html (orden de documento). */
export function parseFrameImages(frameId: string, html: string): PhotoTarget[] {
  if (!html) return [];
  const out: PhotoTarget[] = [];
  for (const m of html.matchAll(IMG_TAG_RE)) {
    const tag = m[0];
    const layerId = attr(tag, "data-layer-id") ?? "";
    const src = attr(tag, "src") ?? "";
    if (!layerId || !src) continue;
    out.push({
      frameId,
      layerId,
      src,
      name: attr(tag, "data-layer-name") || attr(tag, "alt") || "Foto",
      recipeAttr: attr(tag, "data-photo-recipe"),
    });
  }
  return out;
}

/**
 * collectPhotoTargets — fotos del diseño: capas <img> de frames + objetos
 * huérfanos kind "image", agrupadas por src (la MISMA foto usada en varias
 * capas aparece una vez; "aplicar a todas las instancias" opera sobre ese
 * grupo). El orden es estable: frames primero, huérfanos después.
 */
export function collectPhotoTargets(
  frames: Array<{ id: string; html: string }>,
  canvasObjects: Array<{ id: string; kind: string; html: string; name?: string }>,
): PhotoTarget[] {
  const out: PhotoTarget[] = [];
  for (const f of frames) out.push(...parseFrameImages(f.id, f.html || ""));
  for (const o of canvasObjects || []) {
    if (o.kind !== "image") continue;
    const imgs = parseFrameImages(null as unknown as string, o.html || "");
    for (const t of imgs) {
      out.push({ ...t, frameId: null, name: o.name || t.name });
    }
  }
  return out;
}

/** Agrupa targets por src preservando el primer orden de aparición. */
export function groupTargetsBySrc(targets: PhotoTarget[]): Map<string, PhotoTarget[]> {
  const groups = new Map<string, PhotoTarget[]>();
  for (const t of targets) {
    const list = groups.get(t.src) || [];
    list.push(t);
    groups.set(t.src, list);
  }
  return groups;
}
