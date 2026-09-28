/**
 * photoEngine — motor de revelado WebGL2 (REQ-PHOTO-PLATFORM-001, Fase 1).
 *
 * Aplica una PhotoRecipe (shared/photoRecipe.ts) sobre el ImageBitmap de UNA
 * foto, en un solo pase de fragment shader: balance de blancos → tono →
 * curvas → HSL → vibrance/color grading → B/N → detalle (sharpen/clarity/
 * texture/denoise por muestreo de anillo) → grano/viñeta. Las máscaras
 * (radial/linear/brush) mezclan su subconjunto de ajustes por píxel.
 *
 * Invariantes del REQ:
 *  • Cero llamadas de red: cada slider es solo uniform + draw.
 *  • El original nunca se escribe: la salida es una rendition nueva.
 *  • Un solo draw por frame: la UI nunca bloquea (los histogramas van
 *    debounced desde el overlay).
 */

import {
  buildCurveLut, composeGeometryMatrix, resolveRenderState,
  type AnyRecipe, type CurvePoint,
} from "../../shared/photoRecipe.ts";

const MAX_MASKS = 6;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uTex;      // fuente (foto original)
uniform sampler2D uCurveRgb; // LUTs 256x1 (R8)
uniform sampler2D uCurveR;
uniform sampler2D uCurveG;
uniform sampler2D uCurveB;
uniform sampler2D uBrush;    // máscara pintada (canal R, espacio uv de salida)

uniform mat3 uSrcMat;   // outPx -> srcPx (geometría: crop/straighten/rot90/flip)
uniform vec2 uSrcSize;  // px del original
uniform vec2 uOutSize;  // px de la salida (tras crop/rot90)
uniform vec2 uViewOff;  // ventana visible (uv de salida)
uniform vec2 uViewScale;
uniform float uSplit;   // fracción x de la línea antes/después; <0 = off
uniform float uOriginal; // 1 = ver SOLO el original (con la misma geometría)
uniform float uTexel;   // 1/min(srcW,srcH) para los radios de detalle

// basic
uniform vec4 uBasic1;   // exposure, contrast, highlights, shadows
uniform vec4 uBasic2;   // whites, blacks, 0, 0
uniform vec4 uWb;       // temp, tint
uniform vec4 uColor;    // vibrance, saturation
uniform vec4 uHslH;     // h por banda (8) — des/hasta -30..30
uniform vec4 uHslH2;
uniform vec4 uHslS;
uniform vec4 uHslS2;
uniform vec4 uHslL;
uniform vec4 uHslL2;
uniform float uCurveOn;          // hay curva definida
uniform vec4 uGrade1;   // shadows: hue, sat | midtones: hue, sat
uniform vec4 uGrade2;   // highlights: hue, sat | blend, balance
uniform vec4 uDetail;   // texture, clarity, sharpen, denoise
uniform vec4 uEffects;  // grain, vignetteAmount, vignetteMidpoint(0..1), vignetteFeather(0..1)
uniform vec4 uBw;       // enabled, mixR, mixG, mixB

// máscaras
uniform int uMaskCount;
uniform float uMaskKind[${MAX_MASKS}];    // 0 radial, 1 linear, 2 brush
uniform vec4 uMaskGeo1[${MAX_MASKS}];    // cx, cy, r, feather
uniform vec4 uMaskGeo2[${MAX_MASKS}];    // x1, y1, x2, y2
uniform float uMaskInvert[${MAX_MASKS}];
uniform vec4 uMaskAdj1[${MAX_MASKS}];    // exposure, contrast, saturation, temp
uniform vec4 uMaskAdj2[${MAX_MASKS}];    // tint

const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);

float lum(vec3 c) { return dot(c, LUM); }

vec3 applyWb(vec3 c, vec2 wb) {
  c.r += wb.x * 0.10; c.b -= wb.x * 0.10;
  c.g += wb.y * 0.08; c.r -= wb.y * 0.03; c.b -= wb.y * 0.03;
  return clamp(c, 0.0, 1.0);
}

vec3 applyBasic(vec3 c, vec4 b1, vec2 b2) {
  float l = lum(c);
  // exposure: paradas fotográficas
  c *= exp2(b1.x * 1.4);
  // highlights / shadows con máscara por luminancia (protege el extremo opuesto)
  float mH = smoothstep(0.35, 1.0, l);
  float mS = 1.0 - smoothstep(0.0, 0.55, l);
  c += b1.z * 0.30 * mH * (1.0 - c);
  c += b1.w * 0.30 * mS * c;
  // whites / blacks empujan los puntos extremos
  float mW = smoothstep(0.6, 1.0, l);
  float mB = 1.0 - smoothstep(0.0, 0.35, l);
  c += b2.x * 0.22 * mW * (1.0 - c);
  c += b2.y * 0.22 * mB * c;
  // contraste con pivote 0.5
  c = (c - 0.5) * (1.0 + b1.y * 0.9) + 0.5;
  return clamp(c, 0.0, 1.0);
}

float curveLut(sampler2D lut, float v) {
  return texture(lut, vec2(clamp(v, 0.0, 1.0), 0.5)).r;
}

vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  float h = 0.0;
  float s = 0.0;
  if (d > 1e-5) {
    s = l > 0.5 ? d / max(2.0 - mx - mn, 1e-5) : d / max(mx + mn, 1e-5);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y <= 1e-5) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(
    hue2rgb(p, q, hsl.x + 1.0 / 3.0),
    hue2rgb(p, q, hsl.x),
    hue2rgb(p, q, hsl.x - 1.0 / 3.0));
}

vec3 applyHsl(vec3 c, vec4 h1, vec4 h2, vec4 s1, vec4 s2, vec4 l1, vec4 l2) {
  vec3 hsl = rgb2hsl(clamp(c, 0.0, 1.0));
  float hueDeg = hsl.x * 360.0;
  float bandDh[8]; float bandS[8]; float bandL[8]; float center[8];
  bandDh[0]=h1.x; bandDh[1]=h1.y; bandDh[2]=h1.z; bandDh[3]=h1.w;
  bandDh[4]=h2.x; bandDh[5]=h2.y; bandDh[6]=h2.z; bandDh[7]=h2.w;
  bandS[0]=s1.x; bandS[1]=s1.y; bandS[2]=s1.z; bandS[3]=s1.w;
  bandS[4]=s2.x; bandS[5]=s2.y; bandS[6]=s2.z; bandS[7]=s2.w;
  bandL[0]=l1.x; bandL[1]=l1.y; bandL[2]=l1.z; bandL[3]=l1.w;
  bandL[4]=l2.x; bandL[5]=l2.y; bandL[6]=l2.z; bandL[7]=l2.w;
  center[0]=0.0; center[1]=30.0; center[2]=60.0; center[3]=120.0;
  center[4]=180.0; center[5]=240.0; center[6]=280.0; center[7]=320.0;
  for (int i = 0; i < 8; i++) {
    float d = abs(hueDeg - center[i]);
    d = min(d, 360.0 - d);
    float w = exp(-(d * d) / (2.0 * 35.0 * 35.0));
    hsl.x = fract(hsl.x + (bandDh[i] * (30.0 / 360.0)) * w);
    hsl.y = clamp(hsl.y * (1.0 + bandS[i] * w), 0.0, 1.0);
    hsl.z = clamp(hsl.z + bandL[i] * 0.25 * w, 0.0, 1.0);
  }
  return hsl2rgb(hsl);
}

vec3 applyVibranceSat(vec3 c, vec2 vs) {
  float l = lum(c);
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  // vibrance protege lo ya saturado
  c = mix(vec3(l), c, 1.0 + vs.x * (1.0 - sat));
  c = mix(vec3(l), c, 1.0 + vs.y);
  return clamp(c, 0.0, 1.0);
}

vec3 gradeColor(float hueDeg, float sat01) {
  return hsl2rgb(vec3(hueDeg / 360.0, sat01, 0.5));
}

vec3 applyGrading(vec3 c, vec4 g1, vec4 g2) {
  float l = lum(c);
  float balance = g2.w * 0.5; // -0.5..0.5
  float wS = 1.0 - smoothstep(0.0 + balance * 0.5, 0.55 + balance * 0.5, l);
  float wH = smoothstep(0.45 + balance * 0.5, 1.0 + balance * 0.5, l);
  float wM = clamp(1.0 - wS - wH, 0.0, 1.0);
  float blend = g2.z; // 0..1
  vec3 cs = gradeColor(g1.x, g1.y);
  vec3 cm = gradeColor(g1.z, g1.w);
  vec3 ch = gradeColor(g2.x, g2.y);
  vec3 tinted = cs * wS + cm * wM + ch * wH;
  // overlay suave, preserva neutrals (sat 0 → sin cambio)
  vec3 overlay = mix(2.0 * c * tinted, 1.0 - 2.0 * (1.0 - c) * (1.0 - tinted), step(0.5, c));
  return clamp(mix(c, overlay, blend * 0.85), 0.0, 1.0);
}

vec3 applyDetail(vec3 c, vec2 srcUV, vec4 d) {
  if (d.x == 0.0 && d.y == 0.0 && d.z == 0.0 && d.w == 0.0) return c;
  vec2 tx = uTexel * vec2(1.0, 0.0);
  vec2 ty = uTexel * vec2(0.0, 1.0);
  // denoise: mezcla hacia el promedio 3x3
  if (d.w > 0.0) {
    vec3 avg = (
      texture(uTex, srcUV + tx).rgb + texture(uTex, srcUV - tx).rgb +
      texture(uTex, srcUV + ty).rgb + texture(uTex, srcUV - ty).rgb +
      texture(uTex, srcUV + tx + ty).rgb + texture(uTex, srcUV - tx + ty).rgb +
      texture(uTex, srcUV + tx - ty).rgb + texture(uTex, srcUV - tx - ty).rgb) * 0.125;
    c = mix(c, avg, d.w * 0.85);
  }
  // texture: radio corto; clarity: radio largo; sharpen: diagonal corta
  if (abs(d.x) > 0.0) {
    vec2 r1 = tx * 2.0 + ty * 2.0;
    vec3 blurMid = (texture(uTex, srcUV + r1).rgb + texture(uTex, srcUV - r1).rgb) * 0.5;
    c += (c - blurMid) * d.x * 0.8;
  }
  if (abs(d.y) > 0.0) {
    vec2 r2 = tx * 28.0 + ty * 28.0;
    vec3 blurBig = (texture(uTex, srcUV + r2).rgb + texture(uTex, srcUV - r2).rgb) * 0.5;
    c += (c - blurBig) * d.y * 0.55;
  }
  if (d.z > 0.0) {
    vec3 diag = (
      texture(uTex, srcUV + tx).rgb + texture(uTex, srcUV - tx).rgb +
      texture(uTex, srcUV + ty).rgb + texture(uTex, srcUV - ty).rgb) * 0.25;
    c += (c - diag) * d.z * 1.2;
  }
  return clamp(c, 0.0, 1.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 applyEffects(vec3 c, vec2 outUV, vec4 fx) {
  if (fx.y != 0.0) {
    vec2 rel = (outUV - 0.5) * 2.0;
    float dist = length(rel * vec2(1.0, 1.0)) / 1.4142;
    float mid = mix(0.15, 0.85, fx.z);
    float feather = mix(0.08, 0.9, fx.w);
    float v = smoothstep(mid, clamp(mid + feather, 0.0, 1.2), dist);
    c *= 1.0 + fx.y * 0.85 * v;
  }
  if (fx.x > 0.0) {
    float n = hash12(floor(outUV * uOutSize)) - 0.5;
    // el grano pesa más en medios tonos, como la película
    float weight = 4.0 * lum(c) * (1.0 - lum(c));
    c += n * fx.x * 0.14 * weight;
  }
  return clamp(c, 0.0, 1.0);
}

vec3 applyBw(vec3 c, vec4 bw) {
  if (bw.x < 0.5) return c;
  float total = max(bw.y + bw.z + bw.w, 1e-3);
  float g = dot(c, vec3(bw.y, bw.z, bw.w) / total);
  return vec3(g);
}

vec3 applyLocal(vec3 c, vec4 a1, vec2 a2) {
  float l = lum(c);
  c *= exp2(a1.x * 1.4);
  c = (c - 0.5) * (1.0 + a1.y * 0.9) + 0.5;
  c = mix(vec3(l), c, 1.0 + a1.z);
  c = applyWb(c, vec2(a1.w, a2.x)); // temp, tint
  return clamp(c, 0.0, 1.0);
}

float maskAlpha(int i, vec2 outUV) {
  int kind = int(uMaskKind[i] + 0.5);
  vec4 g1 = uMaskGeo1[i];
  vec4 g2 = uMaskGeo2[i];
  float a = 0.0;
  if (kind == 0) {
    vec2 rel = outUV - g1.xy;
    float d = length(rel) / max(g1.z, 1e-4);
    float feather = max(g1.w, 0.02);
    a = 1.0 - smoothstep(1.0 - feather, 1.0, d);
  } else if (kind == 1) {
    vec2 p = outUV - g2.xy;
    vec2 dir = g2.zw - g2.xy;
    float t = dot(p, dir) / max(dot(dir, dir), 1e-6);
    float feather = max(g1.w, 0.02);
    a = smoothstep(0.5 - feather * 0.5, 0.5 + feather * 0.5, t);
  } else {
    a = texture(uBrush, outUV).r;
  }
  if (uMaskInvert[i] > 0.5) a = 1.0 - a;
  return clamp(a, 0.0, 1.0);
}

void main() {
  vec2 outUV = uViewOff + vUV * uViewScale;
  vec3 bg = vec3(0.075, 0.075, 0.075);
  if (outUV.x < 0.0 || outUV.x > 1.0 || outUV.y < 0.0 || outUV.y > 1.0) {
    fragColor = vec4(bg, 1.0);
    return;
  }
  vec2 srcPx = (uSrcMat * vec3(outUV * uOutSize, 1.0)).xy;
  vec2 srcUV = srcPx / uSrcSize;
  vec3 base = texture(uTex, clamp(srcUV, 0.0, 1.0)).rgb;

  bool originalOnly = uOriginal > 0.5 || (uSplit >= 0.0 && vUV.x > uSplit);
  if (originalOnly) {
    fragColor = vec4(base, 1.0);
    return;
  }

  vec3 c = base;
  c = applyWb(c, uWb.xy);
  c = applyBasic(c, uBasic1, uBasic2.xy);
  if (uCurveOn > 0.5) {
    c.r = curveLut(uCurveR, curveLut(uCurveRgb, c.r));
    c.g = curveLut(uCurveG, curveLut(uCurveRgb, c.g));
    c.b = curveLut(uCurveB, curveLut(uCurveRgb, c.b));
  }
  c = applyHsl(c, uHslH, uHslH2, uHslS, uHslS2, uHslL, uHslL2);
  c = applyVibranceSat(c, uColor.xy);
  c = applyDetail(c, srcUV, uDetail);
  c = applyGrading(c, uGrade1, uGrade2);
  c = applyBw(c, uBw);
  c = applyEffects(c, outUV, uEffects);

  for (int i = 0; i < ${MAX_MASKS}; i++) {
    if (i >= uMaskCount) break;
    float a = maskAlpha(i, outUV);
    if (a <= 0.001) continue;
    vec4 a1 = uMaskAdj1[i];
    vec2 a2 = uMaskAdj2[i].xy;
    if (abs(a1.x) + abs(a1.y) + abs(a1.z) + abs(a1.w) + abs(a2.x) < 0.001) continue;
    // la máscara ajusta ENCIMA del revelado global (modelo Lightroom)
    c = mix(c, applyLocal(c, a1, a2), a);
  }

  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export interface HistogramData { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array }

export interface RenderView { zoom: number; panX: number; panY: number }

export interface RenderOptions {
  view?: RenderView | null;      // null = fit completo (export / histograma)
  split?: number | null;         // 0..1, línea antes/después en espacio canvas
  original?: boolean;
  histogram?: boolean;           // computa y devuelve el histograma del frame
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || "shader compile failed";
    gl.deleteShader(sh);
    throw new Error(`photoEngine: ${log}`);
  }
  return sh;
}

export class PhotoRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private tex: WebGLTexture | null = null;
  private brushTex: WebGLTexture | null = null;
  private curveTex: WebGLTexture[] = [];
  private fbo: WebGLFramebuffer | null = null;
  private fboTex: WebGLTexture | null = null;
  private srcW = 0;
  private srcH = 0;
  private outW = 0;
  private outH = 0;
  private disposed = false;

  static isSupported(): boolean {
    try {
      return typeof document !== "undefined" && !!document.createElement("canvas").getContext("webgl2");
    } catch {
      return false;
    }
  }

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error("photoEngine: WebGL2 no disponible en este navegador");
    this.canvas = canvas;
    this.gl = gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`photoEngine: ${gl.getProgramInfoLog(program) || "link failed"}`);
    }
    this.program = program;
    gl.useProgram(program);

    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // LUTs de curva: 256x1 R8, identidad al inicio. Unidades:
    // TEXTURE0 fuente · TEXTURE1..4 curvas · TEXTURE5 brush.
    const identity = new Uint8Array(256);
    for (let i = 0; i < 256; i++) identity[i] = i;
    this.curveTex = [];
    const units = [gl.TEXTURE1, gl.TEXTURE2, gl.TEXTURE3, gl.TEXTURE4];
    const names = ["uCurveRgb", "uCurveR", "uCurveG", "uCurveB"];
    units.forEach((unit, i) => {
      gl.activeTexture(unit);
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, identity);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.curveTex.push(t);
      gl.uniform1i(this.loc(names[i]), i + 1);
    });

    gl.activeTexture(gl.TEXTURE5);
    this.brushTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.brushTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.loc("uBrush"), 5);

    gl.uniform1i(this.loc("uTex"), 0);
  }

  private loc(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.uniforms.get(name)!;
  }

  /** Fuente de píxeles. No copia: sube el bitmap a la GPU. */
  setSource(bitmap: ImageBitmap | HTMLImageElement | HTMLCanvasElement, w: number, h: number): void {
    const gl = this.gl;
    this.srcW = w;
    this.srcH = h;
    if (this.tex) gl.deleteTexture(this.tex);
    gl.activeTexture(gl.TEXTURE0);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap as TexImageSource);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  /** Sube el lienzo de pintura del pincel (RGBA, canal R = fuerza). */
  setBrushMask(canvas: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.brushTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  /** Render principal. El caller dimensiona canvas.width/height (con DPR). */
  update(recipe: AnyRecipe, opts: RenderOptions = {}): HistogramData | null {
    if (this.disposed) return null;
    const gl = this.gl;
    const s = resolveRenderState(recipe);
    const mat = composeGeometryMatrix(this.srcW, this.srcH, recipe.geometry);
    this.outW = mat.outW;
    this.outH = mat.outH;

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(this.program);

    // ── geometría + vista ──
    gl.uniformMatrix3fv(this.loc("uSrcMat"), false, mat.mat);
    gl.uniform2f(this.loc("uSrcSize"), this.srcW, this.srcH);
    gl.uniform2f(this.loc("uOutSize"), this.outW, this.outH);
    const view = opts.view;
    if (view) {
      const scale = Math.min(cw / this.outW, ch / this.outH) * Math.max(view.zoom, 0.01);
      const topLeftX = (cw - this.outW * scale) / 2 - view.panX;
      const topLeftY = (ch - this.outH * scale) / 2 - view.panY;
      gl.uniform2f(this.loc("uViewOff"), topLeftX / this.outW, topLeftY / this.outH);
      gl.uniform2f(this.loc("uViewScale"), cw / scale / this.outW, ch / scale / this.outH);
    } else {
      gl.uniform2f(this.loc("uViewOff"), 0, 0);
      gl.uniform2f(this.loc("uViewScale"), 1, 1);
    }
    gl.uniform1f(this.loc("uSplit"), opts.split != null ? Math.min(1, Math.max(0, opts.split)) : -1);
    gl.uniform1f(this.loc("uOriginal"), opts.original ? 1 : 0);
    gl.uniform1f(this.loc("uTexel"), 1 / Math.max(1, Math.min(this.srcW, this.srcH)));

    // ── ops globales ──
    const b = s.basic, wb = s.whiteBalance, col = s.color, det = s.detail, fx = s.effects, bw = s.bw, gr = s.grading;
    gl.uniform4f(this.loc("uBasic1"), b.exposure / 100, b.contrast / 100, b.highlights / 100, b.shadows / 100);
    gl.uniform4f(this.loc("uBasic2"), b.whites / 100, b.blacks / 100, 0, 0);
    gl.uniform4f(this.loc("uWb"), wb.temp / 100, wb.tint / 100, 0, 0);
    gl.uniform4f(this.loc("uColor"), col.vibrance / 100, col.saturation / 100, 0, 0);
    const hsl = s.hsl; // 8 bandas, h/s/l ya normalizados
    const h = hsl.map(x => x.h) as number[];
    const sa = hsl.map(x => x.s) as number[];
    const l = hsl.map(x => x.l) as number[];
    gl.uniform4f(this.loc("uHslH"), h[0], h[1], h[2], h[3]);
    gl.uniform4f(this.loc("uHslH2"), h[4], h[5], h[6], h[7]);
    gl.uniform4f(this.loc("uHslS"), sa[0], sa[1], sa[2], sa[3]);
    gl.uniform4f(this.loc("uHslS2"), sa[4], sa[5], sa[6], sa[7]);
    gl.uniform4f(this.loc("uHslL"), l[0], l[1], l[2], l[3]);
    gl.uniform4f(this.loc("uHslL2"), l[4], l[5], l[6], l[7]);
    const anyCurve = (s.curves.rgb.length + s.curves.r.length + s.curves.g.length + s.curves.b.length) > 0;
    gl.uniform1f(this.loc("uCurveOn"), anyCurve ? 1 : 0);
    this.uploadCurve(0, s.curves.rgb);
    this.uploadCurve(1, s.curves.r);
    this.uploadCurve(2, s.curves.g);
    this.uploadCurve(3, s.curves.b);
    gl.uniform4f(this.loc("uGrade1"), gr.shadows.hue, gr.shadows.sat / 100, gr.midtones.hue, gr.midtones.sat / 100);
    gl.uniform4f(this.loc("uGrade2"), gr.highlights.hue, gr.highlights.sat / 100, gr.blend / 100, gr.balance / 100);
    gl.uniform4f(this.loc("uDetail"), det.texture / 100, det.clarity / 100, det.sharpen / 100, det.denoise / 100);
    gl.uniform4f(this.loc("uEffects"), fx.grain / 100, fx.vignetteAmount / 100, fx.vignetteMidpoint / 100, fx.vignetteFeather / 100);
    gl.uniform4f(this.loc("uBw"), bw.enabled ? 1 : 0, bw.mix.r / 100, bw.mix.g / 100, bw.mix.b / 100);

    // ── máscaras ──
    const kind = new Float32Array(MAX_MASKS);
    const geo1 = new Float32Array(MAX_MASKS * 4);
    const geo2 = new Float32Array(MAX_MASKS * 4);
    const inv = new Float32Array(MAX_MASKS);
    const adj1 = new Float32Array(MAX_MASKS * 4);
    const adj2 = new Float32Array(MAX_MASKS * 4);
    const masks = s.masks.slice(0, MAX_MASKS);
    masks.forEach((m, i) => {
      kind[i] = m.kind === "linear" ? 1 : m.kind === "brush" ? 2 : 0;
      geo1.set([m.cx, m.cy, m.r, m.feather], i * 4);
      geo2.set([m.x1, m.y1, m.x2, m.y2], i * 4);
      inv[i] = m.invert ? 1 : 0;
      adj1.set([m.adjustments.exposure / 100, m.adjustments.contrast / 100, m.adjustments.saturation / 100, m.adjustments.temp / 100], i * 4);
      adj2.set([m.adjustments.tint / 100, 0, 0, 0], i * 4);
    });
    gl.uniform1i(this.loc("uMaskCount"), masks.length);
    gl.uniform1fv(this.loc("uMaskKind"), kind);
    gl.uniform4fv(this.loc("uMaskGeo1"), geo1);
    gl.uniform4fv(this.loc("uMaskGeo2"), geo2);
    gl.uniform1fv(this.loc("uMaskInvert"), inv);
    gl.uniform4fv(this.loc("uMaskAdj1"), adj1);
    gl.uniform4fv(this.loc("uMaskAdj2"), adj2);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    let histogram: HistogramData | null = null;
    if (opts.histogram && cw > 0 && ch > 0) {
      histogram = this.readHistogram();
    }
    return histogram;
  }

  private uploadCurve(slot: number, points: CurvePoint[]): void {
    const gl = this.gl;
    const lut = buildCurveLut(points);
    gl.activeTexture(gl.TEXTURE1 + slot);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex[slot]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RED, gl.UNSIGNED_BYTE, lut);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Histograma RGB+luma desde un FBO de 256×256 (downsample por hardware). */
  private readHistogram(): HistogramData {
    const gl = this.gl;
    if (!this.fbo) {
      this.fboTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, 256, 256);
    // el estado ya está subido: un draw idéntico al FBO con vista completa
    gl.uniform2f(this.loc("uViewOff"), 0, 0);
    gl.uniform2f(this.loc("uViewScale"), 1, 1);
    gl.uniform1f(this.loc("uSplit"), -1);
    gl.uniform1f(this.loc("uOriginal"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const pixels = new Uint8Array(256 * 256 * 4);
    gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const hist: HistogramData = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256) };
    for (let i = 0; i < pixels.length; i += 4) {
      // descarta el fondo fuera del rango de la foto (alpha sigue en 1)
      hist.r[pixels[i]]++;
      hist.g[pixels[i + 1]]++;
      hist.b[pixels[i + 2]]++;
      const l = Math.round(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]);
      hist.l[Math.min(255, l)]++;
    }
    // re-render al canvas visible con la vista correcta lo hace el caller;
    // aquí restauramos la vista completa por si el caller no re-renderiza.
    return hist;
  }

  outputSize(): { w: number; h: number } {
    return { w: this.outW, h: this.outH };
  }

  /** Render a resolución completa y descarga como Blob (PNG/JPEG). */
  async renderToBlob(type: "image/png" | "image/jpeg", quality = 0.92, maxSide = Infinity): Promise<Blob> {
    const prevW = this.canvas.width;
    const prevH = this.canvas.height;
    const maxTex = Math.min(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number, 8192);
    const scale = Math.min(1, maxTex / Math.max(this.outW, this.outH), maxSide / Math.max(this.outW, this.outH));
    this.canvas.width = Math.max(1, Math.round(this.outW * scale));
    this.canvas.height = Math.max(1, Math.round(this.outH * scale));
    try {
      // identity view (update ya dejó los uniforms del estado actual;
      // re-render sin vista = fit completo)
      this.renderFullResFrame();
      const blob = await new Promise<Blob | null>(resolve => this.canvas.toBlob(resolve, type, quality));
      if (!blob) throw new Error("photoEngine: toBlob devolvió null");
      return blob;
    } finally {
      this.canvas.width = prevW;
      this.canvas.height = prevH;
    }
  }

  /** Un frame a resolución completa SIN tocar la vista del caller. */
  private renderFullResFrame(): void {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.uniform2f(this.loc("uViewOff"), 0, 0);
    gl.uniform2f(this.loc("uViewScale"), 1, 1);
    gl.uniform1f(this.loc("uSplit"), -1);
    gl.uniform1f(this.loc("uOriginal"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    if (this.brushTex) gl.deleteTexture(this.brushTex);
    this.curveTex.forEach(t => gl.deleteTexture(t));
    if (this.fboTex) gl.deleteTexture(this.fboTex);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    gl.deleteProgram(this.program);
    this.uniforms.clear();
  }
}

/**
 * loadPhotoSource — descarga la foto con CORS estricto (fetch → blob →
 * ImageBitmap). Si el origen no manda Access-Control-Allow-Origin, falla
 * AQUÍ y la UI ofrece "Crear copia editable" (REQ §5) — nunca un canvas
 * envenenado.
 */
export async function loadPhotoSource(url: string): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const resp = await fetch(url, { mode: "cors" });
  if (!resp.ok) throw new Error(`No se pudo descargar la foto (${resp.status})`);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  return { bitmap, width: bitmap.width, height: bitmap.height };
}
