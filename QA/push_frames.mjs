// Push frames from coffee poster deck to template tpl_eee431a0-a3e
import { buildDeckFrames } from "../worker/runtime/functions/deck-generator.mjs";

const BLUE = "#002aff";
const WHITE = "#ffffff";
const OFFWHITE = "#f8f9ff";
const TEMPLATE_ID = "tpl_eee431a0-a3e";
const API = "https://design.futuraria.com";

function pill(text, top, left, rot = 0) {
  return `<div data-layer-name="${text}" style="position:absolute;top:${top}px;left:${left}px;background:${WHITE};border:5px solid ${BLUE};border-radius:80px;padding:10px 36px;z-index:10;box-shadow:0 6px 18px rgba(0,42,255,0.06);transform:rotate(${rot}deg);"><span style="font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700;color:${BLUE};letter-spacing:0.02em;text-transform:uppercase;">${text}</span></div>`;
}

const spec = {
  name: "Deck Generator — Design System",
  brand: { name: "Futuraria", color: BLUE, titleFont: "Montserrat", bodyFont: "Space Grotesk", background: WHITE },
  cover: {
    html: [
      `<div data-layer-id="cover_subhead" data-layer-kind="text" data-layer-name="Subhead" style="position:absolute;top:72px;left:0;width:100%;text-align:center;font-family:'Space Grotesk',sans-serif;font-size:32px;font-weight:700;color:${BLUE};letter-spacing:0.06em;text-transform:uppercase;">SISTEMA DE GENERACIÓN DETERMINISTA</div>`,
      `<div data-layer-id="cover_title1" data-layer-kind="text" data-layer-name="Title Deck" style="position:absolute;top:180px;left:96px;font-family:'Montserrat',sans-serif;font-size:200px;font-weight:900;color:${BLUE};line-height:0.85;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Deck</div>`,
      `<div data-layer-id="cover_title2" data-layer-kind="text" data-layer-name="Title Generator" style="position:absolute;top:350px;left:96px;font-family:'Montserrat',sans-serif;font-size:200px;font-weight:900;color:${BLUE};line-height:0.85;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Generator</div>`,
      pill("Design System", 380, 1120, -8),
      pill("11 frames", 800, 1150, 10),
      pill("v1.0 · Julio 2026", 1000, 80, -5),
    ].join("\n"),
    css: ""
  },
  slides: [
    {
      title: "Visión General",
      html: [
        `<div data-layer-id="s1_title1" data-layer-kind="text" data-layer-name="Motor" style="position:absolute;top:140px;left:96px;font-family:'Montserrat',sans-serif;font-size:120px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Motor</div>`,
        `<div data-layer-id="s1_title2" data-layer-kind="text" data-layer-name="Determinista" style="position:absolute;top:248px;left:96px;font-family:'Montserrat',sans-serif;font-size:120px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Determinista</div>`,
        `<div data-layer-id="s1_desc" data-layer-kind="text" data-layer-name="Descripción" style="position:absolute;top:400px;left:96px;max-width:800px;font-family:'Space Grotesk',sans-serif;font-size:22px;color:rgba(0,42,255,0.7);line-height:1.6;">Scaffolding para decks compuestos por IA. Separa decisiones creativas de decisiones mecánicas. El agente solo piensa en contenido — el sistema garantiza consistencia visual.</div>`,
        pill("1920×1080", 750, 96, -3),
        pill("160px gap", 750, 350, 5),
        pill("40 slides max", 750, 580, -7),
        `<div data-layer-id="s1_stats" data-layer-name="Stats Row" style="position:absolute;bottom:100px;left:96px;right:96px;display:flex;gap:32px;"><div style="flex:1;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.15);border-radius:24px;padding:32px;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:64px;font-weight:900;color:${BLUE};">6</div><div style="font-family:'Space Grotesk',sans-serif;font-size:16px;color:rgba(0,42,255,0.6);margin-top:8px;">Frames generados</div></div><div style="flex:1;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.15);border-radius:24px;padding:32px;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:64px;font-weight:900;color:${BLUE};">7/7</div><div style="font-family:'Space Grotesk',sans-serif;font-size:16px;color:rgba(0,42,255,0.6);margin-top:8px;">Tests pasando</div></div><div style="flex:1;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.15);border-radius:24px;padding:32px;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:64px;font-weight:900;color:${BLUE};">70ms</div><div style="font-family:'Space Grotesk',sans-serif;font-size:16px;color:rgba(0,42,255,0.6);margin-top:8px;">Ejecución total</div></div></div>`
      ].join("\n")
    },
    {
      title: "Filosofía",
      html: [
        `<div data-layer-id="s2_title1" data-layer-kind="text" data-layer-name="El Siste" style="position:absolute;top:120px;left:96px;font-family:'Montserrat',sans-serif;font-size:100px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">El Siste</div>`,
        `<div data-layer-id="s2_title2" data-layer-kind="text" data-layer-name="ma Decide" style="position:absolute;top:210px;left:96px;font-family:'Montserrat',sans-serif;font-size:100px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">ma Decide</div>`,
        `<div data-layer-id="s2_desc" data-layer-kind="text" data-layer-name="Descripción" style="position:absolute;top:340px;left:96px;max-width:750px;font-family:'Space Grotesk',sans-serif;font-size:20px;color:rgba(0,42,255,0.7);line-height:1.7;">Todo lo que <strong>NO</strong> es una decisión creativa es decidido por el sistema. El agente de IA nunca gasta tokens en cálculos mecánicos.</div>`,
        pill("Sistema", 600, 96, -4),
        pill("Tamaño · Posición · Chrome · Fuentes · Numeración", 700, 320, 3),
        pill("Agente IA", 830, 96, 2),
        pill("Contenido · Composición · Voz · Estilo", 930, 320, -6),
        `<div data-layer-id="s2_rule" data-layer-name="Rule" style="position:absolute;top:540px;left:96px;width:120px;height:5px;background:${BLUE};border-radius:3px;opacity:0.5;"></div>`,
        `<div data-layer-id="s2_tagline" data-layer-kind="text" data-layer-name="Tagline" style="position:absolute;top:580px;left:96px;font-family:'Space Grotesk',sans-serif;font-size:18px;color:rgba(0,42,255,0.5);letter-spacing:0.1em;text-transform:uppercase;">Determinista ≠ Rígido. Determinista = Consistente.</div>`,
        `<div data-layer-id="s2_circle1" data-layer-name="Circle 1" style="position:absolute;top:150px;right:96px;width:600px;height:600px;border:3px solid rgba(0,42,255,0.1);border-radius:50%;"></div>`,
        `<div data-layer-id="s2_circle2" data-layer-name="Circle 2" style="position:absolute;top:220px;right:166px;width:460px;height:460px;border:2px solid rgba(0,42,255,0.15);border-radius:50%;"></div>`,
        `<div data-layer-id="s2_circle3" data-layer-name="Circle 3" style="position:absolute;top:290px;right:236px;width:320px;height:320px;border:1px solid rgba(0,42,255,0.2);border-radius:50%;"></div>`,
      ].join("\n")
    },
    {
      title: "Anatomía del Frame",
      html: [
        `<div data-layer-id="s3_title" data-layer-kind="text" data-layer-name="Anatomía" style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:90px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Anatomía</div>`,
        pill("Title Zone · top:72 · H:56px", 260, 96, 0),
        pill("Accent · H:4px · W:72px", 620, 96, 0),
        pill("Content Zone · top:200 · H:760px", 680, 400, 0),
        pill("Footer · Page NN/TT · Deck Name", 920, 96, 0),
        `<div data-layer-id="s3_diagram" data-layer-name="Frame Diagram" style="position:absolute;top:340px;left:96px;width:1728px;height:620px;border:2px solid rgba(0,42,255,0.2);border-radius:16px;overflow:hidden;"><div style="position:absolute;top:0;left:0;right:0;height:72px;border-bottom:1px dashed rgba(0,42,255,0.15);display:flex;align-items:center;padding-left:24px;font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.4);">TITLE ZONE · font: Montserrat 900 · size: 56px</div><div style="position:absolute;top:76px;left:0;right:0;height:4px;background:${BLUE};opacity:0.15;"></div><div style="position:absolute;top:84px;left:0;right:0;height:440px;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk',sans-serif;font-size:28px;color:rgba(0,42,255,0.25);letter-spacing:0.1em;">CONTENT ZONE · COMPOSICIÓN LIBRE</div><div style="position:absolute;bottom:0;left:0;right:0;height:96px;border-top:1px dashed rgba(0,42,255,0.15);display:flex;align-items:center;justify-content:space-between;padding:0 24px;font-family:'Space Grotesk',sans-serif;font-size:13px;color:rgba(0,42,255,0.35);"><span>DECK NAME</span><span>PAGE NN/TT</span></div></div>`,
      ].join("\n")
    },
    {
      title: "API Spec",
      html: [
        `<div data-layer-id="s4_title" data-layer-kind="text" data-layer-name="El Spec" style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:90px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;">El Spec</div>`,
        pill("name · brand · cover? · slides[]", 260, 96, 0),
        `<div data-layer-id="s4_cards" data-layer-name="Spec Cards" style="position:absolute;top:340px;left:96px;right:96px;display:flex;gap:24px;"><div style="flex:1;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.1);border-radius:16px;padding:24px;font-family:'Space Grotesk',sans-serif;font-size:13px;color:rgba(0,42,255,0.6);line-height:1.8;"><div style="color:${BLUE};font-weight:700;font-size:15px;margin-bottom:12px;">brand</div>name: string<br>color: #RRGGBB ✓<br>titleFont: "Montserrat"<br>bodyFont: "Space Grotesk"<br>background: "#FFFFFF"</div><div style="flex:1;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.1);border-radius:16px;padding:24px;font-family:'Space Grotesk',sans-serif;font-size:13px;color:rgba(0,42,255,0.6);line-height:1.8;"><div style="color:${BLUE};font-weight:700;font-size:15px;margin-bottom:12px;">slides[]</div>title?: string<br>html?: string<br>css?: string<br><span style="color:rgba(0,42,255,0.3)">1-40 items max</span></div><div style="flex:1;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.1);border-radius:16px;padding:24px;font-family:'Space Grotesk',sans-serif;font-size:13px;color:rgba(0,42,255,0.6);line-height:1.8;"><div style="color:${BLUE};font-weight:700;font-size:15px;margin-bottom:12px;">cover?</div>html?: string<br>css?: string<br><span style="color:rgba(0,42,255,0.3)">Libre composición<br>sobre color brand</span></div></div>`,
        `<div data-layer-id="s4_deterministic" data-layer-kind="text" data-layer-name="Deterministic Note" style="position:absolute;bottom:120px;left:96px;font-family:'Space Grotesk',sans-serif;font-size:16px;color:rgba(0,42,255,0.4);">Misma spec → mismos frames. Siempre.</div>`,
      ].join("\n")
    },
    {
      title: "7 Reglas Anti-Sangrado",
      html: [
        `<div data-layer-id="s5_title" data-layer-kind="text" data-layer-name="7 Reglas" style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">7 Reglas</div>`,
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
          return `<div data-layer-id="s5_rule${num}" data-layer-name="Rule ${num}" style="position:absolute;top:${y}px;left:${x}px;width:480px;background:${OFFWHITE};border-left:4px solid ${BLUE};border-radius:0 12px 12px 0;padding:16px 20px;"><div style="display:flex;align-items:baseline;gap:12px;"><span style="font-family:'Montserrat',sans-serif;font-size:28px;font-weight:900;color:${BLUE};opacity:0.3;">${num}</span><span style="font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:700;color:${BLUE};">${title}</span></div><div style="font-family:'Space Grotesk',sans-serif;font-size:12px;color:rgba(0,42,255,0.5);margin-top:4px;margin-left:40px;">${desc}</div></div>`;
        }).join("\n"),
      ].join("\n")
    },
    {
      title: "Agent Bridge",
      html: [
        `<div data-layer-id="s6_title1" data-layer-kind="text" data-layer-name="window." style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">window.</div>`,
        `<div data-layer-id="s6_title2" data-layer-kind="text" data-layer-name="futurariaAgent" style="position:absolute;top:172px;left:96px;font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">futurariaAgent</div>`,
        ...[
          ["listFrames()", "→ Array of {frameId, width, height}", "Lista frames visibles en el canvas"],
          ["renderFrame(id, scale?)", "→ data:image/png;base64", "Snapshot PNG con fuentes inlineadas"],
          ["inspectFrame(id)", "→ {layers, issues[]}", "Lint: outsideFrame, clippedText, overlapsText"],
        ].map(([method, returns, desc], i) => {
          return `<div data-layer-id="s6_api${i}" data-layer-name="API ${method}" style="position:absolute;top:${380 + i * 170}px;left:96px;right:96px;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.1);border-radius:16px;padding:28px 32px;"><div style="font-family:'Space Grotesk',sans-serif;font-size:24px;font-weight:700;color:${BLUE};">${method}</div><div style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.45);margin-top:6px;">${returns}</div><div style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.6);margin-top:4px;">${desc}</div></div>`;
        }).join("\n"),
      ].join("\n")
    },
    {
      title: "Workflow",
      html: [
        `<div data-layer-id="s7_title" data-layer-kind="text" data-layer-name="Pipeline" style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:90px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Pipeline</div>`,
        ...[
          ["01", "Diseña", "Genera frames vía MCP con update_template"],
          ["02", "Abre", "Editor en /?template=&lt;id&gt;&v=2"],
          ["03", "Inspecciona", "inspectFrame() → corrige issues"],
          ["04", "Renderiza", "renderFrame() → verifica visualmente"],
          ["05", "Itera", "Lint limpio + render aprobado ✅"],
        ].map(([num, title, desc], i) => {
          const x = 96 + i * 350;
          return `<div data-layer-id="s7_step${num}" data-layer-name="Step ${num} - ${title}" style="position:absolute;top:310px;left:${x}px;width:320px;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:72px;font-weight:900;color:${BLUE};opacity:0.15;line-height:1;">${num}</div><div style="font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:700;color:${BLUE};margin-top:8px;">${title}</div><div style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.5);margin-top:8px;line-height:1.5;">${desc}</div></div>`;
        }).join("\n"),
        `<div data-layer-id="s7_divider" data-layer-name="Divider" style="position:absolute;top:560px;left:96px;right:96px;height:2px;background:rgba(0,42,255,0.08);"></div>`,
        pill("agent-design.mjs → example → push → editor link", 700, 96, 0),
        `<div data-layer-id="s7_cli" data-layer-name="CLI Block" style="position:absolute;top:620px;left:96px;right:96px;background:${OFFWHITE};border:1px solid rgba(0,42,255,0.1);border-radius:12px;padding:24px 32px;font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.55);line-height:1.7;"><span style="color:${BLUE};font-weight:700;">$</span> node scripts/agent-design.mjs example > design.json<br><span style="color:${BLUE};font-weight:700;">$</span> node scripts/agent-design.mjs push design.json<br><span style="color:rgba(0,42,255,0.3);">✔ 1 frame(s) publicados → http://localhost:5173/?template=tpl_xxx&v=2</span></div>`,
      ].join("\n")
    },
    {
      title: "Suite de Tests",
      html: [
        `<div data-layer-id="s8_title" data-layer-kind="text" data-layer-name="7/7" style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:90px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">7/7</div>`,
        ...[
          "lays frames side by side at 1920×1080 with no overlaps",
          "numbers every slide and names missing titles deterministically",
          "cover uses corporate color and embeds brand fonts",
          "free cover composition keeps deterministic background",
          "picks readable ink from corporate color luminance",
          "rejects invalid specs with actionable errors",
          "escapes HTML in titles and brand names (XSS-safe)",
        ].map((test, i) => {
          return `<div data-layer-id="s8_test${i}" data-layer-name="Test ${i}" style="position:absolute;top:${340 + i * 72}px;left:96px;right:96px;display:flex;align-items:center;gap:16px;padding:14px 24px;border-bottom:1px solid rgba(0,42,255,0.06);"><div style="width:28px;height:28px;background:${BLUE};border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:14px;flex-shrink:0;">✓</div><span style="font-family:'Space Grotesk',sans-serif;font-size:15px;color:rgba(0,42,255,0.7);">${test}</span></div>`;
        }).join("\n"),
      ].join("\n")
    },
    {
      title: "File Map",
      html: [
        `<div data-layer-id="s9_title" data-layer-kind="text" data-layer-name="Arquitectura" style="position:absolute;top:100px;left:96px;font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Arquitectura</div>`,
        `<div data-layer-id="s9_tree" data-layer-name="File Tree" style="position:absolute;top:300px;left:96px;right:96px;background:${OFFWHITE};border:2px solid rgba(0,42,255,0.1);border-radius:16px;padding:32px;font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.6);line-height:2;"><span style="color:${BLUE};font-weight:700;">design-main/</span><br>├── <span style="color:${BLUE};">worker/runtime/functions/deck-generator.mjs</span>  ← Engine principal<br>│   ├── buildDeckFrames(spec) → { frames, brand, total }<br>│   ├── colorLuminance(hex) → 0..1<br>│   └── inkFor(bg) → readable color<br>├── <span style="color:${BLUE};">QA/deck-generator.test.mjs</span> ← 7 tests<br>├── <span style="color:${BLUE};">src/lib/agentBridge.ts</span> ← futurariaAgent API<br>├── <span style="color:${BLUE};">scripts/agent-design.mjs</span> ← CLI example + push<br>└── <span style="color:${BLUE};">docs/DECK_GENERATOR_MANUAL.html</span> ← Este documento</div>`,
        pill("Cero dependencias · JS puro · Cualquier runtime", 850, 96, 0),
      ].join("\n")
    },
    {
      title: "Start Building",
      html: [
        `<div data-layer-id="s10_title1" data-layer-kind="text" data-layer-name="Build" style="position:absolute;top:120px;left:96px;font-family:'Montserrat',sans-serif;font-size:120px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Build</div>`,
        `<div data-layer-id="s10_title2" data-layer-kind="text" data-layer-name="Your Deck" style="position:absolute;top:228px;left:96px;font-family:'Montserrat',sans-serif;font-size:120px;font-weight:900;color:${BLUE};line-height:0.9;letter-spacing:-0.04em;text-transform:uppercase;user-select:none;">Your Deck</div>`,
        `<div data-layer-id="s10_desc" data-layer-kind="text" data-layer-name="Descripción" style="position:absolute;top:400px;left:96px;max-width:900px;font-family:'Space Grotesk',sans-serif;font-size:24px;color:rgba(0,42,255,0.6);line-height:1.6;">Define tu spec. El sistema se encarga del resto.<br>El agente crea. El harness garantiza.</div>`,
        pill("Spec → buildDeckFrames() → Frames → Editor → Publish", 650, 96, 0),
        `<div data-layer-id="s10_rule" data-layer-name="Rule" style="position:absolute;top:560px;left:96px;width:120px;height:5px;background:${BLUE};border-radius:3px;"></div>`,
        `<div data-layer-id="s10_footer" data-layer-name="Footer Stats" style="position:absolute;bottom:120px;left:96px;right:96px;display:flex;gap:32px;"><div style="flex:1;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};opacity:0.12;">0</div><div style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.4);margin-top:-20px;">Dependencias</div></div><div style="flex:1;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};opacity:0.12;">∞</div><div style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.4);margin-top:-20px;">Combinaciones</div></div><div style="flex:1;text-align:center;"><div style="font-family:'Montserrat',sans-serif;font-size:80px;font-weight:900;color:${BLUE};opacity:0.12;">⚡</div><div style="font-family:'Space Grotesk',sans-serif;font-size:14px;color:rgba(0,42,255,0.4);margin-top:-20px;">Instantáneo</div></div></div>`,
      ].join("\n")
    },
  ]
};

spec.slides.forEach((slide) => {
  slide.css = [
    `[data-deck-chrome="title"] { opacity: 0 !important; }`,
    `[data-deck-chrome="title-accent"] { opacity: 0 !important; }`,
    `[data-deck-chrome="page"] { font-family: 'Space Grotesk', sans-serif !important; color: rgba(0,42,255,0.25) !important; font-size: 16px !important; }`,
    `[data-deck-chrome="deck-name"] { font-family: 'Space Grotesk', sans-serif !important; color: rgba(0,42,255,0.25) !important; font-size: 16px !important; }`,
  ].join("\n");
});

const result = buildDeckFrames(spec);
const frames = result.frames.map((f, i) => ({
  id: f.id,
  name: f.name,
  x: f.x,
  y: f.y,
  width: f.width,
  height: f.height,
  background: f.background,
  html: f.html,
  css: f.css,
  isFrameVisual: true,
  frameId: f.id
}));

console.log(`Generated ${frames.length} frames`);

// Push frames one at a time via PUT to template
async function pushFrames() {
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const payload = JSON.stringify({ frames: [frame] });
    console.log(`\nPushing frame ${i + 1}/${frames.length}: ${frame.name} (${(payload.length / 1024).toFixed(1)}KB)...`);
    
    try {
      const res = await fetch(`${API}/api/templates/${TEMPLATE_ID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: payload
      });
      const data = await res.json();
      if (data.success) {
        console.log(`  ✅ ${frame.name} pushed`);
      } else {
        console.log(`  ❌ ${frame.name} failed:`, JSON.stringify(data).substring(0, 200));
      }
    } catch (e) {
      console.log(`  ❌ ${frame.name} error:`, e.message);
    }
  }
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🎯 Editor: ${API}/?template=${TEMPLATE_ID}&v=2`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

pushFrames();
