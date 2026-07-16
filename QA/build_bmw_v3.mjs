import { writeFileSync } from "fs";

// ─── 4 formatos, 1 solo código ──────────────────────────
const formats = [
  { slug: "post",     label: "Post IG",     W: 1080, H: 1350 },
  { slug: "story",    label: "Story",       W: 1080, H: 1920 },
  { slug: "slide",    label: "Slide 16:9",  W: 1920, H: 1080 },
  { slug: "linkedin", label: "LinkedIn",    W: 1200, H: 627  },
];

const GAP = 120;
let xOffset = 0;

// ─── HTML + CSS determinista (mismo para todos los frames) ───
const html = [
  // Root: container-type:size habilita cqw/cqh/cqmin/cqmax
  `<div class="promo-card" data-layer-id="promo_card" data-layer-name="Promo Card" style="width:100%;height:100%;border-radius:20px;overflow:hidden;position:relative;container-type:size;display:flex;flex-direction:column;justify-content:flex-end;">`,
  // Layer 1: Background image with focal point
  `<div data-layer-id="bg_media" data-layer-name="Background" style="position:absolute;top:0;left:0;width:100%;height:100%;background-image:url('https://images.unsplash.com/photo-1616422285623-13ff0162193c?auto=format&fit=crop&q=80&w=1200');background-size:cover;background-position:center 25%;z-index:1;"></div>`,
  // Layer 2: Cinematic gradient
  `<div data-layer-id="overlay" data-layer-name="Gradient Overlay" style="position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(to bottom,rgba(0,0,0,0) 0%,rgba(0,0,0,0.4) 40%,rgba(0,0,0,0.85) 75%,rgba(0,0,0,1) 100%);z-index:2;"></div>`,
  // Layer 3: Content block — flexbox flow, NO absolutes
  `<div data-layer-id="content_area" data-layer-name="Content Area" style="position:relative;z-index:3;width:100%;max-height:55cqh;padding:6cqmin;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;text-align:center;gap:3.5cqmin;">`,
  // Title
  `<h1 data-layer-id="title" data-layer-kind="text" data-layer-name="Motores Turbo" style="font-size:clamp(20px,6.2cqmin,58px);font-weight:900;color:#ffffff;line-height:1.1;letter-spacing:-0.01em;text-transform:uppercase;text-shadow:0 2px 10px rgba(0,0,0,0.6);margin:0;">Motores Turbo.</h1>`,
  // Description
  `<p data-layer-id="desc" data-layer-kind="text" data-layer-name="Description" style="font-size:clamp(10px,2.4cqmin,22px);font-weight:700;color:rgba(255,255,255,0.9);line-height:1.4;letter-spacing:0.03em;max-width:92%;text-transform:uppercase;text-shadow:0 2px 8px rgba(0,0,0,0.6);margin:0;">Tecnología M TwinPower Turbo con transmisión manual de 6 y 8 velocidades para más potencia.</p>`,
  // Logo footer
  `<div data-layer-id="logo_footer" data-layer-name="Logo Footer" style="display:flex;align-items:center;justify-content:center;gap:4cqmin;margin-top:1cqmin;">`,
  // BMW Roundel
  `<svg data-layer-id="bmw_roundel" data-layer-name="BMW Roundel" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:clamp(24px,9cqmin,60px);height:clamp(24px,9cqmin,60px);filter:drop-shadow(0 4px 10px rgba(0,0,0,0.5));"><circle cx="50" cy="50" r="48" fill="#000000" stroke="#ffffff" stroke-width="2.5"/><circle cx="50" cy="50" r="30" fill="none" stroke="#ffffff" stroke-width="2"/><path d="M50,20 A30,30 0 0,1 80,50 L50,50 Z" fill="#ffffff"/><path d="M80,50 A30,30 0 0,1 50,80 L50,50 Z" fill="#0066b2"/><path d="M50,80 A30,30 0 0,1 20,50 L50,50 Z" fill="#ffffff"/><path d="M20,50 A30,30 0 0,1 50,20 L50,50 Z" fill="#0066b2"/><g transform="translate(50,50)"><text fill="#ffffff" font-family="Inter,sans-serif" font-weight="900" font-size="11" transform="rotate(-38) translate(0,-34)" text-anchor="middle">B</text><text fill="#ffffff" font-family="Inter,sans-serif" font-weight="900" font-size="11" transform="rotate(0) translate(0,-34)" text-anchor="middle">M</text><text fill="#ffffff" font-family="Inter,sans-serif" font-weight="900" font-size="11" transform="rotate(38) translate(0,-34)" text-anchor="middle">W</text></g></svg>`,
  // M Logo
  `<div data-layer-id="m_logo" data-layer-name="M Logo" style="display:flex;align-items:center;gap:0.6cqmin;">`,
  `<div data-layer-id="m_stripes" data-layer-name="M Stripes" style="display:flex;gap:0.5cqmin;transform:skewX(-22deg);">`,
  `<div style="width:clamp(3px,0.9cqmin,7px);height:clamp(12px,3.8cqmin,28px);border-radius:1px;background:#009ce6;"></div>`,
  `<div style="width:clamp(3px,0.9cqmin,7px);height:clamp(12px,3.8cqmin,28px);border-radius:1px;background:#002c5f;"></div>`,
  `<div style="width:clamp(3px,0.9cqmin,7px);height:clamp(12px,3.8cqmin,28px);border-radius:1px;background:#e31b23;"></div>`,
  `</div>`,
  `<span data-layer-id="m_letter" data-layer-kind="text" data-layer-name="M" style="font-size:clamp(16px,5.5cqmin,36px);font-weight:900;color:#ffffff;font-style:italic;line-height:1;margin-left:0.4cqmin;letter-spacing:-0.05em;">M</span>`,
  `</div>`,
  `</div>`,
  `</div>`,
  `</div>`,
].join("\n");

const css = [
  `@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap");`,
  `*{margin:0;padding:0;box-sizing:border-box;}`,
  `body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#08080a;font-family:Inter,sans-serif;}`,
].join("\n");

// ─── Build frames — same HTML/CSS, different dimensions ───
const frames = formats.map(fmt => {
  const { W, H, slug, label } = fmt;
  const x = xOffset;
  xOffset = x + W + GAP;

  return {
    id: `frame_bmw_${slug}`,
    name: `BMW — ${label}`,
    x, y: 0,
    width: W, height: H,
    background: "#08080a",
    isFrameVisual: true,
    frameId: `frame_bmw_${slug}`,
    html,
    css,
  };
});

const design = {
  workspace: "BMW M Power",
  name: "BMW M Power — All Formats (Deterministic cqmin)",
  frames,
};

const path = "QA/bmw_deterministic.json";
writeFileSync(path, JSON.stringify(design, null, 2));

console.log(`✅ ${frames.length} frames → ${path}`);
frames.forEach(f => console.log(`   ${f.name}  ${f.width}×${f.height}  x=${f.x}`));
console.log(`   Total canvas: ${xOffset - GAP}px`);
console.log(`\n🔑 Same HTML/CSS in all frames. Container queries (cqmin/cqh) handle adaptation.`);
