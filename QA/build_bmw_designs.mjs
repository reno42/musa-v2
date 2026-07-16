import { writeFileSync } from "fs";

const bgImg = "https://images.unsplash.com/photo-1616422285623-13ff0162193c?auto=format&fit=crop&q=80&w=1200";

const formats = [
  { slug: "bmw_post", label: "BMW M Power — Post IG", W: 1080, H: 1350 },
  { slug: "bmw_story", label: "BMW M Power — Story", W: 1080, H: 1920 },
  { slug: "bmw_slide", label: "BMW M Power — Slide", W: 1920, H: 1080 },
  { slug: "bmw_linkedin", label: "BMW M Power — LinkedIn", W: 1200, H: 627 },
];

function buildDesign(fmt) {
  const { W, H } = fmt;
  const pad = Math.round(H * 0.06);
  const titleSize = Math.round(W * 0.053);
  const descSize = Math.round(W * 0.023);
  const bmwLogoSz = Math.round(W * 0.074);
  const mSize = Math.round(W * 0.048);
  const stripeW = Math.round(W * 0.008);
  const stripeH = Math.round(W * 0.033);
  const stripeGap = Math.round(W * 0.004);
  const descMaxW = Math.round(W * 0.85);
  const titleTop = Math.round(H * 0.62);
  const descTop = Math.round(H * 0.74);
  const logoBottom = pad;
  const logoLeftOffset = Math.round(bmwLogoSz * 1.8);
  const stripeLeft = Math.round(W / 2 - stripeW * 1.5 - stripeGap);
  const mLeft = stripeLeft + stripeW * 3 + stripeGap * 2 + Math.round(W * 0.012);
  const logoLeft = Math.round(W / 2 - logoLeftOffset);
  const logoCenter = Math.round(stripeLeft + stripeW * 1.5);
  const logoBottomStripe = Math.round(logoBottom + bmwLogoSz * 0.18);

  return {
    workspace: "BMW M Power",
    name: fmt.label,
    frames: [{
      id: `frame_${fmt.slug}`,
      name: fmt.label,
      x: 0, y: 0,
      width: W, height: H,
      background: "#000000",
      html: [
        `<div data-layer-id="bg_img" data-layer-name="Engine Photo" style="position:absolute;top:0;left:0;width:${W}px;height:${H}px;background:url(${bgImg}) center 30%/cover no-repeat;"></div>`,
        `<div data-layer-id="gradient" data-layer-name="Gradient Overlay" style="position:absolute;top:0;left:0;width:${W}px;height:${H}px;background:linear-gradient(to bottom,rgba(0,0,0,0) 0%,rgba(0,0,0,0.5) 55%,rgba(0,0,0,0.95) 80%,rgba(0,0,0,1) 100%);"></div>`,
        `<h1 data-layer-id="title" data-layer-kind="text" data-layer-name="Motores Turbo" style="position:absolute;left:0;top:${titleTop}px;width:100%;text-align:center;font-family:Inter,sans-serif;font-size:${titleSize}px;font-weight:900;color:#ffffff;letter-spacing:-0.01em;text-transform:uppercase;text-shadow:0 2px 10px rgba(0,0,0,0.5);margin:0;">Motores Turbo.</h1>`,
        `<p data-layer-id="desc" data-layer-kind="text" data-layer-name="Description" style="position:absolute;left:50%;top:${descTop}px;transform:translateX(-50%);width:${descMaxW}px;text-align:center;font-family:Inter,sans-serif;font-size:${descSize}px;font-weight:700;color:#ffffff;line-height:1.35;letter-spacing:0.02em;text-transform:uppercase;text-shadow:0 2px 8px rgba(0,0,0,0.5);margin:0;">Tecnología M TwinPower Turbo con transmisión manual de 6 y 8 velocidades para más potencia.</p>`,
        `<div data-layer-id="bmw_roundel" data-layer-name="BMW Roundel" style="position:absolute;left:${logoLeft}px;bottom:${logoBottom}px;"><svg width="${bmwLogoSz}" height="${bmwLogoSz}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 4px 10px rgba(0,0,0,0.4));"><circle cx="50" cy="50" r="48" fill="#000000" stroke="#ffffff" stroke-width="2.5"/><circle cx="50" cy="50" r="30" fill="none" stroke="#ffffff" stroke-width="2"/><path d="M50,20 A30,30 0 0,1 80,50 L50,50 Z" fill="#ffffff"/><path d="M80,50 A30,30 0 0,1 50,80 L50,50 Z" fill="#0066b2"/><path d="M50,80 A30,30 0 0,1 20,50 L50,50 Z" fill="#ffffff"/><path d="M20,50 A30,30 0 0,1 50,20 L50,50 Z" fill="#0066b2"/><g transform="translate(50,50)"><text fill="#ffffff" font-family="Inter,sans-serif" font-weight="900" font-size="11" transform="rotate(-38) translate(0,-34)" text-anchor="middle">B</text><text fill="#ffffff" font-family="Inter,sans-serif" font-weight="900" font-size="11" transform="rotate(0) translate(0,-34)" text-anchor="middle">M</text><text fill="#ffffff" font-family="Inter,sans-serif" font-weight="900" font-size="11" transform="rotate(38) translate(0,-34)" text-anchor="middle">W</text></g></svg></div>`,
        `<div data-layer-id="m_stripes" data-layer-name="M Stripes" style="position:absolute;left:${stripeLeft}px;bottom:${logoBottomStripe}px;display:flex;gap:${stripeGap}px;"><div style="width:${stripeW}px;height:${stripeH}px;border-radius:1px;background:#009ce6;transform:skewX(-22deg);"></div><div style="width:${stripeW}px;height:${stripeH}px;border-radius:1px;background:#002c5f;transform:skewX(-22deg);"></div><div style="width:${stripeW}px;height:${stripeH}px;border-radius:1px;background:#e31b23;transform:skewX(-22deg);"></div></div>`,
        `<span data-layer-id="m_letter" data-layer-kind="text" data-layer-name="M Letter" style="position:absolute;left:${mLeft}px;bottom:${logoBottomStripe}px;font-family:Inter,sans-serif;font-size:${mSize}px;font-weight:900;color:#ffffff;font-style:italic;line-height:1;letter-spacing:-0.05em;">M</span>`,
      ].join("\n"),
      css: [
        '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap");',
        "*{margin:0;padding:0;box-sizing:border-box;}",
        `body{width:${W}px;height:${H}px;overflow:hidden;background:#000000;font-family:Inter,sans-serif;}`,
      ].join("\n")
    }]
  };
}

for (const fmt of formats) {
  const design = buildDesign(fmt);
  const path = `QA/design_${fmt.slug}.json`;
  writeFileSync(path, JSON.stringify(design, null, 2));
  console.log(`Created: ${path} (${fmt.W}×${fmt.H})`);
}
