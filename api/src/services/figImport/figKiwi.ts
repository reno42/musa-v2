/**
 * Minimal Kiwi reader for Figma .fig payloads.
 *
 * A .fig embeds its own binary Kiwi schema (parsed with kiwi-schema's
 * decodeBinarySchema) and a zstd-compressed message block encoded with that
 * schema. This module decodes data messages straight from the AST instead of
 * using kiwi-schema's generated decoders, because they silently drop enum
 * fields — and node/paint types are enums we need as names.
 */
import * as kiwi from "kiwi-schema";

export interface FigField {
  name: string;
  type: string;
  isArray: boolean;
  field: number;
}

export interface FigDefinition {
  name: string;
  kind: "ENUM" | "STRUCT" | "MESSAGE";
  fields: FigField[];
  enumByValue: Record<number, string>;
}

export interface FigSchema {
  definitions: Map<string, FigDefinition>;
}

const MAX_DEPTH = 64;

const PRIMITIVES = new Set(["bool", "byte", "int", "uint", "float", "string", "int64", "uint64"]);

// Scratch union for the rotated float encoding kiwi uses on the wire.
const floatBits = new Int32Array(1);
const floatWords = new Float32Array(floatBits.buffer);

/** Parse the binary Kiwi schema chunk embedded in a .fig payload. */
export function parseFigSchema(binarySchema: Uint8Array): FigSchema {
  const ast = kiwi.decodeBinarySchema(Buffer.from(binarySchema)) as {
    definitions?: Array<{ name: string; kind?: string; fields?: any[] }>;
  };
  const definitions = new Map<string, FigDefinition>();
  for (const raw of ast.definitions || []) {
    const kind: FigDefinition["kind"] = raw.kind === "ENUM" ? "ENUM" : raw.kind === "STRUCT" ? "STRUCT" : "MESSAGE";
    const enumByValue: Record<number, string> = {};
    const fields: FigField[] = [];
    for (const field of raw.fields || []) {
      if (kind === "ENUM") {
        if (typeof field.value === "number") enumByValue[field.value] = String(field.name);
      } else {
        fields.push({ name: String(field.name), type: String(field.type || ""), isArray: Boolean(field.isArray), field: Number(field.value || 0) });
      }
    }
    definitions.set(String(raw.name), { name: String(raw.name), kind, fields, enumByValue });
  }
  if (!definitions.size) throw new Error("El esquema Kiwi del archivo está vacío.");
  return { definitions };
}

class Reader {
  view: DataView;
  pos = 0;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get remaining() { return this.bytes.length - this.pos; }
  u8(): number {
    if (this.remaining < 1) throw new Error("Kiwi truncado.");
    return this.bytes[this.pos++];
  }
  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.u8();
      result += (byte & 0x7f) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 70) throw new Error("Varint Kiwi inválido.");
    }
    return result;
  }
  varint64(): bigint {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      const byte = this.u8();
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7n;
      if (shift > 70n) throw new Error("Varint Kiwi inválido.");
    }
    return result;
  }
  zigzag(): number {
    const value = this.varint();
    return (value >>> 1) ^ -(value & 1);
  }
  zigzag64(): bigint {
    const value = this.varint64();
    return (value >> 1n) ^ -(value & 1n);
  }
  float(): number {
    if (this.remaining < 1) throw new Error("Kiwi truncado.");
    if (this.bytes[this.pos] === 0) { this.pos += 1; return 0; }
    if (this.remaining < 4) throw new Error("Kiwi truncado.");
    // Kiwi stores float32 bits rotated left by 9; undo the rotation.
    const stored = this.view.getUint32(this.pos, true);
    this.pos += 4;
    floatBits[0] = (((stored << 23) | (stored >>> 9)) | 0);
    return floatWords[0];
  }
  string(): string {
    const out: number[] = [];
    for (;;) {
      const byte = this.u8();
      if (byte === 0) break;
      out.push(byte);
    }
    return Buffer.from(out).toString("utf8");
  }
}

function decodeValue(reader: Reader, schema: FigSchema, type: string, depth: number): unknown {
  if (depth > MAX_DEPTH) throw new Error("Anidación Kiwi demasiado profunda.");
  const definition = schema.definitions.get(type);
  if (!definition) throw new Error(`Tipo Kiwi desconocido: ${type}`);
  if (definition.kind === "ENUM") return definition.enumByValue[reader.varint()] || null;
  if (definition.kind === "STRUCT") {
    const value: Record<string, unknown> = {};
    for (const field of definition.fields) value[field.name] = readField(reader, schema, definition, field, depth);
    return value;
  }
  // MESSAGE: inline (fieldNumber, value) pairs terminated by field 0.
  const value: Record<string, unknown> = {};
  for (;;) {
    if (reader.remaining < 1) throw new Error("Mensaje Kiwi sin terminador.");
    const fieldNumber = reader.varint();
    if (fieldNumber === 0) break;
    const field = definition.fields.find(item => item.field === fieldNumber);
    if (!field) throw new Error(`Campo Kiwi desconocido ${fieldNumber} en ${type}.`);
    value[field.name] = readField(reader, schema, definition, field, depth);
  }
  return value;
}

function readField(reader: Reader, schema: FigSchema, definition: FigDefinition, field: FigField, depth: number): unknown {
  if (field.isArray) {
    const count = reader.varint();
    if (count > reader.remaining + 1_048_576) throw new Error(`Arreglo Kiwi inválido en ${definition.name}.${field.name}.`);
    const values: unknown[] = [];
    for (let index = 0; index < count; index++) values.push(readSingle(reader, schema, field, depth));
    return values;
  }
  return readSingle(reader, schema, field, depth);
}

function readSingle(reader: Reader, schema: FigSchema, field: FigField, depth: number): unknown {
  switch (field.type) {
    case "bool": return reader.u8() !== 0;
    case "byte": return reader.u8();
    case "int": return reader.zigzag();
    case "uint": return reader.varint();
    case "int64": return reader.zigzag64().toString();
    case "uint64": return reader.varint64().toString();
    case "float": return reader.float();
    case "string": return reader.string();
    default: return decodeValue(reader, schema, field.type, depth + 1);
  }
}

const PRIMITIVE_WRITERS: Record<string, (writer: Writer, value: unknown) => void> = {
  bool: (writer, value) => writer.u8(value ? 1 : 0),
  byte: (writer, value) => writer.u8(Number(value) || 0),
  int: (writer, value) => writer.zigzag(Number(value) || 0),
  uint: (writer, value) => writer.varint(Number(value) || 0),
  int64: (writer, value) => writer.zigzag64(BigInt((value as string | number | bigint | boolean) ?? 0)),
  uint64: (writer, value) => writer.varint64(BigInt((value as string | number | bigint | boolean) ?? 0)),
  float: (writer, value) => writer.float(Number(value) || 0),
  string: (writer, value) => writer.string(String(value ?? "")),
};

/** Test-support encoder: mirrors the reader so fixtures can be built offline. */
class Writer {
  chunks: number[] = [];
  u8(byte: number) { this.chunks.push(byte & 0xff); }
  varint(value: number) {
    if (value < 0 || value > 4294967295) throw new Error("Fuera de rango uint: " + value);
    let remaining = value;
    do {
      let byte = remaining & 0x7f;
      remaining = Math.floor(remaining / 128);
      if (remaining > 0) byte |= 0x80;
      this.chunks.push(byte);
    } while (remaining > 0);
  }
  varint64(value: bigint) {
    let remaining = value;
    for (;;) {
      let byte = Number(remaining & 0x7fn);
      remaining >>= 7n;
      if (remaining > 0n) byte |= 0x80;
      this.chunks.push(byte);
      if (remaining === 0n) break;
    }
  }
  zigzag(value: number) { this.varint((value << 1) ^ (value >> 31)); }
  zigzag64(value: bigint) { this.varint64((value << 1n) ^ (value >> 63n)); }
  float(value: number) {
    floatWords[0] = value;
    const stored = (((floatBits[0] << 9) | (floatBits[0] >>> 23)) >>> 0);
    if ((stored & 0xff) === 0) { this.chunks.push(0); return; }
    this.chunks.push(stored & 0xff, (stored >>> 8) & 0xff, (stored >>> 16) & 0xff, (stored >>> 24) & 0xff);
  }
  string(value: string) {
    for (const byte of Buffer.from(value, "utf8")) this.chunks.push(byte);
    this.chunks.push(0);
  }
  bytes(): Uint8Array { return Uint8Array.from(this.chunks); }
}

function writeField(writer: Writer, schema: FigSchema, definition: FigDefinition, field: FigField, value: unknown, depth: number) {
  if (field.isArray) {
    const list = Array.isArray(value) ? value : [];
    writer.varint(list.length);
    for (const item of list) writeSingle(writer, schema, field, item, depth);
    return;
  }
  writeSingle(writer, schema, field, value, depth);
}

function writeSingle(writer: Writer, schema: FigSchema, field: FigField, value: unknown, depth: number) {
  if (depth > MAX_DEPTH) throw new Error("Anidación demasiado profunda.");
  const primitive = PRIMITIVE_WRITERS[field.type];
  if (primitive) return primitive(writer, value);
  const target = schema.definitions.get(field.type);
  if (!target) throw new Error(`Tipo Kiwi desconocido: ${field.type}`);
  if (target.kind === "ENUM") return writer.varint(Number(Object.entries(target.enumByValue).find(([, name]) => name === value)?.[0] ?? 0));
  if (target.kind === "STRUCT") {
    for (const sub of target.fields) writeField(writer, schema, target, sub, (value as any)?.[sub.name], depth + 1);
    return;
  }
  // Nested messages are inlined: their fields then a 0 terminator.
  for (const sub of target.fields) {
    const item = (value as any)?.[sub.name];
    if (item === undefined) continue;
    writer.varint(sub.field);
    writeField(writer, schema, target, sub, item, depth + 1);
  }
  writer.varint(0);
}

/** Encode one message of `typeName` from a plain object (enum values as names). */
export function encodeFigMessage(schema: FigSchema, typeName: string, value: unknown, depth = 0): Uint8Array {
  if (depth > MAX_DEPTH) throw new Error("Anidación demasiado profunda.");
  const definition = schema.definitions.get(typeName);
  if (!definition || definition.kind !== "MESSAGE") throw new Error(`Mensaje Kiwi inexistente: ${typeName}`);
  const writer = new Writer();
  for (const field of definition.fields) {
    const item = (value as any)?.[field.name];
    if (item === undefined) continue;
    writer.varint(field.field);
    writeField(writer, schema, definition, field, item, depth);
  }
  writer.varint(0);
  return writer.bytes();
}

/** Decode one message of `typeName` (enums become their Kiwi names). */
export function decodeFigMessage(schema: FigSchema, typeName: string, bytes: Uint8Array): unknown {
  const reader = new Reader(bytes);
  return decodeValue(reader, schema, typeName, 0);
}
