/**
 * sceneRenderer — renderer WebGL2 determinista para MusaSceneSpec v1 (REQ-052).
 *
 * Cero dependencias, shaders como strings TS (convención del repo). El ÚNICO
 * sampler es shared/sceneSpec.ts::sampleSceneAt, así la preview viva y el
 * export observan exactamente el mismo resultado para el mismo (spec, timeMs).
 * Sin WebGL2 → createSceneGLRenderer devuelve null y el caller debe mostrar
 * un error explícito: nunca degradar en silencio.
 *
 * Alcance v1 (declarado): PBR-lite (Lambert+Blinn-Phong, ≤8 luces), primitivas
 * procedurales, GLB atómico (POSITION/NORMAL/uv/índices + TRS + baseColorFactor),
 * text3d como panel texturado billboard, partículas gl.POINTS closed-form.
 * Bloom/postFX NO se renderizan (fidelity.unsupported del contrato los reporta).
 */
import {
  particlePositionAt,
  sampleSceneAt,
  type MusaSceneSpec,
  type SceneOverrides,
  type SceneSample,
  type SampledSceneNode,
} from "../../shared/sceneSpec.ts";
import { apiFetch } from "./supabase.ts";

const MAX_LIGHTS = 8;

// ── Spec por referencia (preview y export comparten la cache) ──────────────

interface SceneSpecRowResponse {
  success?: boolean;
  data?: {
    spec?: {
      id?: string;
      schema_version?: string;
      normalized_spec?: MusaSceneSpec;
    } | null;
  };
}

const sceneSpecCache = new Map<string, MusaSceneSpec>();

export function getCachedSceneSpec(projectId: string, sceneSpecId: string): MusaSceneSpec | null {
  return sceneSpecCache.get(`${projectId}:${sceneSpecId}`) ?? null;
}

/** Descarga el spec normalizado vía REST. Falla EXPLÍCITO (nunca degrada en
 *  silencio): sin fila, id discrepante o error de red → Error con mensaje
 *  accionable que preview y export muestran tal cual. */
export async function loadSceneSpec(projectId: string, sceneSpecId: string): Promise<MusaSceneSpec> {
  const key = `${projectId}:${sceneSpecId}`;
  const cached = sceneSpecCache.get(key);
  if (cached) return cached;
  const body = await apiFetch<SceneSpecRowResponse>(
    `/api/video-projects/${encodeURIComponent(projectId)}/scene-spec`,
  );
  const row = body?.data?.spec;
  if (!row?.normalized_spec) {
    throw new Error("Este proyecto no tiene SceneSpec guardado. Vuelve a aplicar la escena desde la IA.");
  }
  // row.id es el sceneSpecId aplicado (fixed-id upsert): si difiere del
  // payload del material, el doc quedó viejo tras un re-apply.
  if (row.id && row.id !== sceneSpecId) {
    throw new Error(`El SceneSpec aplicado (${row.id}) no coincide con el material (${sceneSpecId}). Recarga el proyecto.`);
  }
  sceneSpecCache.set(key, row.normalized_spec);
  return row.normalized_spec;
}

/** Tras un re-apply de la IA, la cache del proyecto se invalida. */
export function invalidateSceneSpecCache(projectId: string): void {
  for (const key of sceneSpecCache.keys()) {
    if (key.startsWith(`${projectId}:`)) sceneSpecCache.delete(key);
  }
}

// ── mat4 (column-major, orden WebGL) ────────────────────────────────────────

type Mat4 = Float32Array;

function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function mat4Perspective(fovDeg: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / Math.max(0.0001, aspect);
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function mat4LookAt(eye: [number, number, number], target: [number, number, number]): Mat4 {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  len = Math.hypot(xx, xy, xz);
  if (len < 1e-5) { xx = 1; xy = 0; xz = 0; } else { xx /= len; xy /= len; xz /= len; }
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

/** T · Rz·Ry·Rx · S en grados (convención de rotación del contrato). */
function mat4FromTRS(
  t: [number, number, number],
  rotDeg: [number, number, number],
  s: [number, number, number],
): Mat4 {
  const deg2rad = Math.PI / 180;
  const rx = rotDeg[0] * deg2rad;
  const ry = rotDeg[1] * deg2rad;
  const rz = rotDeg[2] * deg2rad;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const r00 = cy * cz + sy * sx * sz;
  const r01 = cx * sz;
  const r02 = -sy * cz + cy * sx * sz;
  const r10 = -cy * sz + sy * sx * cz;
  const r11 = cx * cz;
  const r12 = sy * sz + cy * sx * cz;
  const r20 = cx * sy;
  const r21 = -sx;
  const r22 = cx * cy;
  const m = new Float32Array(16);
  m[0] = r00 * s[0]; m[1] = r10 * s[0]; m[2] = r20 * s[0]; m[3] = 0;
  m[4] = r01 * s[1]; m[5] = r11 * s[1]; m[6] = r21 * s[1]; m[7] = 0;
  m[8] = r02 * s[2]; m[9] = r12 * s[2]; m[10] = r22 * s[2]; m[11] = 0;
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}

function mat4FromBasis(
  right: [number, number, number],
  up: [number, number, number],
  fwd: [number, number, number],
  t: [number, number, number],
): Mat4 {
  const m = new Float32Array(16);
  m[0] = right[0]; m[1] = right[1]; m[2] = right[2]; m[3] = 0;
  m[4] = up[0]; m[5] = up[1]; m[6] = up[2]; m[7] = 0;
  m[8] = fwd[0]; m[9] = fwd[1]; m[10] = fwd[2]; m[11] = 0;
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}

/** Inversa-transpuesta de la 3×3 superior (matriz de normales). */
function normalMatrixFrom(model: Mat4): Float32Array {
  const a = model;
  const b00 = a[0] * a[5] - a[1] * a[4];
  const b01 = a[0] * a[6] - a[2] * a[4];
  const b02 = a[0] * a[7] - a[3] * a[4];
  const b03 = a[1] * a[6] - a[2] * a[5];
  const b04 = a[1] * a[7] - a[3] * a[5];
  const b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12];
  const b07 = a[8] * a[14] - a[10] * a[12];
  const b08 = a[8] * a[15] - a[11] * a[12];
  const b09 = a[9] * a[14] - a[10] * a[13];
  const b10 = a[9] * a[15] - a[11] * a[13];
  const b11 = a[10] * a[15] - a[11] * a[14];
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) det = 1;
  const inv = 1 / det;
  const out = new Float32Array(9);
  out[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * inv;
  out[1] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * inv;
  out[2] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * inv;
  out[3] = (a[2] * b10 - a[3] * b11 - a[1] * b09) * inv;
  out[4] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * inv;
  out[5] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * inv;
  out[6] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * inv;
  out[7] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * inv;
  out[8] = (a[12] * b04 - a[13] * b02 + a[14] * b01) * inv;
  return out;
}

// ── Geometrías procedurales ─────────────────────────────────────────────────

export interface SceneGeometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

function geometryBox(): SceneGeometry {
  const faces: Array<{ n: [number, number, number]; t: [number, number, number]; b: [number, number, number] }> = [
    { n: [0, 0, 1], t: [1, 0, 0], b: [0, 1, 0] },
    { n: [0, 0, -1], t: [-1, 0, 0], b: [0, 1, 0] },
    { n: [1, 0, 0], t: [0, 0, -1], b: [0, 1, 0] },
    { n: [-1, 0, 0], t: [0, 0, 1], b: [0, 1, 0] },
    { n: [0, 1, 0], t: [1, 0, 0], b: [0, 0, -1] },
    { n: [0, -1, 0], t: [1, 0, 0], b: [0, 0, 1] },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  faces.forEach((face, f) => {
    const base = f * 4;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      positions.push(
        (face.n[0] + u * face.t[0] + v * face.b[0]) * 0.5,
        (face.n[1] + u * face.t[1] + v * face.b[1]) * 0.5,
        (face.n[2] + u * face.t[2] + v * face.b[2]) * 0.5,
      );
      normals.push(...face.n);
      uvs.push((u + 1) / 2, (v + 1) / 2);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

function geometrySphere(segments = 32, rings = 20): SceneGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= rings; y++) {
    const v = y / rings;
    const phi = v * Math.PI;
    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const theta = u * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);
      positions.push(nx * 0.5, ny * 0.5, nz * 0.5);
      normals.push(nx, ny, nz);
      uvs.push(u, 1 - v);
    }
  }
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * (segments + 1) + x;
      indices.push(a, a + segments + 1, a + segments + 2, a, a + segments + 2, a + 1);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

function geometryPlane(): SceneGeometry {
  return {
    positions: new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

/** Panel XY centrado — geometría de text3d (normal +Z). */
function geometryTextQuad(): SceneGeometry {
  return {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

function geometryLathe(profile: Array<[number, number]>, segments = 32): SceneGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < profile.length; i++) {
    const [radius, y] = profile[i];
    const next = profile[Math.min(i + 1, profile.length - 1)];
    const prev = profile[Math.max(i - 1, 0)];
    const dr = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const slope = Math.hypot(dr, dy) || 1;
    for (let s = 0; s <= segments; s++) {
      const u = s / segments;
      const theta = u * Math.PI * 2;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      positions.push(ct * radius * 0.5, y, st * radius * 0.5);
      normals.push(dy * ct / slope, -dr / slope, dy * st / slope);
      uvs.push(u, i / Math.max(1, profile.length - 1));
    }
  }
  const row = segments + 1;
  for (let i = 0; i < profile.length - 1; i++) {
    for (let s = 0; s < segments; s++) {
      const a = i * row + s;
      indices.push(a, a + row, a + row + 1, a, a + row + 1, a + 1);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

function geometryCylinder(): SceneGeometry {
  return geometryLathe([[1, -0.5], [1, 0.5]]);
}

function geometryCone(): SceneGeometry {
  return geometryLathe([[1, -0.5], [0.001, 0.5]]);
}

function geometryTorus(): SceneGeometry {
  const R = 0.35;
  const r = 0.15;
  const segs = 36;
  const tube = 18;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const u = (i / segs) * Math.PI * 2;
    for (let j = 0; j <= tube; j++) {
      const v = (j / tube) * Math.PI * 2;
      positions.push((R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u));
      normals.push(Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u));
      uvs.push(i / segs, j / tube);
    }
  }
  const row = tube + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < tube; j++) {
      const a = i * row + j;
      indices.push(a, a + row, a + row + 1, a, a + row + 1, a + 1);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

function proceduralGeometry(primitive: string): SceneGeometry | null {
  switch (primitive) {
    case "box": return geometryBox();
    case "sphere": return geometrySphere();
    case "plane": return geometryPlane();
    case "cylinder": return geometryCylinder();
    case "cone": return geometryCone();
    case "torus": return geometryTorus();
    case "textQuad": return geometryTextQuad();
    default: return null;
  }
}

// ── Loader GLB mínimo (glTF 2.0 binario; triángulos + TRS + baseColor) ─────

export interface SceneGlbMesh extends SceneGeometry {
  baseColor?: [number, number, number];
}

function accessorView(bin: DataView, json: any, index: number): { data: Float32Array | Uint32Array | Uint16Array; count: number } | null {
  const accessor = json.accessors?.[index];
  if (!accessor) return null;
  const view = json.bufferViews?.[accessor.bufferView];
  if (!view) return null;
  const byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const components = accessor.type === "VEC3" ? 3 : accessor.type === "VEC2" ? 2 : 1;
  const length = accessor.count * components;
  if (accessor.componentType === 5126) return { data: new Float32Array(bin.buffer, bin.byteOffset + byteOffset, length), count: accessor.count };
  if (accessor.componentType === 5125) return { data: new Uint32Array(bin.buffer, bin.byteOffset + byteOffset, length), count: accessor.count };
  if (accessor.componentType === 5123) return { data: new Uint16Array(bin.buffer, bin.byteOffset + byteOffset, length), count: accessor.count };
  return null;
}

function quatToMat4(q: number[], t: number[], s: number[]): Mat4 {
  const [x, y, z, w] = q;
  const m = new Float32Array(16);
  m[0] = (1 - 2 * y * y - 2 * z * z) * s[0];
  m[1] = (2 * x * y + 2 * z * w) * s[0];
  m[2] = (2 * x * z - 2 * y * w) * s[0];
  m[4] = (2 * x * y - 2 * z * w) * s[1];
  m[5] = (1 - 2 * x * x - 2 * z * z) * s[1];
  m[6] = (2 * y * z + 2 * x * w) * s[1];
  m[8] = (2 * x * z + 2 * y * w) * s[2];
  m[9] = (2 * y * z - 2 * x * w) * s[2];
  m[10] = (1 - 2 * x * x - 2 * y * y) * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}

const glbCache = new Map<string, Promise<SceneGlbMesh[]>>();

/** Carga y aplanado GLB: los vértices quedan en espacio-mundo del modelo por
 *  nodo (transform TRS del spec se aplica encima al dibujar). Atomic: la
 *  topología NO se edita — mover/recolorearse/recambiarse, no deformarse. */
export function loadSceneGlb(url: string): Promise<SceneGlbMesh[]> {
  const cached = glbCache.get(url);
  if (cached) return cached;
  const promise = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GLB ${res.status}: ${url}`);
    const buffer = await res.arrayBuffer();
    const header = new DataView(buffer);
    if (header.getUint32(0, true) !== 0x46546c67) throw new Error("GLB inválido (magic)");
    let offset = 12;
    let json: any = null;
    let bin: DataView | null = null;
    while (offset + 8 <= buffer.byteLength) {
      const chunkLength = header.getUint32(offset, true);
      const chunkType = header.getUint32(offset + 4, true);
      const start = offset + 8;
      if (chunkType === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, chunkLength)));
      else if (chunkType === 0x004e4942) bin = new DataView(buffer, start, chunkLength);
      offset = start + chunkLength;
    }
    if (!json || !bin) throw new Error("GLB sin chunks JSON/BIN");
    const meshes: SceneGlbMesh[] = [];
    const visit = (nodeIndex: number, parent: Mat4): void => {
      const node = json.nodes?.[nodeIndex];
      if (!node) return;
      const local = Array.isArray(node.matrix) && node.matrix.length === 16
        ? new Float32Array(node.matrix)
        : quatToMat4(node.rotation || [0, 0, 0, 1], node.translation || [0, 0, 0], node.scale || [1, 1, 1]);
      const world = mat4Multiply(parent, local);
      if (node.mesh !== undefined) {
        const mesh = json.meshes?.[node.mesh];
        for (const primitive of mesh?.primitives || []) {
          if ((primitive.mode ?? 4) !== 4) continue; // solo TRIANGLES (documentado en el contrato)
          const positions = accessorView(bin!, json, primitive.attributes.POSITION);
          if (!positions || positions.data.length < positions.count * 3) continue;
          const normalsAccessor = primitive.attributes.NORMAL !== undefined ? accessorView(bin!, json, primitive.attributes.NORMAL) : null;
          const uvAccessor = primitive.attributes.TEXCOORD_0 !== undefined ? accessorView(bin!, json, primitive.attributes.TEXCOORD_0) : null;
          const indicesAccessor = primitive.indices !== undefined ? accessorView(bin!, json, primitive.indices) : null;
          const count = positions.count;
          const outPositions = new Float32Array(count * 3);
          const outNormals = new Float32Array(count * 3);
          const outUvs = new Float32Array(count * 2);
          const nm = normalMatrixFrom(world);
          for (let i = 0; i < count; i++) {
            const x = positions.data[i * 3] ?? 0;
            const y = positions.data[i * 3 + 1] ?? 0;
            const z = positions.data[i * 3 + 2] ?? 0;
            outPositions[i * 3] = world[0] * x + world[4] * y + world[8] * z + world[12];
            outPositions[i * 3 + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
            outPositions[i * 3 + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
            if (normalsAccessor && normalsAccessor.data.length >= i * 3 + 3) {
              const nx = normalsAccessor.data[i * 3];
              const ny = normalsAccessor.data[i * 3 + 1];
              const nz = normalsAccessor.data[i * 3 + 2];
              const vx = nm[0] * nx + nm[3] * ny + nm[6] * nz;
              const vy = nm[1] * nx + nm[4] * ny + nm[7] * nz;
              const vz = nm[2] * nx + nm[5] * ny + nm[8] * nz;
              const l = Math.hypot(vx, vy, vz) || 1;
              outNormals[i * 3] = vx / l;
              outNormals[i * 3 + 1] = vy / l;
              outNormals[i * 3 + 2] = vz / l;
            } else {
              outNormals[i * 3 + 1] = 1;
            }
            if (uvAccessor && uvAccessor.data.length >= i * 2 + 2) {
              outUvs[i * 2] = uvAccessor.data[i * 2];
              outUvs[i * 2 + 1] = uvAccessor.data[i * 2 + 1];
            }
          }
          const indexCount = indicesAccessor && indicesAccessor.data.length >= indicesAccessor.count ? indicesAccessor.count : count;
          const outIndices = new Uint32Array(indexCount);
          for (let i = 0; i < indexCount; i++) {
            outIndices[i] = indicesAccessor ? Number(indicesAccessor.data[i]) : i;
          }
          const material = primitive.material !== undefined ? json.materials?.[primitive.material] : null;
          const baseColor = material?.pbrMetallicRoughness?.baseColorFactor;
          meshes.push({
            positions: outPositions,
            normals: outNormals,
            uvs: outUvs,
            indices: outIndices,
            ...(Array.isArray(baseColor) && baseColor.length >= 3 ? { baseColor: [baseColor[0], baseColor[1], baseColor[2]] } : {}),
          });
        }
      }
      for (const child of node.children || []) visit(child, world);
    };
    const scenes = Array.isArray(json.scenes) && json.scenes.length ? json.scenes : [{ nodes: (json.nodes || []).map((_: unknown, i: number) => i) }];
    for (const scene of scenes) {
      for (const nodeIndex of scene.nodes || []) visit(nodeIndex, mat4Identity());
    }
    if (!meshes.length) throw new Error("GLB sin triángulos compatibles");
    return meshes;
  })();
  glbCache.set(url, promise);
  return promise;
}

// ── Shaders ────────────────────────────────────────────────────────────────

const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;
out vec3 vNormal;
out vec3 vWorld;
out vec2 vUv;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  vUv = aUv;
  gl_Position = uProj * uView * w;
}`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in vec2 vUv;
uniform vec3 uColor;
uniform vec3 uCamera;
uniform int uLightCount;
uniform vec3 uLightPos[${MAX_LIGHTS}];
uniform vec3 uLightColor[${MAX_LIGHTS}];
uniform int uLightType[${MAX_LIGHTS}];
uniform float uLightIntensity[${MAX_LIGHTS}];
uniform float uMetal;
uniform float uRough;
uniform float uOpacity;
uniform sampler2D uTex;
uniform float uUseTex;
out vec4 outColor;
void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamera - vWorld);
  vec3 base = uColor;
  vec3 specTint = mix(vec3(0.04), base, uMetal);
  vec3 diffuse = base * (1.0 - uMetal);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++){
    if (i >= uLightCount) break;
    if (uLightType[i] == 2){ acc += uLightColor[i] * uLightIntensity[i] * 0.3 * diffuse; continue; }
    vec3 L;
    float att = 1.0;
    if (uLightType[i] == 0){ L = normalize(uLightPos[i]); }
    else { vec3 d = uLightPos[i] - vWorld; float dist = length(d); L = normalize(d); att = 1.0 / (1.0 + 0.05 * dist * dist); }
    float ndl = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float p = mix(96.0, 8.0, uRough);
    float sp = pow(max(dot(N, H), 0.0), p) * (0.2 + 0.8 * uMetal);
    acc += (diffuse * ndl + specTint * sp) * uLightColor[i] * uLightIntensity[i] * att;
  }
  vec3 col = acc + base * 0.06;
  float alpha = uOpacity;
  if (uUseTex > 0.5){
    vec4 t = texture(uTex, vUv);
    col = t.rgb * max(acc + vec3(0.25), vec3(0.35));
    alpha = t.a * uOpacity;
  }
  outColor = vec4(col, alpha);
}`;

const POINTS_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uSize;
void main(){
  gl_Position = uProj * uView * vec4(aPos, 1.0);
  gl_PointSize = uSize;
}`;

const POINTS_FS = `#version 300 es
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
out vec4 outColor;
void main(){
  vec2 d = gl_PointCoord - vec2(0.5);
  if (dot(d, d) > 0.25) discard;
  outColor = vec4(uColor, uOpacity);
}`;

function hexToRgb(hex: string): [number, number, number] {
  let body = hex.slice(1);
  if (body.length === 3 || body.length === 4) body = body.slice(0, 3).split("").map((c) => c + c).join("");
  return [
    parseInt(body.slice(0, 2), 16) / 255,
    parseInt(body.slice(2, 4), 16) / 255,
    parseInt(body.slice(4, 6), 16) / 255,
  ];
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("[sceneRenderer] shader:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const v = compileShader(gl, gl.VERTEX_SHADER, vs);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error("[sceneRenderer] link:", gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

interface GpuGeometry {
  vao: WebGLVertexArrayObject;
  indexCount: number;
}

interface SceneLightUniforms {
  pos: [number, number, number];
  color: [number, number, number];
  type: number; // 0 directional, 1 point, 2 ambient
  intensity: number;
}

export interface SceneGLRenderer {
  /** Descarga los GLB del spec (cacheados por URL). Devuelve assetIds que fallaron. */
  prepare(spec: MusaSceneSpec): Promise<string[]>;
  render(spec: MusaSceneSpec, timeMs: number, overrides?: SceneOverrides | null): void;
  dispose(): void;
}

export function createSceneGLRenderer(canvas: HTMLCanvasElement): SceneGLRenderer | null {
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, preserveDrawingBuffer: true });
  if (!gl) return null;

  const meshProgram = linkProgram(gl, MESH_VS, MESH_FS);
  const pointsProgram = linkProgram(gl, POINTS_VS, POINTS_FS);
  if (!meshProgram || !pointsProgram) return null;

  const u = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
  const meshU = {
    view: u(meshProgram, "uView"), proj: u(meshProgram, "uProj"), model: u(meshProgram, "uModel"),
    normalMat: u(meshProgram, "uNormalMat"), color: u(meshProgram, "uColor"), camera: u(meshProgram, "uCamera"),
    lightCount: u(meshProgram, "uLightCount"), lightPos: u(meshProgram, "uLightPos"),
    lightColor: u(meshProgram, "uLightColor"), lightType: u(meshProgram, "uLightType"),
    lightIntensity: u(meshProgram, "uLightIntensity"), metal: u(meshProgram, "uMetal"),
    rough: u(meshProgram, "uRough"), opacity: u(meshProgram, "uOpacity"),
    tex: u(meshProgram, "uTex"), useTex: u(meshProgram, "uUseTex"),
  };
  const pointsU = {
    view: u(pointsProgram, "uView"), proj: u(pointsProgram, "uProj"),
    size: u(pointsProgram, "uSize"), color: u(pointsProgram, "uColor"), opacity: u(pointsProgram, "uOpacity"),
  };

  const geometryCache = new Map<string, GpuGeometry>();
  const glbGeometryCache = new Map<string, GpuGeometry[]>();
  const glbBaseColor = new Map<string, [number, number, number] | null>();
  const textTextureCache = new Map<string, WebGLTexture>();

  const uploadGeometry = (geo: SceneGeometry): GpuGeometry | null => {
    const vao = gl.createVertexArray();
    if (!vao) return null;
    gl.bindVertexArray(vao);
    const attach = (data: Float32Array, location: number, size: number) => {
      const buf = gl.createBuffer();
      if (!buf) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };
    attach(geo.positions, 0, 3);
    attach(geo.normals, 1, 3);
    attach(geo.uvs, 2, 2);
    const idx = gl.createBuffer();
    if (!idx) {
      gl.deleteVertexArray(vao);
      return null;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, indexCount: geo.indices.length };
  };

  const ensureGeometry = (key: string): GpuGeometry | null => {
    const cached = geometryCache.get(key);
    if (cached) return cached;
    const geo = proceduralGeometry(key);
    if (!geo) return null;
    const gpu = uploadGeometry(geo);
    if (gpu) geometryCache.set(key, gpu);
    return gpu;
  };

  const ensureTextTexture = (key: string, text: string, fontSizePx: number, color: string): WebGLTexture | null => {
    const cached = textTextureCache.get(key);
    if (cached) return cached;
    const off = document.createElement("canvas");
    off.width = 1024;
    off.height = 512;
    const ctx2d = off.getContext("2d");
    if (!ctx2d) return null;
    ctx2d.clearRect(0, 0, off.width, off.height);
    const px = Math.min(360, Math.max(24, fontSizePx));
    ctx2d.font = `700 ${px}px system-ui, sans-serif`;
    ctx2d.fillStyle = color;
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "middle";
    const lines = text.split("\n").slice(0, 4);
    lines.forEach((line, i) => {
      ctx2d.fillText(line.slice(0, 64), off.width / 2, off.height / 2 + (i - (lines.length - 1) / 2) * px * 1.15);
    });
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, off);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    textTextureCache.set(key, tex);
    return tex;
  };

  // VAO/buffer dinámico de partículas (se rellena por frame, closed-form).
  let pointsVao: WebGLVertexArrayObject | null = null;
  let pointsBuffer: WebGLBuffer | null = null;

  const drawParticles = (view: Mat4, proj: Mat4, sample: SceneSample, localSec: number): void => {
    const particleNodes = sample.nodes.filter((n) => n.visible && n.kind === "particles");
    if (!particleNodes.length) return;
    if (!pointsVao || !pointsBuffer) {
      pointsVao = gl.createVertexArray();
      pointsBuffer = gl.createBuffer();
      if (!pointsVao || !pointsBuffer) return;
      gl.bindVertexArray(pointsVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, pointsBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    gl.useProgram(pointsProgram);
    gl.uniformMatrix4fv(pointsU.view, false, view);
    gl.uniformMatrix4fv(pointsU.proj, false, proj);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const node of particleNodes) {
      const count = Math.min(20_000, Math.max(1, Math.round(node.numeric.count ?? 500)));
      const positions = new Float32Array(count * 3);
      const offsetX = node.numeric.x ?? 0;
      const offsetY = node.numeric.y ?? 0;
      const offsetZ = node.numeric.z ?? 0;
      for (let i = 0; i < count; i++) {
        const [px, py, pz] = particlePositionAt({
          mode: node.numeric.mode ?? 0,
          seed: Math.round(node.numeric.seed ?? 7),
          speed: node.numeric.speed ?? 1,
          spread: node.numeric.spread ?? 2,
          gravity: node.numeric.gravity ?? 0,
          drift: node.numeric.drift ?? 0.2,
          spin: node.numeric.spin ?? 0,
          area: node.numeric.area ?? 4,
        }, i, localSec);
        positions[i * 3] = px + offsetX;
        positions[i * 3 + 1] = py + offsetY;
        positions[i * 3 + 2] = pz + offsetZ;
      }
      gl.uniform3f(pointsU.color, ...(node.color ? hexToRgb(node.color) : [1, 1, 1]) as [number, number, number]);
      gl.uniform1f(pointsU.opacity, Math.min(1, node.numeric.opacity ?? 1));
      gl.uniform1f(pointsU.size, Math.max(1, node.numeric.size ?? 2));
      gl.bindVertexArray(pointsVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, pointsBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.bindVertexArray(null);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  };

  const collectLights = (sample: SceneSample): SceneLightUniforms[] =>
    sample.nodes
      .filter((n) => n.visible && n.kind === "light")
      .slice(0, MAX_LIGHTS)
      .map((n) => ({
        pos: [n.numeric.x ?? 0, n.numeric.y ?? 5, n.numeric.z ?? 5] as [number, number, number],
        color: n.color ? hexToRgb(n.color) : ([1, 1, 1] as [number, number, number]),
        type: n.lightType === "point" ? 1 : n.lightType === "ambient" ? 2 : 0,
        intensity: n.numeric.intensity ?? 1,
      }));

  const drawMeshes = (view: Mat4, proj: Mat4, camera: [number, number, number], sample: SceneSample): void => {
    const lights = collectLights(sample);
    gl.useProgram(meshProgram);
    gl.uniformMatrix4fv(meshU.view, false, view);
    gl.uniformMatrix4fv(meshU.proj, false, proj);
    gl.uniform3f(meshU.camera, camera[0], camera[1], camera[2]);
    gl.uniform1i(meshU.lightCount, lights.length);
    const posArr = new Float32Array(MAX_LIGHTS * 3);
    const colArr = new Float32Array(MAX_LIGHTS * 3);
    const typeArr = new Int32Array(MAX_LIGHTS);
    const intArr = new Float32Array(MAX_LIGHTS);
    lights.forEach((light, i) => {
      posArr.set(light.pos, i * 3);
      colArr.set(light.color, i * 3);
      typeArr[i] = light.type;
      intArr[i] = light.intensity;
    });
    gl.uniform3fv(meshU.lightPos, posArr);
    gl.uniform3fv(meshU.lightColor, colArr);
    gl.uniform1iv(meshU.lightType, typeArr);
    gl.uniform1fv(meshU.lightIntensity, intArr);
    gl.uniform1i(meshU.tex, 0);

    // Opaques primero (depth write), transparentes después (blend, sin depth write).
    const visualNodes = sample.nodes.filter((n) => n.visible && (n.kind === "mesh" || n.kind === "text3d"));
    const isTransparent = (n: SampledSceneNode) => (n.kind === "text3d" ? true : (n.numeric.opacity ?? 1) < 1);
    const order = [...visualNodes.filter((n) => !isTransparent(n)), ...visualNodes.filter(isTransparent)];

    for (const node of order) {
      const pos: [number, number, number] = [node.numeric.x ?? 0, node.numeric.y ?? 0, node.numeric.z ?? 0];
      const rot: [number, number, number] = [node.numeric.rx ?? 0, node.numeric.ry ?? 0, node.numeric.rz ?? 0];
      const baseScale = node.numeric.scale ?? 1;

      if (node.kind === "mesh" && node.primitive === "glb") {
        const glbMeshes = node.assetId ? glbGeometryCache.get(node.assetId) : undefined;
        if (!glbMeshes) continue; // prepare() aún no resolvió (o falló): no se degrada, se avisa arriba
        const model = mat4FromTRS(
          pos,
          rot,
          [
            baseScale * (node.numeric.sx ?? 1),
            baseScale * (node.numeric.sy ?? 1),
            baseScale * (node.numeric.sz ?? 1),
          ],
        );
        const fallbackColor = node.color ? hexToRgb(node.color) : null;
        gl.uniform1f(meshU.useTex, 0);
        gl.uniformMatrix4fv(meshU.model, false, model);
        gl.uniformMatrix3fv(meshU.normalMat, false, normalMatrixFrom(model));
        const glbBase = node.color ? null : glbBaseColor.get(node.assetId || "") || null;
        const rgb = fallbackColor || glbBase || ([0.8, 0.8, 0.8] as [number, number, number]);
        gl.uniform3f(meshU.color, rgb[0], rgb[1], rgb[2]);
        gl.uniform1f(meshU.metal, node.numeric.metalness ?? 0.1);
        gl.uniform1f(meshU.rough, node.numeric.roughness ?? 0.7);
        gl.uniform1f(meshU.opacity, Math.min(1, node.numeric.opacity ?? 1));
        for (const g of glbMeshes) {
          gl.bindVertexArray(g.vao);
          gl.drawElements(gl.TRIANGLES, g.indexCount, gl.UNSIGNED_INT, 0);
        }
        gl.bindVertexArray(null);
        continue;
      }

      if (node.kind === "text3d") {
        const qW = node.numeric.quadWidth ?? 2;
        const qH = node.numeric.quadHeight ?? 1;
        let model: Mat4;
        if (node.billboard !== false) {
          const fx = camera[0] - pos[0];
          const fy = camera[1] - pos[1];
          const fz = camera[2] - pos[2];
          const fl = Math.hypot(fx, fy, fz) || 1;
          const fwd: [number, number, number] = [fx / fl, fy / fl, fz / fl];
          let rx = fwd[2];
          let ry = 0;
          let rz = -fwd[0];
          const rl = Math.hypot(rx, ry, rz) || 1;
          rx /= rl; rz /= rl;
          const upx = fwd[1] * rz - fwd[2] * ry;
          const upy = fwd[2] * rx - fwd[0] * rz;
          const upz = fwd[0] * ry - fwd[1] * rx;
          model = mat4FromBasis(
            [rx * qW * baseScale, ry * qW * baseScale, rz * qW * baseScale],
            [upx * qH * baseScale, upy * qH * baseScale, upz * qH * baseScale],
            [fwd[0] * 0.001, fwd[1] * 0.001, fwd[2] * 0.001],
            pos,
          );
        } else {
          model = mat4FromTRS(pos, rot, [qW * baseScale, qH * baseScale, 0.001]);
        }
        const gpu = ensureGeometry("textQuad");
        if (!gpu) continue;
        const tex = ensureTextTexture(
          `${node.id}:${node.text || ""}:${node.textColor || "#ffffff"}`,
          node.text || "",
          node.numeric.fontSizePx ?? 96,
          node.textColor || "#ffffff",
        );
        if (tex) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1f(meshU.useTex, 1);
        } else {
          gl.uniform1f(meshU.useTex, 0);
        }
        gl.uniformMatrix4fv(meshU.model, false, model);
        gl.uniformMatrix3fv(meshU.normalMat, false, normalMatrixFrom(model));
        gl.uniform3f(meshU.color, 1, 1, 1);
        gl.uniform1f(meshU.metal, 0);
        gl.uniform1f(meshU.rough, 1);
        gl.uniform1f(meshU.opacity, Math.min(1, node.numeric.opacity ?? 1));
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.bindVertexArray(gpu.vao);
        gl.drawElements(gl.TRIANGLES, gpu.indexCount, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.uniform1f(meshU.useTex, 0);
        continue;
      }

      // mesh procedural
      const primitive = node.primitive || "box";
      const gpu = ensureGeometry(primitive);
      if (!gpu) continue;
      const model = mat4FromTRS(
        pos,
        rot,
        [
          baseScale * (node.numeric.sx ?? 1),
          baseScale * (node.numeric.sy ?? 1),
          baseScale * (node.numeric.sz ?? 1),
        ],
      );
      const opacity = Math.min(1, node.numeric.opacity ?? 1);
      gl.uniform1f(meshU.useTex, 0);
      gl.uniformMatrix4fv(meshU.model, false, model);
      gl.uniformMatrix3fv(meshU.normalMat, false, normalMatrixFrom(model));
      const rgb = node.color ? hexToRgb(node.color) : ([0.8, 0.8, 0.8] as [number, number, number]);
      gl.uniform3f(meshU.color, rgb[0], rgb[1], rgb[2]);
      gl.uniform1f(meshU.metal, node.numeric.metalness ?? 0.1);
      gl.uniform1f(meshU.rough, node.numeric.roughness ?? 0.7);
      gl.uniform1f(meshU.opacity, opacity);
      if (opacity < 1) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
      }
      gl.bindVertexArray(gpu.vao);
      gl.drawElements(gl.TRIANGLES, gpu.indexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
      if (opacity < 1) {
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    }
  };

  return {
    async prepare(spec: MusaSceneSpec): Promise<string[]> {
      const glbAssets = spec.assets.filter((asset) => asset.kind === "glb");
      const failed: string[] = [];
      await Promise.all(glbAssets.map(async (asset) => {
        if (glbGeometryCache.has(asset.id)) return;
        try {
          const meshes = await loadSceneGlb(asset.url);
          const gpus: GpuGeometry[] = [];
          for (const mesh of meshes) {
            const gpu = uploadGeometry(mesh);
            if (gpu) gpus.push(gpu);
          }
          if (!gpus.length) throw new Error("GLB sin geometrías cargables");
          glbGeometryCache.set(asset.id, gpus);
          const first = meshes[0];
          glbBaseColor.set(asset.id, first?.baseColor ?? null);
        } catch {
          failed.push(asset.id);
        }
      }));
      return failed;
    },

    render(spec: MusaSceneSpec, timeMs: number, overrides?: SceneOverrides | null): void {
      const sample = sampleSceneAt(spec, timeMs, overrides);
      const bg = hexToRgb(sample.background);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const aspect = canvas.width / Math.max(1, canvas.height);
      const proj = mat4Perspective(sample.camera.fov, aspect, 0.1, 500);
      const cameraPos: [number, number, number] = [sample.camera.x, sample.camera.y, sample.camera.z];
      const view = mat4LookAt(cameraPos, [sample.camera.tx, sample.camera.ty, sample.camera.tz]);
      drawMeshes(view, proj, cameraPos, sample);
      drawParticles(view, proj, sample, Math.max(0, timeMs) / 1_000);
    },

    dispose(): void {
      geometryCache.clear();
      glbGeometryCache.clear();
      glbBaseColor.clear();
      for (const tex of textTextureCache.values()) gl.deleteTexture(tex);
      textTextureCache.clear();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
