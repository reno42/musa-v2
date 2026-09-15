/**
 * canvas.fig container: [magic:8 "fig-kiwi"|"fig-makee"][version:4]
 * [schema_length:4][zlib schema][data_length:4][zstd data].
 */
import { inflateSync, zstdDecompressSync } from "node:zlib";
import { parseFigSchema, type FigSchema } from "./figKiwi.ts";

const MAGICS = new Set(["fig-kiwi", "fig-makee"]);

export interface FigPayload {
  schema: FigSchema;
  data: Buffer;
  magic: string;
}

export function parseFigContainer(bytes: Buffer): FigPayload {
  if (bytes.length < 20) throw new Error("canvas.fig demasiado corto.");
  const magic = bytes.toString("latin1", 0, 8);
  if (!MAGICS.has(magic)) throw new Error(`El archivo no es un lienzo de Figma (firma "${magic.replace(/[^\x20-\x7e]/g, "?")}" desconocida).`);
  const schemaLength = bytes.readUInt32LE(12);
  if (schemaLength <= 0 || 16 + schemaLength + 4 > bytes.length) throw new Error("Esquema Kiwi corrupto.");
  const schema = parseFigSchema(inflateSync(bytes.subarray(16, 16 + schemaLength)));
  const dataStart = 16 + schemaLength;
  const dataLength = bytes.readUInt32LE(dataStart);
  if (dataLength <= 0 || dataStart + 4 + dataLength > bytes.length) throw new Error("Bloque de datos Kiwi corrupto.");
  const compressed = bytes.subarray(dataStart + 4, dataStart + 4 + dataLength);
  const data = zstdDecompressSync(compressed);
  return { schema, data, magic };
}
