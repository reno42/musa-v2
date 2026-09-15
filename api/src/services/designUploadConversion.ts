import { escapeImportHtml, finalizeImportDocument, importSvgDocument, type DesignImportDocument, type DesignImportSource, type DesignImportArtboard } from "../../../shared/designImport.ts";
import { convertFigUpload } from "./figImport/index.ts";

function rasterArtboard(name: string, index: number, width: number, height: number, dataUrl: string): DesignImportArtboard {
  return { id: `page-${index}`, name, width, height, background: "#ffffff", layers: [{ id: `image-${index}`, name, kind: "image", x: 0, y: 0, width, height, fidelity: "raster", html: `<img src="${escapeImportHtml(dataUrl)}" alt="" style="width:100%;height:100%;object-fit:contain">` }] };
}

/** Binary imports from MCP run locally on the API; originals never reach an external converter. */
export async function convertDesignUpload(bytes: Buffer, source: DesignImportSource, name: string): Promise<DesignImportDocument> {
  if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error("Archivo vacío o mayor de 50 MB.");
  if (source === "svg") return importSvgDocument(bytes.toString("utf8"), name);
  // .fig carries its own Kiwi schema: fully local conversion to editable layers.
  if (source === "fig") return convertFigUpload(bytes, name);
  const { createCanvas, loadImage, ImageData } = await import("@napi-rs/canvas");
  const artboards: DesignImportArtboard[] = [];
  if (source === "psd") {
    const { initializeCanvas, readPsd } = await import("ag-psd");
    if (bytes.toString("ascii", 0, 4) !== "8BPS" || bytes.length < 26) throw new Error("PSD inválido.");
    if (bytes.readUInt32BE(14) * bytes.readUInt32BE(18) > 16_777_216) throw new Error("PSD demasiado grande para conversión automática: máximo 16 megapíxeles.");
    initializeCanvas((w, h) => createCanvas(w, h) as any, (w, h) => new ImageData(w, h) as any);
    const psd = readPsd(bytes, { skipLayerImageData: true, skipThumbnail: true });
    if (!psd.canvas) throw new Error("Guarda el PSD con compatibilidad máxima para incluir su composición visual.");
    const targets = (psd.children || []).filter(layer => !layer.hidden && layer.artboard?.rect);
    if (targets.length) {
      targets.forEach((layer, index) => {
        const rect = layer.artboard!.rect;
        const width = rect.right - rect.left, height = rect.bottom - rect.top;
        const canvas = createCanvas(width, height);
        canvas.getContext("2d").drawImage(psd.canvas as any, -rect.left, -rect.top);
        artboards.push(rasterArtboard(layer.name || `${name} ${index + 1}`, index, width, height, canvas.toDataURL("image/png")));
      });
    } else artboards.push(rasterArtboard(name, 0, psd.width, psd.height, psd.canvas.toDataURL("image/png")));
  } else if (source === "pdf" || source === "ai") {
    if (bytes.toString("ascii", 0, 5) !== "%PDF-") throw new Error("Guarda Illustrator con compatibilidad PDF, o exporta SVG.");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 20) throw new Error("Importa hasta 20 páginas por lote mediante MCP.");
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index);
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 2048 / Math.max(original.width, original.height)) });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas: canvas as any, canvasContext: canvas.getContext("2d") as any, viewport }).promise;
        artboards.push(rasterArtboard(`${name} ${index}`, index, original.width, original.height, canvas.toDataURL("image/png")));
        page.cleanup();
      }
    } finally { await task.destroy(); }
  } else if (source === "image") {
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!png && !jpeg && !webp) throw new Error("Usa PNG, JPEG o WEBP.");
    const image = await loadImage(bytes);
    if (image.width * image.height > 16_777_216) throw new Error("Imagen demasiado grande: máximo 16 megapíxeles.");
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image, 0, 0);
    artboards.push(rasterArtboard(name, 0, image.width, image.height, canvas.toDataURL("image/png")));
  } else throw new Error("Para archivos .fig, importa el enlace de Figma.");
  return finalizeImportDocument({ version: "futuraria-import/v1", name, source, artboards, warnings: [{ code: "binary_visual", message: "Conversión visual como imagen. Para capas nativas usa PSD desde el editor o el enlace de Figma; para vectores usa SVG." }], report: { editable: 0, approximate: 0, raster: 0 } });
}
