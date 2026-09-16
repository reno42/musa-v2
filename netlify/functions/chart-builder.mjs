/**
 * chart-builder.mjs — la primitiva server-side de `create_chart`.
 *
 * POR QUÉ EXISTE: las IAs fallamos en 2 cosas consistentes — la matemática de
 * proporciones (a ojo) y acordarnos de las recetas. Aquí el servidor calcula
 * TODO (stops del donut, height% de barras, y de la línea, posiciones del
 * timeline) y devuelve HTML/CSS listo para el frame. Ninguna IA depende de su
 * memoria. Canon: harness/CHART_RECIPES.md · Spec: harness/SPEC_CREATE_CHART.md
 *
 * PURO A PROPÓSITO: cero imports, cero APIs de plataforma (Netlify/Workers),
 * cero Node built-ins. Consumible desde cualquier runtime y unit-testeable
 * sin DOM ni red (QA/chart-builder.test.mjs).
 */

// ── Contrato público ────────────────────────────────────────────────────────

export const CHART_RECIPES = [
  "donut", "vbars", "hbars", "timeline", "line", "statgrid",
  "mindmap", "journey", "versus", "matrix2x2", "storyarc",
];

/** Paleta default Futuraria (dark). Se sobreescribe con options.palette. */
export const DEFAULT_PALETTE = ["#d2ff02", "#854be8", "#4a5058", "#2e2e2e"];

/** Zona de contenido de un slide deck 1920x1080 (R-V1). */
const ZONE_DECK = { w: 1728, h: 760 };

const ACCENT = "#d2ff02";
const VIOLET = "#854be8";
const MUTED = "#4a5058";
const INK = "#2e2e2e";
const SURFACE = "#141414";
const BORDER = "#242424";
const BG = "#0a0a0a";

/**
 * buildChart({ recipe, data, palette, zone, valueFormat, placeholder,
 *              highlightIndex, ...recipeOptions })
 *   → { html, css, objects, warnings }
 *
 * Valida y rechaza con Error de mensaje claro (el MCP lo convierte en -32602).
 * `objects` es el manifiesto de lo creado — la IA lo lee para saber qué hay
 * en el frame sin re-parsear HTML.
 */
export function buildChart(opts = {}) {
  const recipe = String(opts.recipe || "").trim();
  if (!CHART_RECIPES.includes(recipe)) {
    throw new Error(`create_chart: recipe desconocida «${recipe}». Válidas: ${CHART_RECIPES.join(", ")}`);
  }
  const data = Array.isArray(opts.data) ? opts.data : [];
  if (data.length === 0) {
    throw new Error(`create_chart: data vacía — pasa al menos un ítem según la receta (ver harness/SPEC_CREATE_CHART.md)`);
  }

  const zone = {
    w: Number(opts.zone?.w) > 0 ? Number(opts.zone.w) : ZONE_DECK.w,
    h: Number(opts.zone?.h) > 0 ? Number(opts.zone.h) : ZONE_DECK.h,
  };
  // Factor de escala: las recetas están escritas para la zona deck 1728x760.
  // Otros lienzos escalan proporcionalmente (piso 0.55 para no dibujar ilegible).
  const s = Math.min(Math.max(Math.min(zone.w / ZONE_DECK.w, zone.h / ZONE_DECK.h), 0.55), 2);
  const palette = Array.isArray(opts.palette) && opts.palette.length >= 2
    ? opts.palette.map(c => String(c))
    : DEFAULT_PALETTE;

  const ctx = {
    s, zone, palette,
    valueFormat: ["currency", "percent", "raw"].includes(opts.valueFormat) ? opts.valueFormat : "raw",
    placeholder: opts.placeholder === true,
    highlightIndex: Number.isInteger(opts.highlightIndex) ? opts.highlightIndex : null,
    // Opciones de receta (headA/headB, quadrantTitles, axisX/axisY…).
    opts,
  };

  const built = BUILDERS[recipe](data, ctx, opts);
  const tag = ctx.placeholder
    ? `<div class="cc-fill-tag">[FILL]</div>`
    : "";
  const html = `<div data-layer-id="cc_chart_root" data-layer-name="Chart ${recipe}" class="cc-root cc-root-${recipe}">${built.html}${tag}</div>`;
  const css = baseCss(zone) + built.css;
  return { html, css, objects: built.objects, warnings: built.warnings || [] };
}

// ── Helpers compartidos ─────────────────────────────────────────────────────

const esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmt = (v, format) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(v);
  if (format === "currency") return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (format === "percent") return `${n}%`;
  return String(v);
};

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

const row = (label, value, format) => `
    <div class="cc-row"><span class="cc-row-label">${esc(label)}</span><span class="cc-row-value">${fmt(value, format)}</span></div>`;

// ── CSS base (todas las recetas) ────────────────────────────────────────────

// Root ABSOLUTO y con dims explícitas de la zona: el contrato de editabilidad
// (normalizeLayersFirstFrame → auditEditableFrame) exige position:absolute +
// left/top en todo layer top-level. Con width/height en px de la zona, el
// normalizador además lo detecta como frame-sized root y el modo append pasa
// el audit igual (el CSS matchea la clase aunque haya más raíces).
const baseCss = (zone) => `
.cc-root{box-sizing:border-box;position:absolute;left:0;top:0;width:${zone.w}px;height:${zone.h}px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-family:inherit}
.cc-root div,.cc-root span{box-sizing:border-box}
.cc-fill-tag{position:absolute;top:2.5%;right:1.5%;padding:.4% 1.2%;border:1px dashed ${VIOLET};border-radius:999px;color:${VIOLET};font-size:16px;font-weight:700;letter-spacing:.08em}
`;

// ── Recetas v1 (CHART_RECIPES.md R1–R6) ─────────────────────────────────────

const BUILDERS = {
  // R1 · Donut — splits de %. Σ = 100% ±0.5, ≤5 segmentos (más = tabla).
  donut(data, ctx) {
    if (data.length > 5) throw new Error("create_chart donut: máximo 5 segmentos — con más, usa hbars o una tabla");
    let acc = 0;
    const segs = data.map((d, i) => {
      const v = num(d.value);
      if (Number.isNaN(v)) throw new Error(`create_chart donut: «${d.label ?? i}».value no es numérico`);
      const from = acc; acc += v;
      return { label: d.label ?? "", value: v, note: d.note, from, color: ctx.palette[i % ctx.palette.length] };
    });
    if (Math.abs(acc - 100) > 0.5) {
      throw new Error(`create_chart donut: los valores suman ${acc}% — deben sumar 100% (±0.5). Ajusta o usa vbars.`);
    }
    const D = Math.round(430 * ctx.s);
    const hole = Math.round(D * 0.58);
    const stops = segs.map(x => `${x.color} ${x.from}% ${x.from + x.value}%`).join(", ");
    const total = segs.reduce((a, b) => a + b.value, 0);
    const html = `
    <div class="cc-donut-wrap">
      <div class="cc-donut${ctx.placeholder ? " cc-ph" : ""}"><div class="cc-donut-hole"><span class="cc-donut-total">${fmt(total, ctx.valueFormat === "raw" ? "percent" : ctx.valueFormat)}</span></div></div>
      <div class="cc-donut-legend">${segs.map(x => `
        <div class="cc-legend-row"><span class="cc-swatch" style="background:${x.color}"></span><span class="cc-legend-label">${esc(x.label)}</span><span class="cc-legend-note">${esc(x.note ?? "")}</span><span class="cc-legend-value">${fmt(x.value, ctx.valueFormat === "raw" ? "percent" : ctx.valueFormat)}</span></div>`).join("")}
      </div>
    </div>`;
    const css = `
.cc-donut-wrap{display:flex;align-items:center;gap:${Math.round(64 * ctx.s)}px}
.cc-donut{width:${D}px;height:${D}px;border-radius:50%;background:conic-gradient(${stops});display:flex;align-items:center;justify-content:center;flex-shrink:0}
.cc-donut.cc-ph{border:2px dashed ${VIOLET}}
.cc-donut-hole{width:${hole}px;height:${hole}px;border-radius:50%;background:${BG};display:flex;align-items:center;justify-content:center}
.cc-donut-total{font-size:${Math.round(40 * ctx.s)}px;font-weight:800;letter-spacing:-1px;color:${ACCENT}}
.cc-donut-legend{display:flex;flex-direction:column;gap:${Math.round(14 * ctx.s)}px}
.cc-legend-row{display:flex;align-items:center;gap:${Math.round(12 * ctx.s)}px}
.cc-swatch{width:${Math.round(22 * ctx.s)}px;height:${Math.round(22 * ctx.s)}px;border-radius:6px;flex-shrink:0}
.cc-legend-label{color:#f4f4f5;font-size:${Math.round(20 * ctx.s)}px;font-weight:600;white-space:nowrap}
.cc-legend-note{color:#7a7a7a;font-size:${Math.round(16 * ctx.s)}px;white-space:nowrap}
.cc-legend-value{color:#f4f4f5;font-size:${Math.round(20 * ctx.s)}px;font-weight:800;margin-left:auto;font-variant-numeric:tabular-nums}`;
    return { html, css, objects: segs.map(x => ({ kind: "donut-segment", label: x.label, value: x.value, color: x.color })) };
  },

  // R2 · Vertical bars — proyecciones. headroom 1.15× (R-V4), ≤7 barras.
  vbars(data, ctx) {
    if (data.length > 7) throw new Error("create_chart vbars: máximo 7 barras — con más, usa line");
    const vals = data.map((d, i) => {
      const v = num(d.value);
      if (Number.isNaN(v)) throw new Error(`create_chart vbars: «${d.label ?? i}».value no es numérico`);
      return v;
    });
    const max = Math.max(...vals);
    const hi = ctx.highlightIndex ?? vals.indexOf(max);
    const plotH = Math.round(540 * ctx.s);
    const html = `
    <div class="cc-vbars-plot" style="height:${plotH}px">${data.map((d, i) => `
      <div class="cc-vcol">
        <span class="cc-vval${i === hi ? " cc-hi" : ""}">${fmt(d.value, ctx.valueFormat)}</span>
        <div class="cc-vbar${i === hi ? " cc-hi" : ""}${ctx.placeholder ? " cc-ph" : ""}" style="height:${Math.round(vals[i] / (max * 1.15) * 1000) / 10}%"></div>
        <span class="cc-vlabel">${esc(d.label)}</span>
      </div>`).join("")}
    </div>`;
    const css = `
.cc-vbars-plot{width:100%;display:flex;align-items:flex-end;gap:${Math.round(56 * ctx.s)}px;border-bottom:2px solid ${INK};padding:0 ${Math.round(56 * ctx.s)}px}
.cc-vcol{flex:1;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:${Math.round(14 * ctx.s)}px}
.cc-vbar{width:100%;max-width:${Math.round(180 * ctx.s)}px;border-radius:${Math.round(14 * ctx.s)}px ${Math.round(14 * ctx.s)}px 0 0;background:${SURFACE};border:1px solid ${BORDER}}
.cc-vbar.cc-hi{background:${ACCENT};border-color:${ACCENT}}
.cc-vbar.cc-ph{border:1px dashed ${VIOLET};background:rgba(133,75,232,.12)}
.cc-vval{color:#f4f4f5;font-size:${Math.round(24 * ctx.s)}px;font-weight:800;font-variant-numeric:tabular-nums}
.cc-vval.cc-hi{color:${ACCENT}}
.cc-vlabel{color:#a1a1aa;font-size:${Math.round(18 * ctx.s)}px;white-space:nowrap}`;
    return { html, css, objects: data.map((d, i) => ({ kind: "bar", label: d.label, value: vals[i], heightPct: Math.round(vals[i] / (max * 1.15) * 1000) / 10, highlight: i === hi })) };
  },

  // R3 · Horizontal bars — TAM/SAM/SOM. La barra mayor = 100% del track.
  hbars(data, ctx) {
    if (data.length > 6) throw new Error("create_chart hbars: máximo 6 tracks");
    const vals = data.map((d, i) => {
      const v = num(d.value);
      if (Number.isNaN(v)) throw new Error(`create_chart hbars: «${d.label ?? i}».value no es numérico`);
      return v;
    });
    const max = Math.max(...vals);
    const trackH = Math.round(66 * ctx.s);
    const html = data.map((d, i) => {
      const pct = Math.round(vals[i] / max * 1000) / 10;
      const inside = pct >= 30; // fill < 30% → el valor va fuera (R3)
      const color = ctx.palette[i % ctx.palette.length];
      const ph = ctx.placeholder ? " cc-ph" : "";
      return `
      <div class="cc-hrow">
        <div class="cc-hhead"><span class="cc-hlabel">${esc(d.label)}</span><span class="cc-hnote">${esc(d.note ?? "")}</span></div>
        <div class="cc-track" style="height:${trackH}px">
          <div class="cc-fillbar${inside ? "" : " cc-outline"}${ph}" style="width:${pct}%;background:${inside ? color : "transparent"};border-color:${color}">${inside ? `<span class="cc-fillval">${fmt(d.value, ctx.valueFormat)}</span>` : ""}</div>
          ${inside ? "" : `<span class="cc-fillval cc-outside">${fmt(d.value, ctx.valueFormat)}</span>`}
        </div>
      </div>`;
    }).join("");
    const css = `
.cc-hroot{flex-direction:column;justify-content:center;gap:${Math.round(26 * ctx.s)}px;width:100%;height:100%}
.cc-hrow{width:100%}
.cc-hhead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:${Math.round(8 * ctx.s)}px}
.cc-hlabel{color:#f4f4f5;font-size:${Math.round(20 * ctx.s)}px;font-weight:700}
.cc-hnote{color:#7a7a7a;font-size:${Math.round(16 * ctx.s)}px;font-style:italic}
.cc-track{position:relative;background:${SURFACE};border:1px solid ${BORDER};border-radius:999px;overflow:visible}
.cc-fillbar{height:100%;border-radius:999px;display:flex;align-items:center;padding:0 ${Math.round(26 * ctx.s)}px;min-width:0}
.cc-fillbar.cc-outline{border:2px solid ${ACCENT}}
.cc-fillbar.cc-ph{border-style:dashed;border-color:${VIOLET}}
.cc-fillval{color:${BG};font-weight:800;font-size:${Math.round(22 * ctx.s)}px;white-space:nowrap}
.cc-fillbar.cc-outline .cc-fillval{color:#f4f4f5}
.cc-fillval.cc-outside{position:absolute;left:calc(100% + ${Math.round(14 * ctx.s)}px);top:50%;transform:translateY(-50%);color:#f4f4f5}`;
    return { html: `<div class="cc-hroot">${html}</div>`, css, objects: data.map((d, i) => ({ kind: "hbar", label: d.label, value: vals[i], widthPct: Math.round(vals[i] / max * 1000) / 10 })) };
  },

  // R4 · Timeline — nodos 8–92% equiespaciados, cards alternando arriba/abajo,
  // progreso hasta el nodo `current`. NUNCA en document-flow (todo absoluto).
  timeline(data, ctx) {
    if (data.length < 2) throw new Error("create_chart timeline: mínimo 2 nodos");
    if (data.length > 6) throw new Error("create_chart timeline: máximo 6 nodos — un roadmap no es una lista");
    const N = data.length;
    const pos = (i) => 8 + (i * 84) / (N - 1);
    const currentIdx = data.findIndex(d => d.status === "current");
    const lastDoneIdx = data.map(d => d.status).lastIndexOf("done");
    const progEnd = currentIdx >= 0 ? pos(currentIdx) : (lastDoneIdx >= 0 ? pos(lastDoneIdx) : 0);
    const cardW = Math.min(Math.round(370 * ctx.s), Math.round(ctx.zone.w * 0.24));
    const nodeD = Math.round(26 * ctx.s);
    const html = `
    <div class="cc-tl">
      <div class="cc-tl-line"></div>
      ${progEnd > 0 ? `<div class="cc-tl-prog" style="width:calc(${progEnd}% - 24px)"></div>` : ""}
      ${data.map((d, i) => {
        const p = pos(i);
        const done = d.status === "done";
        const above = i % 2 === 0;
        const align = i === 0 ? "cc-tl-start" : (i === N - 1 ? "cc-tl-end" : "cc-tl-mid");
        const ph = ctx.placeholder ? " cc-ph" : "";
        return `
        <div class="cc-tl-node${done ? " cc-done" : ""}" style="left:${p}%"></div>
        <div class="cc-tl-card ${above ? "cc-tl-above" : "cc-tl-below"} ${align}${ph}" style="left:${p}%;width:${cardW}px">
          <span class="cc-tl-step">${esc(d.label)}</span>
          ${d.title ? `<span class="cc-tl-title">${esc(d.title)}</span>` : ""}
          ${d.desc ? `<span class="cc-tl-desc">${esc(d.desc)}</span>` : ""}
        </div>`;
      }).join("")}
    </div>`;
    const css = `
.cc-tl{position:relative;width:100%;height:100%}
.cc-tl-line{position:absolute;left:24px;right:24px;top:50%;height:3px;background:${INK}}
.cc-tl-prog{position:absolute;left:24px;top:50%;height:3px;background:${ACCENT}}
.cc-tl-node{position:absolute;top:50%;transform:translate(-50%,-50%);width:${nodeD}px;height:${nodeD}px;border-radius:50%;background:${BG};border:3px solid ${ACCENT}}
.cc-tl-node.cc-done{background:${ACCENT}}
.cc-tl-card{position:absolute;display:flex;flex-direction:column;gap:${Math.round(6 * ctx.s)}px;background:${SURFACE};border:1px solid ${BORDER};border-radius:16px;padding:${Math.round(24 * ctx.s)}px ${Math.round(28 * ctx.s)}px}
.cc-tl-card.cc-ph{border-style:dashed;border-color:${VIOLET}}
.cc-tl-above{bottom:56%}
.cc-tl-below{top:58%}
.cc-tl-start{transform:translateX(0)}
.cc-tl-mid{transform:translateX(-50%)}
.cc-tl-end{transform:translateX(-100%)}
.cc-tl-step{color:${ACCENT};font-size:${Math.round(16 * ctx.s)}px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.cc-tl-title{color:#f4f4f5;font-size:${Math.round(22 * ctx.s)}px;font-weight:700}
.cc-tl-desc{color:#a1a1aa;font-size:${Math.round(17 * ctx.s)}px;line-height:1.35}`;
    return { html, css, objects: data.map((d, i) => ({ kind: "timeline-node", label: d.label, title: d.title, status: d.status || "todo", leftPct: Math.round(pos(i) * 10) / 10 })) };
  },

  // R5 · Line chart — curva suave C/S, área al 7%, gridlines al 25%.
  line(data, ctx) {
    if (data.length < 3) throw new Error("create_chart line: mínimo 3 puntos");
    const vals = data.map((d, i) => {
      const v = num(d.value);
      if (Number.isNaN(v)) throw new Error(`create_chart line: «${d.label ?? i}».value no es numérico`);
      return v;
    });
    const max = Math.max(...vals);
    const W = 1200, H = 500, PAD = 35;
    const y = (v) => Math.round(H - (v / max) * (H - 2 * PAD));
    const x = (i) => Math.round(i * (W / (vals.length - 1)));
    const pts = vals.map((v, i) => [x(i), y(v)]);
    let path = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const dx = Math.round((pts[i][0] - pts[i - 1][0]) / 3);
      path += ` C${pts[i - 1][0] + dx},${pts[i - 1][1]} ${pts[i][0] - dx},${pts[i][1]} ${pts[i][0]},${pts[i][1]}`;
    }
    const stroke = ctx.placeholder ? VIOLET : ACCENT;
    const dash = ctx.placeholder ? ` stroke-dasharray="10 12"` : "";
    const grid = [25, 50, 75].map(g => `<line x1="0" y1="${H * (1 - g / 100)}" x2="${W}" y2="${H * (1 - g / 100)}" stroke="${BORDER}" stroke-dasharray="4 8"/>`).join("");
    const dots = pts.map(([px, py], i) => {
      const r = i === pts.length - 1 ? 13 : 9;
      return `<circle cx="${px}" cy="${py}" r="${r}" fill="${BG}" stroke="${stroke}" stroke-width="4"/>`;
    }).join("");
    const lastLabel = `<text x="${pts[pts.length - 1][0] - 14}" y="${pts[pts.length - 1][1] - 24}" fill="${stroke}" font-size="30" font-weight="800" text-anchor="end">${esc(fmt(data[pts.length - 1].value, ctx.valueFormat))}</text>`;
    const labelEls = data.map((d, i) => (i % Math.ceil(data.length / 7) === 0 || i === data.length - 1)
      ? `<text x="${x(i)}" y="${H - 6}" fill="#7a7a7a" font-size="18" text-anchor="middle">${esc(d.label)}</text>`
      : "").join("");
    const html = `
    <div class="cc-line">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        ${grid}
        <path d="${path} L${pts[pts.length - 1][0]},${H - PAD} L${pts[0][0]},${H - PAD} Z" fill="rgba(210,255,2,0.07)"/>
        <path d="${path}" fill="none" stroke="${stroke}" stroke-width="5" stroke-linecap="round"${dash}/>
        ${dots}${lastLabel}${labelEls}
      </svg>
    </div>`;
    const css = `
.cc-line{width:100%;height:${Math.round(ctx.zone.h * 0.86)}px}
.cc-line svg{width:100%;height:100%;display:block}`;
    return { html, css, objects: data.map((d, i) => ({ kind: "line-point", label: d.label, value: vals[i], x: x(i), y: y(vals[i]) })) };
  },

  // R6 · Stat grid — KPIs. El único patrón donde "número grande" es correcto.
  statgrid(data, ctx) {
    if (data.length < 2 || data.length > 4) throw new Error("create_chart statgrid: 2 a 4 stats");
    const numeral = Math.round(72 * ctx.s);
    const html = `
    <div class="cc-stats">${data.map(d => `
      <div class="cc-stat${ctx.placeholder ? " cc-ph" : ""}">
        <span class="cc-stat-value">${fmt(d.value, ctx.valueFormat)}</span>
        <span class="cc-stat-label">${esc(d.label)}</span>
      </div>`).join("")}
    </div>`;
    const css = `
.cc-stats{display:grid;grid-template-rows:repeat(${data.length},1fr);gap:${Math.round(24 * ctx.s)}px;width:100%;height:100%}
.cc-stat{background:${SURFACE};border:1px solid ${BORDER};border-radius:16px;display:flex;flex-direction:column;justify-content:center;gap:${Math.round(8 * ctx.s)}px;padding:0 ${Math.round(40 * ctx.s)}px}
.cc-stat.cc-ph{border-style:dashed;border-color:${VIOLET}}
.cc-stat-value{color:${ACCENT};font-size:${numeral}px;font-weight:800;letter-spacing:-2px;font-variant-numeric:tabular-nums;line-height:1.05}
.cc-stat-label{color:#a1a1aa;font-size:${Math.round(20 * ctx.s)}px}`;
    return { html, css, objects: data.map(d => ({ kind: "stat", label: d.label, value: d.value })) };
  },

  // ── Recetas v2 — knowledge visuals (REQ Planilla de Contenidos v2) ─────────

  // Mind map — concepto central + ramas. Árbol horizontal determinístico:
  // raíz a la izquierda, espina, ramas apiladas a la derecha.
  mindmap(data, ctx) {
    if (data.length > 6) throw new Error("create_chart mindmap: máximo 6 ramas — agrupa en 2 niveles si tienes más");
    const root = data[0];
    const branches = data.slice(1);
    if (branches.length === 0) throw new Error("create_chart mindmap: data[0] es el concepto central y data[1..] las ramas — falta al menos una rama");
    const html = `
    <div class="cc-mind">
      <div class="cc-mind-root${ctx.placeholder ? " cc-ph" : ""}">
        <span class="cc-mind-root-label">${esc(root.label)}</span>
        ${root.desc ? `<span class="cc-mind-root-desc">${esc(root.desc)}</span>` : ""}
      </div>
      <div class="cc-mind-spine"></div>
      <div class="cc-mind-branches">${branches.map(d => `
        <div class="cc-mind-branch">
          <span class="cc-mind-tick"></span>
          <div class="cc-mind-card${ctx.placeholder ? " cc-ph" : ""}">
            <span class="cc-mind-label">${esc(d.label)}</span>
            ${d.desc ? `<span class="cc-mind-desc">${esc(d.desc)}</span>` : ""}
          </div>
        </div>`).join("")}
      </div>
    </div>`;
    const css = `
.cc-mind{display:flex;align-items:center;width:100%;height:100%;gap:0}
.cc-mind-root{width:26%;background:${ACCENT};color:${BG};border-radius:20px;padding:${Math.round(30 * ctx.s)}px ${Math.round(34 * ctx.s)}px;display:flex;flex-direction:column;gap:${Math.round(8 * ctx.s)}px}
.cc-mind-root.cc-ph{background:transparent;border:2px dashed ${VIOLET};color:#f4f4f5}
.cc-mind-root-label{font-size:${Math.round(26 * ctx.s)}px;font-weight:800;line-height:1.2}
.cc-mind-root-desc{font-size:${Math.round(17 * ctx.s)}px;opacity:.75}
.cc-mind-spine{width:2px;align-self:stretch;background:${INK};margin:6% ${Math.round(36 * ctx.s)}px}
.cc-mind-branches{flex:1;display:flex;flex-direction:column;justify-content:space-around;align-self:stretch;padding:4% 0}
.cc-mind-branch{display:flex;align-items:center;gap:${Math.round(18 * ctx.s)}px}
.cc-mind-tick{width:${Math.round(36 * ctx.s)}px;height:2px;background:${MUTED};flex-shrink:0}
.cc-mind-card{background:${SURFACE};border:1px solid ${BORDER};border-radius:14px;padding:${Math.round(16 * ctx.s)}px ${Math.round(22 * ctx.s)}px;display:flex;flex-direction:column;gap:4px;width:100%}
.cc-mind-card.cc-ph{border-style:dashed;border-color:${VIOLET}}
.cc-mind-label{color:#f4f4f5;font-size:${Math.round(20 * ctx.s)}px;font-weight:700}
.cc-mind-desc{color:#a1a1aa;font-size:${Math.round(16 * ctx.s)}px;line-height:1.3}`;
    return { html, css, objects: [{ kind: "mindmap-root", label: root.label }, ...branches.map(d => ({ kind: "mindmap-branch", label: d.label }))] };
  },

  // Journey / mapa de proceso — stepper horizontal: nodos numerados sobre la
  // línea, TODAS las cards abajo (a diferencia del timeline, que alterna).
  journey(data, ctx) {
    if (data.length < 2 || data.length > 6) throw new Error("create_chart journey: entre 2 y 6 pasos");
    const N = data.length;
    const pos = (i) => 8 + (i * 84) / (N - 1);
    const nodeD = Math.round(44 * ctx.s);
    const html = `
    <div class="cc-journey">
      <div class="cc-journey-line"></div>
      ${data.map((d, i) => `
        <div class="cc-journey-node" style="left:${pos(i)}%"><span>${String(i + 1).padStart(2, "0")}</span></div>
        <div class="cc-journey-card${i === 0 ? " cc-start" : ""}${i === N - 1 ? " cc-end" : ""}" style="left:${pos(i)}%">${ctx.placeholder ? `<div class="cc-journey-ph"></div>` : ""}
          <span class="cc-journey-label">${esc(d.label)}</span>
          ${d.desc ? `<span class="cc-journey-desc">${esc(d.desc)}</span>` : ""}
        </div>`).join("")}
    </div>`;
    const css = `
.cc-journey{position:relative;width:100%;height:100%}
.cc-journey-line{position:absolute;left:24px;right:24px;top:${Math.round(ctx.zone.h * 0.22)}px;height:3px;background:${INK}}
.cc-journey-node{position:absolute;top:${Math.round(ctx.zone.h * 0.22)}px;transform:translate(-50%,-50%);width:${nodeD}px;height:${nodeD}px;border-radius:50%;background:${BG};border:3px solid ${ACCENT};display:flex;align-items:center;justify-content:center}
.cc-journey-node span{color:${ACCENT};font-size:${Math.round(15 * ctx.s)}px;font-weight:800}
.cc-journey-card{position:absolute;top:${Math.round(ctx.zone.h * 0.34)}px;transform:translateX(-50%);width:${Math.round(ctx.zone.w / N * 0.8)}px;display:flex;flex-direction:column;gap:${Math.round(6 * ctx.s)}px;background:${SURFACE};border:1px solid ${BORDER};border-radius:16px;padding:${Math.round(20 * ctx.s)}px}
.cc-journey-card.cc-start{transform:translateX(0)}
.cc-journey-card.cc-end{transform:translateX(-100%)}
.cc-journey-ph{position:absolute;inset:-1px;border:1px dashed ${VIOLET};border-radius:16px;pointer-events:none}
.cc-journey-label{color:#f4f4f5;font-size:${Math.round(20 * ctx.s)}px;font-weight:700}
.cc-journey-desc{color:#a1a1aa;font-size:${Math.round(16 * ctx.s)}px;line-height:1.3}`;
    return { html, css, objects: data.map((d, i) => ({ kind: "journey-step", label: d.label, step: i + 1, leftPct: Math.round(pos(i) * 10) / 10 })) };
  },

  // Comparativa (versus) — A vs B. Filas pareadas: a | atributo | b.
  versus(data, ctx) {
    if (data.length > 6) throw new Error("create_chart versus: máximo 6 filas de comparación");
    const headA = ctx.opts?.headA ?? "A";
    const headB = ctx.opts?.headB ?? "B";
    const html = `
    <div class="cc-vs">
      <div class="cc-vs-head">
        <span class="cc-vs-chip cc-vs-a">${esc(headA)}</span>
        <span class="cc-vs-vs">VS</span>
        <span class="cc-vs-chip cc-vs-b">${esc(headB)}</span>
      </div>
      ${data.map(d => `
      <div class="cc-vs-row">
        <span class="cc-vs-cell cc-vs-a${ctx.placeholder ? " cc-ph" : ""}">${esc(d.a ?? "—")}</span>
        <span class="cc-vs-attr">${esc(d.label)}</span>
        <span class="cc-vs-cell cc-vs-b${ctx.placeholder ? " cc-ph" : ""}">${esc(d.b ?? "—")}</span>
      </div>`).join("")}
    </div>`;
    const css = `
.cc-vs{display:flex;flex-direction:column;width:100%;height:100%;gap:${Math.round(16 * ctx.s)}px}
.cc-vs-head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:${Math.round(20 * ctx.s)}px}
.cc-vs-chip{border-radius:999px;padding:${Math.round(10 * ctx.s)}px ${Math.round(26 * ctx.s)}px;text-align:center;font-weight:800;font-size:${Math.round(22 * ctx.s)}px}
.cc-vs-a{background:${ACCENT};color:${BG}}
.cc-vs-a.cc-ph, .cc-vs-b.cc-ph{background:transparent;border:2px dashed ${VIOLET};color:#f4f4f5}
.cc-vs-b{background:${VIOLET};color:#fff}
.cc-vs-vs{color:#7a7a7a;font-weight:800;font-size:${Math.round(18 * ctx.s)}px;letter-spacing:.14em}
.cc-vs-row{flex:1;display:grid;grid-template-columns:1fr auto 1fr;align-items:stretch;gap:${Math.round(20 * ctx.s)}px}
.cc-vs-cell{background:${SURFACE};border:1px solid ${BORDER};border-radius:12px;display:flex;align-items:center;padding:0 ${Math.round(22 * ctx.s)}px;font-size:${Math.round(19 * ctx.s)}px;color:#f4f4f5;font-weight:600}
.cc-vs-attr{align-self:center;color:#7a7a7a;font-size:${Math.round(16 * ctx.s)}px;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}`;
    return { html, css, objects: data.map(d => ({ kind: "versus-row", label: d.label, a: d.a, b: d.b })) };
  },

  // Matriz 2x2 — posicionamiento/frameworks. Items con coordenadas de
  // cuadrante (x: low|high, y: low|high) caen como chips dentro del cuadrante.
  matrix2x2(data, ctx) {
    const q = ctx.opts?.quadrantTitles ?? ["", "", "", ""];
    const axisX = ctx.opts?.axisX ?? "";
    const axisY = ctx.opts?.axisY ?? "";
    // La grilla 2x2 (2 celdas + gap) debe caber en la zona: celda ≤ 44% del alto.
    const cell = Math.round(Math.min(ctx.zone.w * 0.34, ctx.zone.h * 0.44) * 10) / 10;
    const quads = [
      { key: "high-low", title: q[0] }, { key: "high-high", title: q[1] },
      { key: "low-low", title: q[2] }, { key: "low-high", title: q[3] },
    ];
    const chips = (k) => data
      .filter(d => `${d.x}-${d.y}` === k)
      .map(d => `<span class="cc-mx-chip${ctx.placeholder ? " cc-ph" : ""}">${esc(d.label)}</span>`)
      .join("");
    const html = `
    <div class="cc-mx">
      <span class="cc-mx-axis-y">${esc(axisY)}</span>
      <div class="cc-mx-grid" style="width:${cell * 2}px;height:${cell * 2}px">
        ${quads.map(qd => `
        <div class="cc-mx-quad" data-quad="${qd.key}">
          ${qd.title ? `<span class="cc-mx-quad-title">${esc(qd.title)}</span>` : ""}
          <div class="cc-mx-chips">${chips(qd.key)}</div>
        </div>`).join("")}
      </div>
      <span class="cc-mx-axis-x">${esc(axisX)}</span>
    </div>`;
    const css = `
.cc-mx{display:grid;grid-template-columns:auto 1fr;grid-template-rows:1fr auto;align-items:center;gap:${Math.round(14 * ctx.s)}px;height:100%}
.cc-mx-axis-y{writing-mode:vertical-rl;transform:rotate(180deg);color:#7a7a7a;font-size:${Math.round(17 * ctx.s)}px;letter-spacing:.1em;text-transform:uppercase;justify-self:center}
.cc-mx-axis-x{grid-column:2;color:#7a7a7a;font-size:${Math.round(17 * ctx.s)}px;letter-spacing:.1em;text-transform:uppercase;text-align:center}
.cc-mx-grid{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:2px;background:${INK};border:2px solid ${INK};justify-self:center}
.cc-mx-quad{position:relative;background:${BG};display:flex;flex-direction:column;justify-content:space-between;padding:${Math.round(14 * ctx.s)}px;min-height:0}
.cc-mx-quad-title{color:#7a7a7a;font-size:${Math.round(15 * ctx.s)}px;text-transform:uppercase;letter-spacing:.08em}
.cc-mx-chips{display:flex;flex-wrap:wrap;gap:${Math.round(8 * ctx.s)}px;align-content:flex-end;justify-content:flex-start}
.cc-mx-chip{background:${ACCENT};color:${BG};border-radius:999px;padding:${Math.round(6 * ctx.s)}px ${Math.round(14 * ctx.s)}px;font-size:${Math.round(16 * ctx.s)}px;font-weight:700;white-space:nowrap}
.cc-mx-chip.cc-ph{background:transparent;border:1px dashed ${VIOLET};color:#f4f4f5}`;
    return { html, css, objects: data.map(d => ({ kind: "matrix-item", label: d.label, quadrant: `${d.x}-${d.y}` })) };
  },

  // Story arc — serie narrativa en 3 tandas (ej. caso biotech:
  // historia → técnico → empresa). Exactamente 3 acts conectados.
  storyarc(data, ctx) {
    if (data.length !== 3) throw new Error("create_chart storyarc: son exactamente 3 tandas (historia → técnico → empresa)");
    const arrow = (k) => `<svg class="cc-sa-arrow" width="${Math.round(30 * ctx.s)}" height="${Math.round(30 * ctx.s)}" viewBox="0 0 24 24" fill="none" stroke="${ACCENT}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
    const html = `
    <div class="cc-sa">
      ${data.map((d, i) => `
      <div class="cc-sa-col${ctx.placeholder ? " cc-ph" : ""}">
        <span class="cc-sa-kicker">${esc(d.kicker ?? `Tanda ${i + 1}`)}</span>
        <span class="cc-sa-title">${esc(d.title)}</span>
        <span class="cc-sa-desc">${esc(d.desc ?? "")}</span>
      </div>${i < 2 ? arrow(i) : ""}`).join("")}
    </div>`;
    const css = `
.cc-sa{display:flex;align-items:stretch;width:100%;height:100%;gap:${Math.round(14 * ctx.s)}px}
.cc-sa-col{flex:1;background:${SURFACE};border:1px solid ${BORDER};border-radius:18px;display:flex;flex-direction:column;justify-content:center;gap:${Math.round(10 * ctx.s)}px;padding:${Math.round(30 * ctx.s)}px}
.cc-sa-col.cc-ph{border-style:dashed;border-color:${VIOLET}}
.cc-sa-arrow{align-self:center;flex-shrink:0}
.cc-sa-kicker{color:${ACCENT};font-size:${Math.round(15 * ctx.s)}px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
.cc-sa-title{color:#f4f4f5;font-size:${Math.round(24 * ctx.s)}px;font-weight:800;line-height:1.15}
.cc-sa-desc{color:#a1a1aa;font-size:${Math.round(17 * ctx.s)}px;line-height:1.4}`;
    return { html, css, objects: data.map((d, i) => ({ kind: "story-act", act: i + 1, title: d.title })) };
  },
};
