// Futuraria Design — 3 Welcome Posts (ADISruptive style)
// Using Creative Mode: set_html + set_css (no editability contract, full CSS freedom)
const BASE = "https://design.futuraria.com/mcp";
const API_KEY = "***";
const WS_ID = "ws_user_8e9f031817184e0ab205";

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

// ADISruptive design tokens
const BG = "#fafffa", DK = "#121613", GR = "#2bee4b", AC = "#e8f5e9", MU = "#6b7b6d";

// Shared CSS
const SHARED_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@0,300;0,400;0,500;0,600;0,700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1080px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:${BG}}
.post{width:1080px;height:1080px;background:${BG};position:relative;overflow:hidden;display:flex;flex-direction:column}
.masthead{display:flex;justify-content:space-between;align-items:center;padding:56px 72px 0}
.wm{font-family:Inter,sans-serif;font-size:19px;font-weight:600;color:${DK}}
.gm{display:inline-block;width:14px;height:14px;margin-left:9px;position:relative;top:2px;background:${GR};border-radius:50%}
.ml{font-family:Inter,sans-serif;font-size:19px;font-weight:400;color:${DK}}
.content{padding:64px 72px;flex:1;display:flex;flex-direction:column;justify-content:center;position:relative;z-index:1}
h1{font-family:'Playfair Display',serif;font-size:76px;font-weight:700;color:${DK};line-height:1.05;letter-spacing:-0.02em;margin-bottom:0}
h2{font-family:'Playfair Display',serif;font-size:50px;font-weight:600;color:${DK};line-height:1.15;margin-bottom:20px}
h3{font-family:Inter,sans-serif;font-size:18px;font-weight:600;color:${GR};text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px}
p{font-family:Inter,sans-serif;font-size:21px;font-weight:400;color:${MU};line-height:1.5;max-width:700px}
.tag{display:inline-block;font-family:Inter,sans-serif;font-size:15px;font-weight:600;color:${DK};background:${AC};padding:8px 18px;border-radius:6px;margin-right:10px;margin-bottom:10px}
.tag-row{margin-bottom:4px}
.cta-btn{display:inline-block;font-family:Inter,sans-serif;font-size:18px;font-weight:600;color:#fff;background:${DK};padding:16px 32px;border-radius:8px;margin-top:12px}
.footer{display:flex;justify-content:space-between;align-items:center;padding:0 72px 48px;font-family:Inter,sans-serif;font-size:15px;color:${MU};position:relative;z-index:1}
.divider{position:absolute;height:1px;background:${AC};left:72px;right:72px;bottom:84px}
.line-v{position:absolute;width:1px;background:${AC};height:80px;top:90px;right:52px}
.num{font-family:'Playfair Display',serif;font-size:120px;font-weight:700;color:${AC};line-height:1;position:absolute;top:100px;right:72px;opacity:0.8;z-index:0}
`;

// ===== FRAME 1: Bienvenida =====
const FRAME1_HTML = `
<div class="post">
  <div class="line-v"></div>
  <div class="num">01</div>
  <div class="masthead">
    <div class="wm">Futuraria Design</div>
    <div><span class="ml">Julio 2026<span class="gm"></span></span></div>
  </div>
  <div class="content">
    <h3>BIENVENIDO A LA HERRAMIENTA</h3>
    <h1>Disena,<br>Automatiza,<br>Publica.</h1>
    <p style="margin-top:24px">Todo en un solo lugar. Sin cambiar de herramienta. Sin perder tiempo exportando. Vos creas, Futuraria se encarga del resto.</p>
  </div>
  <div class="divider"></div>
  <div class="footer">
    <span>futuraria.com</span>
    <span>Design Engine v2</span>
  </div>
</div>`;

// ===== FRAME 2: Features =====
const FRAME2_HTML = `
<div class="post">
  <div class="line-v"></div>
  <div class="num">02</div>
  <div class="masthead">
    <div class="wm">Futuraria Design</div>
    <div><span class="ml">Julio 2026<span class="gm"></span></span></div>
  </div>
  <div class="content">
    <h3>LO QUE PUEDES CREAR</h3>
    <h2>Posts, carruseles,<br>presentaciones y mas.</h2>
    <div class="tag-row">
      <span class="tag">Posts Instagram</span>
      <span class="tag">Carruseles</span>
      <span class="tag">Stories</span>
    </div>
    <div class="tag-row">
      <span class="tag">Presentaciones</span>
      <span class="tag">Banners</span>
      <span class="tag">Cotizaciones</span>
    </div>
    <div class="tag-row">
      <span class="tag">Facturas</span>
      <span class="tag">Flyers</span>
      <span class="tag">Mailing</span>
    </div>
    <p style="margin-top:32px">Cada diseno es un template reutilizable. Edita colores, textos e imagenes. La IA te ayuda a crear variaciones en segundos.</p>
  </div>
  <div class="divider"></div>
  <div class="footer">
    <span>futuraria.com</span>
    <span>+50 templates disponibles</span>
  </div>
</div>`;

// ===== FRAME 3: CTA =====
const FRAME3_HTML = `
<div class="post">
  <div class="line-v"></div>
  <div class="num">03</div>
  <div class="masthead">
    <div class="wm">Futuraria Design</div>
    <div><span class="ml">Julio 2026<span class="gm"></span></span></div>
  </div>
  <div class="content">
    <h3>EMPIEZA AHORA</h3>
    <h1>Tu primer<br>diseno en<br>5 minutos.</h1>
    <p style="margin-top:16px">Sin curva de aprendizaje. Sin instalar nada. Abri el editor, elegi un template y personalizalo con tu marca.</p>
    <div><span class="cta-btn">Abrir el Editor</span></div>
  </div>
  <div class="divider"></div>
  <div class="footer">
    <span>futuraria.com</span>
    <span>design.futuraria.com</span>
  </div>
</div>`;

// ===== EXECUTE =====
async function main() {
  // Step 1: Create template
  console.log("1. Creating template...");
  const tpl = await mcp("create_template", {
    name: "Futuraria Design - Bienvenida (3 Posts) v3",
    workspaceId: WS_ID,
    width: 3240, height: 1080,
    engine: "html"
  });
  const tplId = tpl.id;
  const f0Id = tpl.frames[0].id;
  console.log(`   Template: ${tplId} | Frame0: ${f0Id}`);

  // Step 2: Add frames 2 & 3
  console.log("2. Adding frames 2 & 3...");
  await mcp("update_template", {
    id: tplId,
    frames: [
      { id: f0Id, name: "01 - Bienvenida", x: 0, y: 0, width: 1080, height: 1080, css: "", html: "", background: BG },
      { id: "f2_features", name: "02 - Features", x: 1080, y: 0, width: 1080, height: 1080, css: "", html: "", background: BG },
      { id: "f3_cta", name: "03 - CTA", x: 2160, y: 0, width: 1080, height: 1080, css: "", html: "", background: BG },
    ]
  });
  console.log("   3 frames positioned.");

  // Step 3: set_html + set_css for each frame
  console.log("3. Setting content for Frame 1...");
  await mcp("set_html", { templateId: tplId, frameId: f0Id, html: FRAME1_HTML });
  console.log("   Frame 1 HTML done.");

  console.log("4. Setting content for Frame 2...");
  await mcp("set_html", { templateId: tplId, frameId: "f2_features", html: FRAME2_HTML });
  console.log("   Frame 2 HTML done.");

  console.log("5. Setting content for Frame 3...");
  await mcp("set_html", { templateId: tplId, frameId: "f3_cta", html: FRAME3_HTML });
  console.log("   Frame 3 HTML done.");

  // set_css to all 3 frames (same design system)
  console.log("6. Setting CSS for all frames...");
  for (const fid of [f0Id, "f2_features", "f3_cta"]) {
    await mcp("set_css", { templateId: tplId, frameId: fid, css: SHARED_CSS });
  }
  console.log("   CSS applied to all 3 frames.");

  console.log("\n=== DONE ===");
  console.log(`Template: ${tplId}`);
  console.log(`Editor: https://design.futuraria.com?template=${tplId}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
