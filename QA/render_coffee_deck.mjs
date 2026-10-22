import { buildDeckFrames } from "../worker/runtime/functions/deck-generator.mjs";

// ─── COFFEE POSTER DNA ───────────────────────────────────────
const BLUE = "#002aff";
const WHITE = "#ffffff";
const OFFWHITE = "#f8f9ff";

function pill(text, top, left, rot = 0) {
  return `<div data-layer-name="${text}" style="position:absolute;top:${top}px;left:${left}px;background:${WHITE};border:5px solid ${BLUE};border-radius:80px;padding:10px 36px;z-index:10;box-shadow:0 6px 18px rgba(0,42,255,0.06);transform:rotate(${rot}deg);"><span style="font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700;color:${BLUE};letter-spacing:0.02em;text-transform:uppercase;">${text}</span></div>`;
}

const spec = {
  name: "Deck Generator — Design System",
  brand: { name: "Futuraria", color: BLUE, titleFont: "Montserrat", bodyFont: "Space Grotesk", background: WHITE },
  cover: {
    html: [
      `<div data-layer-name="Subhead" style="position:absolute;top:72px;left:0;width:100%;text-align:center;font-family:'Space Grotesk',sans-serif;font-size:32px;font-weight:700;color:${BLUE};letter-spacing:0.06em;text-transform:uppercase;">SISTEMA DE GENERACIÓN DETERMINISTA</div>`,
      `<div data-layer-name="Title1" style="position:absolute;top:180px;left:96px;font-family:'Montserrat',sans-serif;font-size:200px;font-weight:900;color:${BLUE};line-height:0.85;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Deck</div>`,
      `<div data-layer-name="Title2" style="position:absolute;top:350px;left:96px;font-family:'Montserrat',sans-serif;font-size:200px;font-weight:900;color:${BLUE};line-height:0.85;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Generator</div>`,
      pill("Design System", 380, 1120, -8),
      pill("11 frames", 800, 1150, 10),
      pill("v1.0 · Julio 2026", 1000, 80, -5),
    ].join("\n"),
    css: ""
  },
  slides: [
    // SLIDE 1 — Visión General
    {
      title: "Visión General",
      html: [
        `<div style="position:absolute;top:140px;left:96px;font-family:'Montserrat',sans-serif;font-size:120px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Motor</div>`,
        `<div style="position:absolute;top:248px;left:96px;font-family:'Montserrat',sans-serif;font-size:120px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Determinista</div>`,
        `<div style="position:absolute;top:400px;left:96px;max-width:800px;font-family:'Space Grotesk',sans-serif;font-size:22px;color:rgba(0,42,255,0.7);line-height:1.6;">Scaffolding para decks compuestos por IA. Separa decisiones creativas de decisiones mecánicas. El agente solo piensa en contenido — el sistema garantiza consistencia visual.</div>`,
        pill("1920×1080", 750, 96, -3),
        pill("160px gap", 750, 350, 5),
        pill("40 slides max", 750, 580, -7),
        `<div style="position:absolute;bottom:100px;left:96px;right:96px;display:flex;gap:32px;">`,
        `<div style="flex:1;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.15);border-radius:24px;padding:32px;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:64px;font-weight:900;color:${BLUE};">6</div><div style="font-family:'Space Grotesk',sans-serif;font-size:16px;color:rgba(0,42,255,0.6);margin-top:8px;">Frames generados</div></div>`,
        `<div style="flex:1;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.15);border-radius:24px;padding:32px;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:64px;font-weight:900;color:${BLUE};">7/7</div><div style="font-family:'Space Grotesk',sans-serif;font-size:16px;color:rgba(0,42,255,0.6);margin-top:8px;">Tests pasando</div></div>`,
        `<div style="flex:1;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.15);border-radius:24px;padding:32px;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:64px;font-weight:900;color:${BLUE};">70ms</div><div style="font-family:'Space Grotesk',sans-serif;font-size:16px;color:rgba(0,42,255,0.6);margin-top:8px;">Ejecución total</div></div>`,
        `</div>`
      ].join("\n")
    },
    {
      title: "Filosofía",
      html: [
        `<div style="position:absolute;top:120px;left:96px;font-family:'Montserrat',sans-serif;font-size:100px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">El Siste</div>`,
        `<div style="position:absolute;top:210px;left:96px;font-family:'Montserrat',sans-serif;font-size:100px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">ma Decide</div>`,
        `<div style="position:absolute;top:340px;left:96px;max-width:750px;font-family:'Space Grotesk',sans-serif;font-size:20px;color:rgba(0,42,255,0.7);line-height:1.7;">Todo lo que <strong>NO</strong> es una decisión creativa es decidido por el sistema. El agente de IA nunca gasta tokens en cálculos mecánicos.</div>`,
        pill("Sistema", 600, 96, -4),
        pill("Tamaño · Posición · Chrome · Fuentes · Numeración", 700, 320, 3),
        pill("Agente IA", 830, 96, 2),
        pill("Contenido · Composición · Voz · Estilo", 930, 320, -6),
        `<div style="position:absolute;top:540px;left:96px;width:120px;height:5px;background:${BLUE};border-radius:3px;opacity:0.5;"></div>`,
        `<div style="position:absolute;top:580px;left:96px;font-family:'Space Grotesk',sans-serif;font-size:18px;color:rgba(0,42,255,0.5);letter-spacing:0.1em;text-transform:uppercase;">Determinista ≠ Rígido. Determinista = Consistente.</div>`,
        `<div style="position:absolute;top:150px;right:96px;width:600px;height:600px;border:3px solid rgba(0,42,255,0.1);border-radius:50%;"></div>`,
        `<div style="position:absolute;top:220px;right:166px;width:460px;height:460px;border:2px solid rgba(0,42,255,0.15);border-radius:50%;"></div>`,
        `<div style="position:absolute;top:290px;right:236px;width:320px;height:320px;border:1px solid rgba(0,42,255,0.2);border-radius:50%;"></div>`,
      ].join("\n")
    },
    {
      title: "Anatomía del Frame",
      html: [
        `<div style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:90px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Anatomía</div>`,
        pill("Title Zone · top:72 · H:56px", 260, 96, 0),
        pill("Accent · H:4px · W:72px", 620, 96, 0),
        pill("Content Zone · top:200 · H:760px", 680, 400, 0),
        pill("Footer · Page NN/TT · Deck Name", 920, 96, 0),
        `<div style="position:absolute;top:340px;left:96px;width:1728px;height:620px;border:2px solid rgba(0,42,255,0.2);border-radius:16px;overflow:hidden;">`,
        `<div style="position:absolute;top:0;left:0;right:0;height:72px;border-bottom:1px dashed rgba(0,42,255,0.15);display:flex;align-items:center;padding-left:24px;font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.4);">TITLE ZONE · font: Montserrat 900 · size: 56px</div>`,
        `<div style="position:absolute;top:76px;left:0;right:0;height:4px;background:${BLUE};opacity:0.15;"></div>`,
        `<div style="position:absolute;top:84px;left:0;right:0;height:440px;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk',sans-serif;font-size:28px;color:rgba(0,42,255,0.25);letter-spacing:0.1em;">CONTENT ZONE · COMPOSICIÓN LIBRE</div>`,
        `<div style="position:absolute;bottom:0;left:0;right:0;height:96px;border-top:1px dashed rgba(0,42,255,0.15);display:flex;align-items:center;justify-content:space-between;padding:0 24px;font-family:'Space Grotesk',sans-serif;font-size:13px;color:rgba(0,42,255,0.35);"><span>DECK NAME</span><span>PAGE NN/TT</span></div>`,
        `</div>`,
      ].join("\n")
    },
    {
      title: "API Spec",
      html: [
        `<div style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:90px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">El Spec</div>`,
        pill("name · brand · cover? · slides[]", 260, 96, 0),
        `<div style="position:absolute;top:340px;left:96px;right:96px;display:flex;gap:24px;">`,
        `<div style="flex:1;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.1);border-radius:16px;padding:24px;font-family:'Space Grotesk',sans-serif;font-size:13px;color:rgba(0,42,255,0.6);line-height:1.8;"><div style="color:${BLUE};font-weight:700;font-size:15px;margin-bottom:12px;">brand</div>name: string<br>color: #RRGGBB ✓<br>titleFont: "Montserrat"<br>bodyFont: "Space Grotesk"<br>background: "#FFFFFF"</div>`,
        `<div style="flex:1;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.1);border-radius:16px;padding:24px;font-family:'Space Grotesk',sans-serif;font-size:13px;color:rgba(0,42,255,0.6);line-height:1.8;"><div style="color:${BLUE};font-weight:700;font-size:15px;margin-bottom:12px;">slides[]</div>title?: string<br>html?: string<br>css?: string<br><span style="color:rgba(0,42,255,0.3)">1-40 items max</span></div>`,
        `<div style="flex:1;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.1);border-radius:16px;padding:24px;font-family:'Space Grotesk',sans-serif;font-size:13px;color:rgba(0,42,255,0.6);line-height:1.8;"><div style="color:${BLUE};font-weight:700;font-size:15px;margin-bottom:12px;">cover?</div>html?: string<br>css?: string<br><span style="color:rgba(0,42,255,0.3)">Libre composición<br>sobre color brand</span></div>`,
        `</div>`,
        `<div style="position:absolute;bottom:120px;left:96px;font-family:'Space Grotesk',sans-serif;font-size:16px;color:rgba(0,42,255,0.4);">Misma spec → mismos frames. Siempre.</div>`,
      ].join("\n")
    },
    {
      title: "7 Reglas Anti-Sangrado",
      html: [
        `<div style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">7 Reglas</div>`,
        pill("Harness Rules · Prevención de Sangrado", 240, 96, 0),
        ...[
          ["01", "overflow: hidden", "Explícito en root de cada frame"],
          ["02", "box-sizing: border-box", "Redundante para evitar desbordes"],
          ["03", "max-width: 100%", "En img y svg para contener assets"],
          ["04", "Padding ≤ Frame", "1728px usable (96px × 2 padding)"],
          ["05", "clip-path: inset(0)", "Contiene box-shadows con blur grande"],
          ["06", "Background en frame", "No solo en div interno — evita transparencias"],
          ["07", "Debug: Magenta/Cyan", "Colores contrastantes en desarrollo"],
        ].map(([num, title, desc], i) => {
          const col = i < 4 ? 0 : 1;
          const row = i % 4;
          const x = 96 + col * 504;
          const y = 340 + row * 140;
          return `<div style="position:absolute;top:${y}px;left:${x}px;width:480px;background:${OFFWHITE};border-left:4px solid ${BLUE};border-radius:0 12px 12px 0;padding:16px 20px;"><div style="display:flex;align-items:baseline;gap:12px;"><span style="font-family:'Montserrat',sans-serif;font-size:28px;font-weight:900;color:${BLUE};opacity:0.3;">${num}</span><span style="font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:700;color:${BLUE};">${title}</span></div><div style="font-family:'Space Grotesk',sans-serif;font-size:12px;color:rgba(0,42,255,0.5);margin-top:4px;margin-left:40px;">${desc}</div></div>`;
        }).join("\n"),
      ].join("\n")
    },
    {
      title: "Agent Bridge",
      html: [
        `<div style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">window.</div>`,
        `<div style="position:absolute;top:172px;left:96px;font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">futurariaAgent</div>`,
        pill("Ojos + Lint para agentes de IA", 300, 96, 0),
        ...[
          ["listFrames()", "→ Array of {frameId, width, height}", "Lista frames visibles en el canvas"],
          ["renderFrame(id, scale?)", "→ data:image/png;base64", "Snapshot PNG con fuentes inlineadas"],
          ["inspectFrame(id)", "→ {layers, issues[]}", "Lint: outsideFrame, clippedText, overlapsText"],
        ].map(([method, returns, desc], i) => {
          return `<div style="position:absolute;top:${380 + i * 170}px;left:96px;right:96px;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.1);border-radius:16px;padding:28px 32px;"><div style="font-family:'Space Grotesk',sans-serif;font-size:24px;font-weight:700;color:${BLUE};">${method}</div><div style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.45);margin-top:6px;">${returns}</div><div style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.6);margin-top:4px;">${desc}</div></div>`;
        }).join("\n"),
      ].join("\n")
    },
    {
      title: "Workflow",
      html: [
        `<div style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:90px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Pipeline</div>`,
        ...[
          ["01", "Diseña", "Genera frames vía MCP con update_template"],
          ["02", "Abre", "Editor en /?template=&lt;id&gt;&v=2"],
          ["03", "Inspecciona", "inspectFrame() → corrige issues"],
          ["04", "Renderiza", "renderFrame() → verifica visualmente"],
          ["05", "Itera", "Lint limpio + render aprobado ✅"],
        ].map(([num, title, desc], i) => {
          const x = 96 + i * 350;
          return `<div style="position:absolute;top:310px;left:${x}px;width:320px;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:72px;font-weight:900;color:${BLUE};opacity:0.15;line-height:1;">${num}</div><div style="font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:700;color:${BLUE};margin-top:8px;">${title}</div><div style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.5);margin-top:8px;line-height:1.5;">${desc}</div></div>`;
        }).join("\n"),
        `<div style="position:absolute;top:560px;left:96px;right:96px;height:2px;background:rgba(0,42,255,0.08);"></div>`,
        pill("agent-design.mjs → example → push → editor link", 700, 96, 0),
        `<div style="position:absolute;top:620px;left:96px;right:96px;background:${OFFWHITE};border:1px solid rgba(0,42,255,0.1);border-radius:12px;padding:24px 32px;font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.55);line-height:1.7;"><span style="color:${BLUE};font-weight:700;">$</span> node scripts/agent-design.mjs example > design.json<br><span style="color:${BLUE};font-weight:700;">$</span> node scripts/agent-design.mjs push design.json<br><span style="color:rgba(0,42,255,0.3);">✔ 1 frame(s) publicados → http://localhost:5173/?template=tpl_xxx&v=2</span></div>`,
      ].join("\n")
    },
    {
      title: "Suite de Tests",
      html: [
        `<div style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:90px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">7/7</div>`,
        pill("70ms · 0 fallos · 100% pass rate", 240, 96, 0),
        ...[
          "lays frames side by side at 1920×1080 with no overlaps",
          "numbers every slide and names missing titles deterministically",
          "cover uses corporate color and embeds brand fonts",
          "free cover composition keeps deterministic background",
          "picks readable ink from corporate color luminance",
          "rejects invalid specs with actionable errors",
          "escapes HTML in titles and brand names (XSS-safe)",
        ].map((test, i) => {
          return `<div style="position:absolute;top:${340 + i * 72}px;left:96px;right:96px;display:flex;align-items:center;gap:16px;padding:14px 24px;border-bottom:1px solid rgba(0,42,255,0.06);"><div style="width:28px;height:28px;background:${BLUE};border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:14px;flex-shrink:0;">✓</div><span style="font-family:'Space Grotesk',sans-serif;font-size:15px;color:rgba(0,42,255,0.7);">${test}</span></div>`;
        }).join("\n"),
      ].join("\n")
    },
    {
      title: "File Map",
      html: [
        `<div style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Arquitectura</div>`,
        `<div style="position:absolute;top:300px;left:96px;right:96px;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.1);border-radius:16px;padding:32px;font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.6);line-height:2;"><span style="color:${BLUE};font-weight:700;">design-main/</span><br>├── <span style="color:${BLUE};">worker/runtime/functions/deck-generator.mjs</span>  ← Engine principal<br>│   ├── buildDeckFrames(spec) → { frames, brand, total }<br>│   ├── colorLuminance(hex)   → 0..1<br>│   └── inkFor(bg)            → readable color<br>├── <span style="color:${BLUE};">QA/deck-generator.test.mjs</span>           ← 7 tests<br>├── <span style="color:${BLUE};">src/lib/agentBridge.ts</span>                ← futurariaAgent API<br>├── <span style="color:${BLUE};">scripts/agent-design.mjs</span>              ← CLI example + push<br>└── <span style="color:${BLUE};">docs/DECK_GENERATOR_MANUAL.html</span>       ← Este documento</div>`,
        pill("Cero dependencias · JS puro · Cualquier runtime", 850, 96, 0),
      ].join("\n")
    },
    {
      title: "Start Building",
      html: [
        `<div style="position:absolute;top:120px;left:96px;font-family:'Montserrat',sans-serif;font-size:120px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Build</div>`,
        `<div style="position:absolute;top:228px;left:96px;font-family:'Montserrat',sans-serif;font-size:120px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Your Deck</div>`,
        `<div style="position:absolute;top:400px;left:96px;max-width:900px;font-family:'Space Grotesk',sans-serif;font-size:24px;color:rgba(0,42,255,0.6);line-height:1.6;">Define tu spec. El sistema se encarga del resto.<br>El agente crea. El harness garantiza.</div>`,
        pill("Spec → buildDeckFrames() → Frames → Editor → Publish", 650, 96, 0),
        `<div style="position:absolute;top:560px;left:96px;width:120px;height:5px;background:${BLUE};border-radius:3px;"></div>`,
        `<div style="position:absolute;bottom:120px;left:96px;right:96px;display:flex;gap:32px;">`,
        `<div style="flex:1;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};opacity:0.12;">0</div><div style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.4);margin-top:-20px;">Dependencias</div></div>`,
        `<div style="flex:1;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};opacity:0.12;">∞</div><div style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.4);margin-top:-20px;">Combinaciones</div></div>`,
        `<div style="flex:1;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};opacity:0.12;">⚡</div><div style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.4);margin-top:-20px;">Instantáneo</div></div>`,
        `</div>`,
      ].join("\n")
    },
  ]
};

// Override slide chrome CSS with Coffee Poster fonts
spec.slides.forEach((slide) => {
  slide.css = [
    `[data-deck-chrome="title"] { font-family: 'Montserrat', sans-serif !important; font-weight: 900 !important; font-size: 28px !important; color: ${BLUE} !important; text-transform: uppercase; letter-spacing: 0.2em; }`,
    `[data-deck-chrome="title-accent"] { background: ${BLUE} !important; height: 3px !important; width: 48px !important; }`,
    `[data-deck-chrome="page"] { font-family: 'Space Grotesk', sans-serif !important; color: rgba(0,42,255,0.35) !important; }`,
    `[data-deck-chrome="deck-name"] { font-family: 'Space Grotesk', sans-serif !important; color: rgba(0,42,255,0.35) !important; }`,
  ].join("\n");
});

const result = buildDeckFrames(spec);
const { frames, brand, total } = result;

// ─── RENDER ALL FRAMES IN A SINGLE HTML ───────────────────────
const deckHTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Deck Generator — Design System (Coffee Poster Style)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;900&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a14; color: #fff; font-family: 'Space Grotesk', sans-serif; }
  .deck-header {
    padding: 40px 48px;
    display: flex; justify-content: space-between; align-items: center;
    border-bottom: 1px solid rgba(0,42,255,0.15);
    position: sticky; top: 0; background: #0a0a14; z-index: 100;
  }
  .deck-header h1 { font-family: 'Montserrat', sans-serif; font-weight: 900; font-size: 24px; color: #002aff; letter-spacing: -0.02em; }
  .deck-header .meta { font-size: 14px; color: rgba(255,255,255,0.4); letter-spacing: 0.1em; }
  .canvas-wrap { overflow-x: auto; padding: 48px; }
  .canvas { display: flex; gap: 160px; min-width: max-content; }
  .frame-wrapper {
    flex-shrink: 0;
    position: relative;
  }
  .frame-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 12px;
    color: rgba(255,255,255,0.3);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin-bottom: 12px;
    padding-left: 4px;
  }
  .frame-iframe {
    width: 1920px; height: 1080px;
    border: 1px solid rgba(0,42,255,0.15);
    border-radius: 8px;
    background: white;
    transform-origin: top left;
  }
  .nav-hint {
    position: fixed;
    bottom: 24px; right: 24px;
    font-size: 12px; color: rgba(255,255,255,0.25);
    letter-spacing: 0.1em;
    pointer-events: none;
  }
  /* Zoom slider */
  .zoom-controls {
    display: flex; align-items: center; gap: 12px;
  }
  .zoom-controls input { width: 100px; accent-color: #002aff; }
  .zoom-controls span { font-size: 13px; color: rgba(255,255,255,0.5); min-width: 40px; }
</style>
</head>
<body>
<div class="deck-header">
  <h1>Deck Generator · Design System</h1>
  <div class="meta">☕ Coffee Poster Style · ${total} frames · 1920×1080 · ${brand.name}</div>
  <div class="zoom-controls">
    <span id="zoomLabel">25%</span>
    <input type="range" id="zoomSlider" min="10" max="100" value="25" step="5">
  </div>
</div>
<div class="canvas-wrap">
  <div class="canvas" id="canvas">
${frames.map((f, i) => `
    <div class="frame-wrapper">
      <div class="frame-label">${f.name}</div>
      <iframe class="frame-iframe" id="frame${i}" srcdoc="${f.html.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;')}<style>${f.css.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</style>" sandbox="allow-same-origin"></iframe>
    </div>`).join("\n")}
  </div>
</div>
<div class="nav-hint">scroll → · ${frames[0].name} … ${frames[frames.length-1].name}</div>
<script>
  const slider = document.getElementById('zoomSlider');
  const label = document.getElementById('zoomLabel');
  const iframes = document.querySelectorAll('.frame-iframe');
  const gap = 160;
  function setZoom(pct) {
    const scale = pct / 100;
    const w = 1920 * scale;
    const g = gap * scale;
    iframes.forEach(f => { f.style.width = w + 'px'; f.style.height = (1080 * scale) + 'px'; });
    document.querySelector('.canvas').style.gap = g + 'px';
    label.textContent = pct + '%';
    slider.value = pct;
  }
  slider.addEventListener('input', () => setZoom(parseInt(slider.value)));
  setZoom(25);
</script>
</body>
</html>`;

// Write to file
import { writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

const outDir = resolve("QA");
mkdirSync(outDir, { recursive: true });

const outPath = resolve(outDir, "coffee_poster_deck.html");
writeFileSync(outPath, deckHTML);
console.log(`\n✅ Deck written to: ${outPath}`);
console.log(`   ${total} frames · ${(deckHTML.length / 1024).toFixed(1)}KB`);
