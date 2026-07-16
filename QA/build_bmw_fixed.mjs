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

// Template with __W__ / __H__ placeholders → replaced per frame
function buildHtml(W, H) {
  return `
<div class="promo-card" data-layer-id="promo_card" data-layer-name="Promo Card" style="width:${W}px;height:${H}px;">
 <style>
 @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');

 .promo-card {
   position: relative;
   width: ${W}px;
   height: ${H}px;
   container-type: size;
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
   background-position: center 10%;
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
     rgba(0, 0, 0, 0.2) 35%,
     rgba(0, 0, 0, 0.95) 58%,
     rgba(0, 0, 0, 1) 75%,
     #000000 100%
   );
   z-index: 2;
 }

 .content-area {
   position: relative;
   z-index: 3;
   width: 100%;
   max-height: 50cqh;
   max-width: 90%;
   margin: 0 auto;
   padding: 5cqmin;
   display: flex;
   flex-direction: column;
   align-items: center;
   justify-content: flex-end;
   text-align: center;
   gap: 3cqmin;
 }

 .main-title {
   font-family: 'Inter', sans-serif;
   font-weight: 900;
   color: #ffffff;
   line-height: 1.15;
   letter-spacing: -0.01em;
   text-transform: uppercase;
   font-size: clamp(22px, 6.5cqmin, 40px);
   text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
 }

 .description-text {
   font-family: 'Inter', sans-serif;
   font-weight: 700;
   color: rgba(255, 255, 255, 0.95);
   line-height: 1.4;
   letter-spacing: 0.03em;
   text-transform: uppercase;
   max-width: 85%;
   font-size: clamp(10px, 2.5cqmin, 16px);
   text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
 }

 .logo-footer {
   display: flex;
   align-items: center;
   justify-content: center;
   gap: 4cqmin;
   margin-top: 1cqmin;
 }

 .bmw-roundel {
   width: clamp(24px, 8.5cqmin, 45px);
   height: clamp(24px, 8.5cqmin, 45px);
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
   gap: 0.6cqmin;
 }

 .m-stripes {
   display: flex;
   gap: 0.5cqmin;
   transform: skewX(-22deg);
 }

 .m-stripe {
   width: clamp(3px, 0.9cqmin, 5px);
   height: clamp(12px, 3.8cqmin, 20px);
   border-radius: 1px;
 }

 .cyan { background-color: #009ce6; }
 .blue { background-color: #002c5f; }
 .red { background-color: #e31b23; }

 .m-letter {
   font-size: clamp(16px, 5.5cqmin, 28px);
   font-weight: 900;
   color: #ffffff;
   font-style: italic;
   line-height: 1;
   margin-left: 0.4cqmin;
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
  name: "BMW M Power — Gemini Harness (Fixed)",
  frames
};

const path = "QA/bmw_gemini_fixed.json";
writeFileSync(path, JSON.stringify(design, null, 2));

console.log(`✅ ${frames.length} frames → ${path}`);
frames.forEach(f => console.log(`   ${f.name} ${f.width}×${f.height}  @ x=${f.x}`));
