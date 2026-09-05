import {
  escapeImportHtml,
  finalizeImportDocument,
  importSvgDocument,
  parseFigmaDesignUrl,
  sanitizeImportedSvg,
  safeImportId,
  type DesignImportArtboard,
  type DesignImportDocument,
  type DesignImportLayer,
} from "../../../shared/designImport.ts";
import { fetchRemoteImage } from "./remoteImage.js";

const FIGMA_API = "https://api.figma.com/v1";
const MAX_FIGMA_EXPORTS = 80;

type FetchLike = typeof fetch;

async function figmaJson(url: string, token: string, fetchImpl: FetchLike) {
  const response = await fetchImpl(url, {
    headers: { "X-Figma-Token": token, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "Figma alcanzó el límite de solicitudes. Espera el tiempo indicado por tu plan y reintenta la importación." : response.status === 403 ? "Figma rechazó el token: verifica los permisos current_user:read y file_content:read y el acceso al archivo." : `Figma respondió HTTP ${response.status}.`);
  return response.json() as Promise<any>;
}

export async function testFigmaToken(token: string, fetchImpl: FetchLike = fetch) {
  const me = await figmaJson(`${FIGMA_API}/me`, token, fetchImpl);
  return { id: String(me.id || ""), handle: String(me.handle || me.email || "Cuenta de Figma") };
}

function findNode(root: any, id: string): any | undefined {
  if (!root) return undefined;
  if (String(root.id) === id) return root;
  for (const child of root.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

function nodeBox(node: any, origin: { x: number; y: number }) {
  const box = node.absoluteBoundingBox || {};
  return {
    x: Math.round(Number(box.x || 0) - origin.x),
    y: Math.round(Number(box.y || 0) - origin.y),
    width: Math.max(1, Math.round(Number(box.width || 1))),
    height: Math.max(1, Math.round(Number(box.height || 1))),
  };
}

function textLayer(node: any, origin: { x: number; y: number }): DesignImportLayer {
  const box = nodeBox(node, origin);
  const style = node.style || {};
  const fill = (node.fills || []).find((item: any) => item?.type === "SOLID" && item.visible !== false)?.color;
  const color = fill ? `rgba(${Math.round(fill.r * 255)},${Math.round(fill.g * 255)},${Math.round(fill.b * 255)},${fill.a ?? 1})` : "#000000";
  const align = String(style.textAlignHorizontal || "LEFT").toLowerCase();
  const html = `<div style="width:100%;height:100%;white-space:pre-wrap;font-family:${escapeImportHtml(String(style.fontFamily || "sans-serif"))};font-size:${Number(style.fontSize || 16)}px;font-weight:${Number(style.fontWeight || 400)};line-height:${Number(style.lineHeightPx || style.fontSize || 16)}px;text-align:${align};color:${color}">${escapeImportHtml(String(node.characters || ""))}</div>`;
  return { id: `figma-${safeImportId(String(node.id))}`, name: String(node.name || "Text"), kind: "text", ...box, fidelity: "editable", html };
}

async function exportedLayer(node: any, origin: { x: number; y: number }, svgUrl: string | undefined, fetchImpl: FetchLike): Promise<DesignImportLayer> {
  const box = nodeBox(node, origin);
  if (!svgUrl) throw new Error(`Figma no pudo exportar la capa ${node.name || node.id}.`);
  // The export URL is produced by Figma, but can redirect to its CDN. Reuse
  // the repository's bounded downloader: it validates DNS on every redirect,
  // enforces HTTPS, MIME and a 5 MB ceiling.
  const downloaded = fetchImpl === fetch
    ? await fetchRemoteImage(svgUrl)
    : await (async () => {
        const response = await fetchImpl(svgUrl, { redirect: "error", signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`No se pudo descargar la capa ${node.name || node.id}.`);
        const mimeType = (response.headers.get("content-type") || "image/svg+xml").split(";")[0];
        return { buffer: Buffer.from(await response.arrayBuffer()), mimeType };
      })();
  if (downloaded.mimeType !== "image/svg+xml") throw new Error(`La capa ${node.name || node.id} no devolvió SVG.`);
  const svg = sanitizeImportedSvg(downloaded.buffer.toString("utf8"));
  return { id: `figma-${safeImportId(String(node.id))}`, name: String(node.name || node.type), kind: "vector", ...box, fidelity: "approximate", html: svg };
}

function chooseArtboards(documentNode: any, nodeId?: string) {
  if (nodeId) {
    const selected = findNode(documentNode, nodeId);
    if (!selected) throw new Error("El node-id no existe en ese archivo de Figma.");
    if (selected.children?.length) return [selected];
    // A link may target a single text/vector node, not a frame. Treat its
    // bounds as a one-layer artboard instead of returning an empty placeholder.
    return [{
      id: `selection-${selected.id}`,
      name: selected.name || "Figma selection",
      type: "FRAME",
      absoluteBoundingBox: selected.absoluteBoundingBox,
      children: [selected],
    }];
  }
  const pages = documentNode.children || [];
  const frames = pages.flatMap((page: any) => (page.children || []).filter((node: any) => ["FRAME", "COMPONENT", "SECTION"].includes(node.type)));
  return frames.length ? frames : pages.slice(0, 1);
}

export async function importFigmaUrl(rawUrl: string, token: string, fetchImpl: FetchLike = fetch): Promise<DesignImportDocument> {
  const { fileKey, nodeId } = parseFigmaDesignUrl(rawUrl);
  const file = await figmaJson(`${FIGMA_API}/files/${encodeURIComponent(fileKey)}?geometry=paths`, token, fetchImpl);
  const nodes = chooseArtboards(file.document, nodeId);
  const exportNodes = nodes.flatMap((node: any) => (node.children || []).filter((child: any) => child.type !== "TEXT" && child.visible !== false));
  if (exportNodes.length > MAX_FIGMA_EXPORTS) throw new Error(`Selecciona un frame con menos de ${MAX_FIGMA_EXPORTS} capas visuales para importar este archivo por partes.`);
  const ids = exportNodes.map((node: any) => node.id);
  const imageMap = ids.length
    ? (await figmaJson(`${FIGMA_API}/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(ids.join(","))}&format=svg&svg_include_id=true`, token, fetchImpl)).images || {}
    : {};
  const warnings: DesignImportDocument["warnings"] = [{ code: "figma_fidelity", message: "Texto simple editable; las demás capas se conservan como bloques vectoriales. Las fuentes deben estar instaladas para mantener su apariencia." }];
  if (exportNodes.length >= MAX_FIGMA_EXPORTS) warnings.push({ code: "figma_export_limit", message: `Se importaron las primeras ${MAX_FIGMA_EXPORTS} capas visuales de este lote.` });

  const artboards: DesignImportArtboard[] = [];
  for (const node of nodes) {
    const bounds = node.absoluteBoundingBox || { x: 0, y: 0, width: 1080, height: 1080 };
    const origin = { x: Number(bounds.x || 0), y: Number(bounds.y || 0) };
    const layers: DesignImportLayer[] = [];
    for (const child of node.children || []) {
      if (child.visible === false) continue;
      if (child.type === "TEXT") layers.push(textLayer(child, origin));
      else {
        try { layers.push(await exportedLayer(child, origin, imageMap[child.id], fetchImpl)); }
        catch (error) {
          const box = nodeBox(child, origin);
          layers.push({ id: `figma-${safeImportId(String(child.id))}`, name: String(child.name || child.type), kind: "fallback", ...box, fidelity: "approximate", html: `<div style="padding:8px;color:#9f1239;background:#fff1f2">No se pudo importar: ${escapeImportHtml(String(child.name || child.id))}</div>` });
          warnings.push({ code: "figma_layer_fallback", layerId: String(child.id), message: error instanceof Error ? error.message : "Una capa no pudo convertirse." });
        }
      }
    }
    if (!layers.length) {
      const fallback = importSvgDocument(`<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width || 1080}" height="${bounds.height || 1080}"><rect width="100%" height="100%" fill="#f5f5f4"/></svg>`, String(node.name || "Figma"));
      layers.push(...fallback.artboards[0].layers);
      warnings.push({ code: "figma_empty_frame", message: "El frame no contenía capas visibles; se creó un lienzo de referencia." });
    }
    artboards.push({ id: `figma-artboard-${safeImportId(String(node.id))}`, name: String(node.name || "Figma frame"), width: Math.max(1, Math.round(bounds.width || 1080)), height: Math.max(1, Math.round(bounds.height || 1080)), background: "#ffffff", layers });
  }
  return finalizeImportDocument({ version: "futuraria-import/v1", name: String(file.name || "Figma import"), source: "figma", artboards, warnings, report: { editable: 0, approximate: 0, raster: 0 } });
}
