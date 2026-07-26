import { readFileSync } from "fs";

const BASE = "https://design.futuraria.com/mcp";
const API_KEY = "fdr_ws_wKLREhPcELuh78Oq9sn6DUmg4eWY9Lh5";
const TPL_ID = "tpl_6345f1ad-6ac";
const FRAME_ID = "frame_603be03c-718";

async function mcp(method, args) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: method, arguments: args } }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  const text = json.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : json.result;
}

// FIXED CSS: body selector for frame background (mapBodySelectors maps body → #__df_content)
// Inherited font styles via * but objects have their own classes
const frameCSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;800;900&family=Fredoka:wght@700&display=swap');

body {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  font-family: 'Montserrat', sans-serif;
  width: 600px;
  height: 600px;
  overflow: hidden;
  clip-path: inset(0);
  border-radius: 4px;
  position: relative;
  background-image: linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.35)), url('https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?q=80&w=800&auto=format&fit=crop');
  background-size: cover;
  background-position: center;
  color: #ffffff;
}

body img, body svg { max-width: 100%; height: auto; }

.badge-top{display:inline-block;background-color:#6d00c1;color:#fff;padding:8px 14px;border-radius:8px;font-weight:900;font-size:18px;line-height:1.2;letter-spacing:0.5px;text-transform:uppercase;box-shadow:0 4px 10px rgba(0,0,0,0.3)}

.programa{font-weight:800;font-size:18px;letter-spacing:2px;text-transform:uppercase;text-shadow:0 2px 4px rgba(0,0,0,0.7)}

.title-acelera{font-family:'Fredoka',cursive,sans-serif;font-size:46px;line-height:0.9;color:#fff;text-transform:uppercase;transform:rotate(-3deg);text-shadow:2px 2px 0 #5b0099,-2px -2px 0 #5b0099,2px -2px 0 #5b0099,-2px 2px 0 #5b0099,0px 6px 0 #41006f,0px 10px 15px rgba(0,0,0,0.5)}

.badge-financiado{background-color:#6d00c1;color:#fff;padding:10px 22px;border-radius:50px;font-weight:800;font-size:18px;box-shadow:0 4px 12px rgba(0,0,0,0.4)}

.date-banner{display:inline-block;background-color:#6d00c1;color:#fff;font-weight:800;font-size:16px;padding:6px 20px;border-radius:4px;letter-spacing:0.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3)}

.info-title{font-size:16px;font-weight:800;letter-spacing:1px;text-shadow:0 2px 4px rgba(0,0,0,0.8)}

.zoom-text{font-size:15px;font-weight:800;letter-spacing:1px;display:flex;align-items:center;justify-content:center;gap:6px;text-shadow:0 2px 4px rgba(0,0,0,0.8)}

.footer-divider{width:100%;height:1px;background-color:rgba(255,255,255,0.7)}

.logo-box{display:flex;align-items:center;gap:8px;font-size:10px;font-weight:700;line-height:1.1}

.border-left-box{border-left:1px solid #fff;padding-left:6px}

.innovate-title{font-size:9px;font-weight:400;opacity:0.9}

.innovate-brand{font-size:14px;font-weight:900}

.continental{font-size:13px;font-weight:800;display:flex;align-items:center;gap:6px}
`;

const objects = [
  {
    id: "top_logo", type: "icon",
    x: 24, y: 24, width: 42, height: 42,
    html: `<svg viewBox="0 0 100 100" fill="white" width="42" height="42"><path d="M 20 20 L 80 20 L 80 30 L 30 30 L 30 40 L 70 40 L 70 50 L 30 50 L 30 60 L 80 60 L 80 70 L 20 70 Z"/></svg>`,
    css: ""
  },
  {
    id: "badge_top", type: "text",
    x: 24, y: 78, width: 380, height: 56,
    html: `<div class="badge-top">LLEVA TU NEGOCIO<br>AL SIGUIENTE NIVEL</div>`,
    css: ""
  },
  {
    id: "programa_label", type: "text",
    x: 44, y: 152, width: 200, height: 24,
    html: `<span class="programa">PROGRAMA</span>`,
    css: ""
  },
  {
    id: "title_acelera", type: "text",
    x: 34, y: 180, width: 420, height: 100,
    html: `<div class="title-acelera">ACELERA<br>DIGITAL</div>`,
    css: ""
  },
  {
    id: "badge_financiado", type: "text",
    x: 378, y: 270, width: 192, height: 44,
    html: `<span class="badge-financiado">90% financiado</span>`,
    css: ""
  },
  {
    id: "date_banner", type: "text",
    x: 144, y: 418, width: 312, height: 32,
    html: `<span class="date-banner">VIERNES 26 DE JUNIO | 7:00PM</span>`,
    css: ""
  },
  {
    id: "charla_label", type: "text",
    x: 124, y: 458, width: 352, height: 22,
    html: `<div class="info-title">CHARLA INFORMATIVA VIRTUAL</div>`,
    css: ""
  },
  {
    id: "zoom_row", type: "text",
    x: 160, y: 484, width: 280, height: 24,
    html: `<div class="zoom-text"><svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg> VÍA ZOOM</div>`,
    css: ""
  },
  {
    id: "footer_divider", type: "shape",
    x: 24, y: 524, width: 552, height: 1,
    html: `<div class="footer-divider"></div>`,
    css: ""
  },
  {
    id: "footer_logos", type: "group",
    x: 24, y: 537, width: 552, height: 40,
    html: `<div style="display:flex;justify-content:space-between;align-items:center;width:552px">
  <div class="logo-box">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 2L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-3z"/></svg>
    <div class="border-left-box">PERÚ <span style="font-weight:400">Ministerio<br>de la Producción</span></div>
  </div>
  <div class="logo-box" style="flex-direction:column;align-items:flex-start;gap:0">
    <span class="innovate-title">Cofinanciado por</span>
    <span class="innovate-brand">PRO innóvate</span>
  </div>
  <div class="logo-box">
    <div class="continental">
      <svg width="20" height="20" viewBox="0 0 100 100" fill="white"><path d="M 20 20 L 80 20 L 80 30 L 30 30 L 30 40 L 70 40 L 70 50 L 30 50 L 30 60 L 80 60 L 80 70 L 20 70 Z"/></svg>
      <div>Continental<br><span style="font-size:8px;font-weight:400">International Education</span></div>
    </div>
  </div>
</div>`,
    css: ""
  }
];

const frame = {
  id: FRAME_ID,
  name: "Acelera Digital - Flyer",
  x: 0, y: 0,
  width: 600, height: 600,
  css: frameCSS,
  html: "",
  background: "", // EMPTY — let CSS background-image take effect (DesignFrame.tsx:357 sets content.style.background)
  objects: objects,
  isFrameVisual: true,
  frameId: FRAME_ID
};

console.log("Updating template with fixed CSS...");
const result = await mcp("update_template", {
  id: TPL_ID,
  frames: [frame]
});
console.log("Result:", result._editability ? JSON.stringify(result._editability) : "no _editability");
console.log("\nTemplate updated! Refresh the editor.");
console.log("URL: https://design.futuraria.com?template=" + TPL_ID);
