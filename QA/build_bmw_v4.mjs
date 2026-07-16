import { writeFileSync } from "fs";

const BG = "https://images.unsplash.com/photo-1616422285623-13ff0162193c?auto=format&fit=crop&q=80&w=1200";

const formats = [
  { slug: "post",     label: "Post IG",     W: 1080, H: 1350 },
  { slug: "story",    label: "Story",       W: 1080, H: 1920 },
  { slug: "slide",    label: "Slide 16:9",  W: 1920, H: 1080 },
  { slug: "linkedin", label: "LinkedIn",    W: 1200, H: 627  },
];

const GAP = 120; let x = 0;

function build(W, H) {
  const titleSz   = Math.round(W * 0.055);
  const subSz     = Math.round(W * 0.022);
  const logoBMW   = Math.round(W * 0.062);
  const logoMW    = Math.round(W * 0.105);
  const logoMH    = Math.round(W * 0.037);
  const gap        = Math.round(W * 0.028);
  const marginTop  = Math.round(W * 0.012);
  const pad        = Math.round(W * 0.052);
  const maxW       = Math.round(W * 0.84);
  const overlayStart = 42; // %

  return `
<div class="frame-root" data-layer-id="frame_root" data-layer-name="Frame" style="width:${W}px;height:${H}px;position:relative;overflow:hidden;border-radius:20px;display:flex;flex-direction:column;justify-content:flex-end;background:#000000;">
 <style>
   @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&family=Montserrat:wght@400;700;900&display=swap');

   .frame-root {
     width: ${W}px; height: ${H}px;
     position: relative; overflow: hidden; border-radius: 20px;
     display: flex; flex-direction: column; justify-content: flex-end;
     background: #000000;
   }

   .frame-background {
     position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1;
     background:
       linear-gradient(to bottom,
         rgba(0,0,0,0) 0%,
         rgba(0,0,0,0.3) ${overlayStart}%,
         rgba(0,0,0,0.9) 68%,
         rgba(0,0,0,1) 100%
       ),
       url('${BG}') center 22% / cover no-repeat;
   }

   .content {
     position: relative; z-index: 3;
     width: 100%; max-width: ${maxW}px; margin: 0 auto;
     padding: ${pad}px;
     display: flex; flex-direction: column;
     align-items: center; justify-content: flex-end;
     text-align: center; gap: ${gap}px;
   }

   .main-title {
     font-family: 'Inter', sans-serif; font-weight: 900;
     font-size: ${titleSz}px; color: #ffffff;
     line-height: 1.08; letter-spacing: -0.01em;
     text-transform: uppercase; margin: 0;
     text-shadow: 0 2px 10px rgba(0,0,0,0.6);
   }

   .subtitle {
     font-family: 'Inter', sans-serif; font-weight: 700;
     font-size: ${subSz}px; color: rgba(255,255,255,0.92);
     line-height: 1.35; letter-spacing: 0.02em;
     text-transform: uppercase; max-width: 90%; margin: 0;
     text-shadow: 0 2px 8px rgba(0,0,0,0.6);
   }

   .brand-footer {
     display: flex; align-items: center; justify-content: center;
     gap: ${gap}px; margin-top: ${marginTop}px;
   }

   .logo-bmw { width: ${logoBMW}px; height: ${logoBMW}px; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.5)); }
   .logo-m { width: ${logoMW}px; height: ${logoMH}px; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.5)); }
 </style>

 <div class="frame-background" data-layer-id="background" data-layer-name="Fondo Motor"></div>

 <div class="content" data-layer-id="content" data-layer-name="Contenido">
   <h1 class="main-title" data-layer-id="titulo-principal" data-layer-kind="text" data-layer-name="Título Principal">MOTORES TURBO.</h1>
   <p class="subtitle" data-layer-id="subtitulo" data-layer-kind="text" data-layer-name="Descripción / Subtítulo">TECNOLOGÍA M TWINPOWER TURBO CON TRANSMISIÓN MANUAL DE 6 Y 8 VELOCIDADES PARA MÁS POTENCIA.</p>
   <div class="brand-footer" data-layer-id="logos-footer" data-layer-name="Logos BMW">
     <svg class="logo-bmw" data-layer-id="bmw-roundel" data-layer-name="BMW Roundel" viewBox="0 0 100 100">
       <circle cx="50" cy="50" r="48" fill="#000000" stroke="#ffffff" stroke-width="2"/>
       <circle cx="50" cy="50" r="28" fill="none" stroke="#ffffff" stroke-width="1.2"/>
       <path d="M50,50 L50,22 A28,28 0 0,1 78,50 Z" fill="#ffffff"/>
       <path d="M50,50 L78,50 A28,28 0 0,1 50,78 Z" fill="#0066b2"/>
       <path d="M50,50 L50,78 A28,28 0 0,1 22,50 Z" fill="#ffffff"/>
       <path d="M50,50 L22,50 A28,28 0 0,1 50,22 Z" fill="#0066b2"/>
       <text x="50" y="16" fill="#ffffff" font-size="11" font-family="'Montserrat', sans-serif" font-weight="900" text-anchor="middle" transform="rotate(-40 50 50)">B</text>
       <text x="50" y="16" fill="#ffffff" font-size="11" font-family="'Montserrat', sans-serif" font-weight="900" text-anchor="middle">M</text>
       <text x="50" y="16" fill="#ffffff" font-size="11" font-family="'Montserrat', sans-serif" font-weight="900" text-anchor="middle" transform="rotate(40 50 50)">W</text>
     </svg>
     <svg class="logo-m" data-layer-id="bmw-m-logo" data-layer-name="BMW M Logo" viewBox="0 0 160 60">
       <polygon points="12,50 24,14 36,14 24,50" fill="#00a2e0"/>
       <polygon points="24,50 36,14 42,14 30,50" fill="#001c5c"/>
       <polygon points="30,50 42,14 54,14 42,50" fill="#e31b23"/>
       <text x="58" y="50" fill="#ffffff" font-family="'Montserrat', sans-serif" font-weight="900" font-size="46" transform="skewX(-18.43)">M</text>
     </svg>
   </div>
 </div>
</div>`;
}

// ─── Build frames ───
const frames = formats.map(f => {
  const { W, H, slug, label } = f;
  const pos = x;
  x += W + GAP;
  console.log(`   ${label}  ${W}×${H}  title=${Math.round(W*0.055)}px  sub=${Math.round(W*0.022)}px  logoB=${Math.round(W*0.062)}px  logoM=${Math.round(W*0.105)}×${Math.round(W*0.037)}`);
  return { id: `frame_bmw_${slug}`, name: `BMW — ${label}`, x: pos, y: 0, width: W, height: H, background: "#000000", isFrameVisual: true, frameId: `frame_bmw_${slug}`, html: build(W, H), css: `*{margin:0;padding:0;box-sizing:border-box;}` };
});

const design = { workspace: "BMW M Power", name: "BMW M Power — v4 (Improved SVG + Montserrat)", frames };
const path = "QA/bmw_v4.json";
writeFileSync(path, JSON.stringify(design, null, 2));
console.log(`\n✅ ${frames.length} frames → ${path}`);
