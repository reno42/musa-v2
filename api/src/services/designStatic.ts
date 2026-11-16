/**
 * Una lámina quieta en su PORTADA para lo que no corre el editor: la captura del MCP (render_frame_png), el enlace
 * público /v/, la página de comentarios /c/, el correo. Regla única (decisión 2026-11-16): todo lo estático muestra la
 * lámina en el instante de su portada (frame.animation.poster).
 *  · cada capa animada lleva escrito (inline, !important) su valor en ese instante — el mismo muestreo del editor
 *    (shared/animationSchema.ts: sampleAnimationAt), así coinciden píxel a píxel;
 *  · las tomas de video apuntan a ese cuadro (#t=);
 *  · las capas de código vivo ya traen su imagen de portada (<img data-live-poster>);
 *  · las animaciones CSS que no pasaron por el modelo (diseños viejos) se apagan.
 */
import * as cheerio from "cheerio";
import { compileAnimation, normalizeAnimation, posterOf, sampleAnimationAt } from "../../../shared/animationSchema.ts";

function kebab(p: string) { return /^--/.test(p) ? p : p.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()).replace(/^webkit-/, "-webkit-"); }
function mediaTime(V: any, T: number) {
  const x = Math.max(0, (+V.in || 0) + Math.max(0, (+T || 0) - (+V.start || 0)) * (+V.rate || 1));
  return V.dur ? Math.min(x, (+V.in || 0) + +V.dur * (+V.rate || 1)) : x;
}
/** CSS que deja quieto lo que el modelo no controla (sin animaciones CSS ni transiciones). */
export const STATIC_CSS = "\n*{animation:none!important;transition:none!important}";

/** El instante de la portada y los valores de cada capa en ese instante. */
export function posterStyles(animation: unknown): { t: number; styles: Record<string, Record<string, string>> } {
  const A = animation ? normalizeAnimation(animation) : null;
  const t = A ? posterOf(A) : 0, styles: Record<string, Record<string, string>> = {};
  if (A && A.clips.length) sampleAnimationAt(A, t).forEach((sample, id) => {
    const o: Record<string, string> = {};
    Object.keys(sample).forEach((p) => { if (sample[p] !== "") o[kebab(p)] = sample[p]; });
    styles[id] = o;
  });
  return { t, styles };
}

/** HTML de la lámina tal como se ve en su portada. */
export function frameAtPoster(frame: { html?: string; animation?: unknown } | null | undefined): string {
  const html = String(frame?.html || "");
  const hasAnim = !!(frame && frame.animation);
  const hasVideo = /data-layer-kind="video"/.test(html);
  if (!hasAnim && !hasVideo) return html;
  const { t, styles } = posterStyles(frame?.animation);
  const ids = Object.keys(styles);
  if (!ids.length && !hasVideo) return html;
  const $ = cheerio.load(html, null, false);
  ids.forEach((id) => {
    const el = $(`[data-layer-id="${id.replace(/["\\]/g, "")}"]`).first(); if (!el.length) return;
    const add = Object.keys(styles[id]).map((p) => `${p}:${styles[id][p]} !important`).join(";");
    const cur = el.attr("style") || "";
    el.attr("style", (cur ? cur.replace(/;?\s*$/, ";") : "") + add);
  });
  $('video[data-layer-kind="video"][data-video]').each((_, v) => {
    try { const V = JSON.parse(decodeURIComponent(String($(v).attr("data-video")))); if (V && V.src) $(v).attr("src", String(V.src).split("#")[0] + "#t=" + Math.round(mediaTime(V, t) * 1000) / 1000); } catch { /* sin datos */ }
  });
  return $.html();
}

/** Lo que necesita un visor (enlace público) para reproducir la lámina al presentarla, sin el motor del editor. */
export function framePlayback(animation: unknown) {
  const A = animation ? normalizeAnimation(animation) : null;
  if (!A) return null;
  const ps = posterStyles(A);
  return {
    poster: ps.t, styles: ps.styles, duration: A.timeline.durationSec,
    present: { mode: (A.present && A.present.mode) || "enter", transition: (A.present && A.present.transition) || "fade" },
    tweens: compileAnimation(A).map((c) => ({ id: c.layerId, delay: c.delayMs, duration: c.durationMs, keyframes: c.keyframes, iterations: c.iterations === Infinity ? -1 : c.iterations || 1, direction: c.direction || "normal" })),
  };
}
