import { writeFileSync } from "fs";

const bgImg = "https://images.unsplash.com/photo-1616422285623-13ff0162193c?auto=format&fit=crop&q=80&w=1200";

const formats = [
  { slug: "post",     label: "Post IG",     W: 1080, H: 1350 },
  { slug: "story",    label: "Story",       W: 1080, H: 1920 },
  { slug: "slide",    label: "Slide 16:9",  W: 1920, H: 1080 },
  { slug: "linkedin", label: "LinkedIn",    W: 1200, H: 627  },
];

const GAP = 120;
let xOffset = 0;

function buildHtml(W, H) {
  // ─── PROPORTIONAL scaling per format (my v1 math) ───
  const titleSize = Math.round(W * 0.053);
  const descSize = Math.round(W * 0.023);
  const bmwLogo = Math.round(W * 0.074);
  const mSize = Math.round(W * 0.048);
  const stripeW = Math.round(W * 0.008);
  const stripeH = Math.round(W * 0.033);
  const stripeGap = Math.round(W * 0.004);
  const gap = Math.round(W * 0.035);
  const padding = Math.round(W * 0.058);
  const descMaxW = Math.round(W * 0.85);

  return `
<div class="promo-card" data-layer-id="promo_card" data-layer-name="Promo Card" style="width:${W}px;height:${H}px;border-radius:20px;overflow:hidden;position:relative;display:flex;flex-direction:column;justify-content:flex-end;background:#000000;">
 <style>
 @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');

 .promo-card {
   width: ${W}px;
   height: ${H}px;
   position: relative;
   overflow: hidden;
   border-radius: 20px;
   background-color: #000000;
   display: flex;
   flex-direction: column;
   justify-content: flex-end;
 }

 .background-media {
   position: absolute;
   top: 0;
   left: 0;
   width: 100%;
   height: 100%;
   background-image: url('${bgImg}');
   background-size: cover;
   background-position: center 25%;
   z-index: 1;
 }

 .scenic-overlay {
   position: absolute;
   top: 0;
   left: 0;
   width: 100%;
   height: 100%;
   background: linear-gradient(
     to bottom,
     rgba(0, 0, 0, 0) 0%,
     rgba(0, 0, 0, 0.45) 45%,
     rgba(0, 0, 0, 0.92) 70%,
     rgba(0, 0, 0, 1) 100%
   );
   z-index: 2;
 }

 .content-area {
   position: relative;
   z-index: 3;
   width: 100%;
   max-width: ${descMaxW}px;
   margin: 0 auto;
   padding: ${padding}px;
   display: flex;
   flex-direction: column;
   align-items: center;
   justify-content: flex-end;
   text-align: center;
   gap: ${gap}px;
 }

 .main-title {
   font-family: 'Inter', sans-serif;
   font-weight: 900;
   font-size: ${titleSize}px;
   color: #ffffff;
   line-height: 1.1;
   letter-spacing: -0.01em;
   text-transform: uppercase;
   text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
   margin: 0;
 }

 .description-text {
   font-family: 'Inter', sans-serif;
   font-weight: 700;
   font-size: ${descSize}px;
   color: rgba(255, 255, 255, 0.95);
   line-height: 1.35;
   letter-spacing: 0.02em;
   text-transform: uppercase;
   max-width: 90%;
   text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
   margin: 0;
 }

 .logo-footer {
   display: flex;
   align-items: center;
   justify-content: center;
   gap: ${Math.round(W * 0.035)}px;
   margin-top: ${Math.round(W * 0.015)}px;
 }

 .bmw-roundel {
   width: ${bmwLogo}px;
   height: ${bmwLogo}px;
   filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.5));
 }

 .bmw-letter {
   fill: #ffffff;
   font-family: 'Inter', sans-serif;
   font-weight: 900;
   font-size: 11px;
 }

 .bmw-m-logo {
   display: flex;
   align-items: center;
   gap: ${Math.round(W * 0.005)}px;
 }

 .m-stripes {
   display: flex;
   gap: ${stripeGap}px;
   transform: skewX(-22deg);
 }

 .m-stripe {
   width: ${stripeW}px;
   height: ${stripeH}px;
   border-radius: 1px;
 }

 .cyan { background-color: #009ce6; }
 .blue { background-color: #002c5f; }
 .red { background-color: #e31b23; }

 .m-letter {
   font-family: 'Inter', sans-serif;
   font-size: ${mSize}px;
   font-weight: 900;
   color: #ffffff;
   font-style: italic;
   line-height: 1;
   margin-left: ${Math.round(W * 0.004)}px;
   letter-spacing: -0.05em;
 }
 </style>

 <div class="background-media" data-layer-id="bg_media" data-layer-name="Background"></div>
 <div class="scenic-overlay" data-layer-id="overlay" data-layer-name="Gradient Overlay"></div>

 <div class="content-area" data-layer-id="content_area" data-layer-name="Content Area">
   <h1 class="main-title" data-layer-id="title" data-layer-kind="text" data-layer-name="Motores Turbo">Motores Turbo.</h1>
   <p class="description-text" data-layer-id="desc" data-layer-kind="text" data-layer-name="Description">Tecnología M TwinPower Turbo con transmisión manual de 6 y 8 velocidades para más potencia.</p>
   <div class="logo-footer" data-layer-id="logo_footer" data-layer-name="Logo Footer">
     <svg class="bmw-roundel" data-layer-id="bmw_roundel" data-layer-name="BMW Roundel" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
       <circle cx="50" cy="50" r="48" fill="#000000" stroke="#ffffff" stroke-width="2.5"/>
       <circle cx="50" cy="50" r="30" fill="none" stroke="#ffffff" stroke-width="2"/>
       <path d="M50,20 A30,30 0 0,1 80,50 L50,50 Z" fill="#ffffff"/>
       <path d="M80,50 A30,30 0 0,1 50,80 L50,50 Z" fill="#0066b2"/>
       <path d="M50,80 A30,30 0 0,1 20,50 L50,50 Z" fill="#ffffff"/>
       <path d="M20,50 A30,30 0 0,1 50,20 L50,50 Z" fill="#0066b2"/>
       <g transform="translate(50,50)">
         <text class="bmw-letter" transform="rotate(-38) translate(0, -34)" text-anchor="middle">B</text>
         <text class="bmw-letter" transform="rotate(0) translate(0, -34)" text-anchor="middle">M</text>
         <text class="bmw-letter" transform="rotate(38) translate(0, -34)" text-anchor="middle">W</text>
       </g>
     </svg>
     <div class="bmw-m-logo" data-layer-id="m_logo" data-layer-name="M Logo">
       <div class="m-stripes" data-layer-id="m_stripes" data-layer-name="M Stripes">
         <div class="m-stripe cyan"></div>
         <div class="m-stripe blue"></div>
         <div class="m-stripe red"></div>
       </div>
       <span class="m-letter" data-layer-id="m_letter" data-layer-kind="text" data-layer-name="M">M</span>
     </div>
   </div>
 </div>
</div>`;
}

const frames = formats.map(fmt => {
  const { W, H, slug, label } = fmt;
  const x = xOffset;
  xOffset = x + W + GAP;
  console.log(`   ${label}: title=${Math.round(W*0.053)}px desc=${Math.round(W*0.023)}px logo=${Math.round(W*0.074)}px`);
  return {
    id: `frame_bmw_${slug}`,
    name: `BMW — ${label}`,
    x, y: 0,
    width: W, height: H,
    background: "#000000",
    isFrameVisual: true,
    frameId: `frame_bmw_${slug}`,
    html: buildHtml(W, H),
    css: `*{margin:0;padding:0;box-sizing:border-box;}`
  };
});

const design = {
  workspace: "BMW M Power",
  name: "BMW M Power — Hybrid (v1 scale + Gemini structure + fix)",
  frames
};

const path = "QA/bmw_hybrid.json";
writeFileSync(path, JSON.stringify(design, null, 2));
console.log(`\n✅ ${frames.length} frames → ${path}`);
