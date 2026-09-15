/**
 * Entry point for .fig uploads: unzip → parse the canvas.fig Kiwi container →
 * build the canonical import document. Parsing failures degrade to a
 * thumbnail-backed fallback document so the import never dies silently.
 */
import { createFallbackImportDocument, type DesignImportDocument } from "../../../../shared/designImport.ts";
import { buildFigDocument } from "./figDocument.ts";
import { parseFigContainer } from "./figContainer.ts";
import { unzip } from "./figZip.ts";

function selectCanvasEntry(files: Map<string, Buffer>): Buffer | undefined {
  for (const [name, bytes] of files) if (/canvas\.fig$/i.test(name)) return bytes;
  for (const [name, bytes] of files) if (/\.fig$/i.test(name)) return bytes;
  return undefined;
}

export function convertFigUpload(bytes: Buffer, name: string): DesignImportDocument {
  const files = unzip(bytes);
  const canvas = selectCanvasEntry(files);
  const thumbnail = files.get("thumbnail.png") || [...files.keys()].find(key => /thumbnail|preview/i.test(key) && /\.(png|jpe?g|webp)$/i.test(key) && files.get(key));
  const previewDataUrl = thumbnail ? `data:image/${String(thumbnail).endsWith(".jpg") || String(thumbnail).endsWith(".jpeg") ? "jpeg" : "png"};base64,${thumbnail.toString("base64")}` : undefined;
  if (!canvas) throw new Error("El .fig no contiene un lienzo de Figma (canvas.fig).");
  try {
    const { schema, data } = parseFigContainer(canvas);
    return buildFigDocument(schema, data, { name });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Error desconocido";
    return createFallbackImportDocument({
      name,
      source: "fig",
      previewDataUrl,
      message: `No se pudo convertir el binario de Figma (${reason}). Se conservó la miniatura; exporta el frame como SVG para editarlo completo.`,
    });
  }
}
