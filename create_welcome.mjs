const BASE = "https://design.futuraria.com/mcp";
const API_KEY = "fdr_ws_wKLREhPcELuh78Oq9sn6DUmg4eWY9Lh5";
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

// Brand
const BG = "#fafffa";
const DARK = "#121613";
const GREEN = "#2bee4b";
const ACCENT = "#e8f5e9";
const MUTED = "#6b7b6d";

const FONTS = [
  "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@0,300;0,400;0,500;0,600;0,700&display=swap"
];

// Helper: masthead layers (brand + date + dot + vertical line + number)
function mastheadLayers(frameNum, brandText, dateText) {
  const numRight = 936; // 1080 - 72 - 72
  return [
    { id: `f${frameNum}_line_v`, name: "Accent Line", kind: "shape", x: 1028, y: 90, width: 1, height: 80, style: { backgroundColor: ACCENT } },
    { id: `f${frameNum}_brand`, name: "Brand", kind: "text", tag: "span", x: 72, y: 56, width: 350, height: 28, text: brandText, style: { fontFamily: "Inter, sans-serif", fontSize: "19px", fontWeight: "600", color: DARK } },
    { id: `f${frameNum}_date`, name: "Date", kind: "text", tag: "span", x: 780, y: 56, width: 230, height: 28, text: dateText, style: { fontFamily: "Inter, sans-serif", fontSize: "19px", fontWeight: "400", color: DARK, textAlign: "right" } },
    { id: `f${frameNum}_dot`, name: "Green Dot", kind: "shape", x: 1012, y: 64, width: 14, height: 14, style: { backgroundColor: GREEN, borderRadius: "50%" } },
    { id: `f${frameNum}_num`, name: "Frame Number", kind: "text", tag: "span", x: 880, y: 110, width: 130, height: 130, text: String(frameNum).padStart(2,'0'), style: { fontFamily: "'Playfair Display', serif", fontSize: "110px", fontWeight: "700", color: ACCENT, textAlign: "right", lineHeight: "1" } },
  ];
}

// Shared footer layers
function footerLayers(frameNum, left, right) {
  return [
    { id: `f${frameNum}_divider`, name: "Divider", kind: "shape", x: 72, y: 960, width: 936, height: 1, style: { backgroundColor: ACCENT } },
    { id: `f${frameNum}_ft_l`, name: "Footer Left", kind: "text", tag: "span", x: 72, y: 980, width: 250, height: 24, text: left, style: { fontFamily: "Inter, sans-serif", fontSize: "15px", fontWeight: "400", color: MUTED } },
    { id: `f${frameNum}_ft_r`, name: "Footer Right", kind: "text", tag: "span", x: 770, y: 980, width: 240, height: 24, text: right, style: { fontFamily: "Inter, sans-serif", fontSize: "15px", fontWeight: "400", color: MUTED, textAlign: "right" } },
  ];
}

// ===== FRAME 0: Bienvenida =====
const frame0Layers = [
  ...mastheadLayers(1, "Futuraria Design", "Julio 2026"),
  { id: "f0_tagline", name: "Tagline", kind: "text", tag: "h3", x: 72, y: 250, width: 600, height: 30, text: "BIENVENIDO A LA HERRAMIENTA", style: { fontFamily: "Inter, sans-serif", fontSize: "18px", fontWeight: "600", color: GREEN, textTransform: "uppercase", letterSpacing: "1.5px" } },
  { id: "f0_title_1", name: "Title Line 1", kind: "text", tag: "h1", x: 72, y: 300, width: 850, height: 80, text: "Diseña,", style: { fontFamily: "'Playfair Display', serif", fontSize: "76px", fontWeight: "700", color: DARK, lineHeight: "1.05" } },
  { id: "f0_title_2", name: "Title Line 2", kind: "text", tag: "h1", x: 72, y: 376, width: 850, height: 80, text: "Automatiza,", style: { fontFamily: "'Playfair Display', serif", fontSize: "76px", fontWeight: "700", color: DARK, lineHeight: "1.05" } },
  { id: "f0_title_3", name: "Title Line 3", kind: "text", tag: "h1", x: 72, y: 452, width: 850, height: 80, text: "Publica.", style: { fontFamily: "'Playfair Display', serif", fontSize: "76px", fontWeight: "700", color: DARK, lineHeight: "1.05" } },
  { id: "f0_desc", name: "Description", kind: "text", tag: "p", x: 72, y: 570, width: 700, height: 120, text: "Todo en un solo lugar. Sin cambiar de herramienta. Sin perder tiempo exportando. Vos creas, Futuraria se encarga del resto.", style: { fontFamily: "Inter, sans-serif", fontSize: "21px", fontWeight: "400", color: MUTED, lineHeight: "1.5" } },
  ...footerLayers(1, "futuraria.com", "Design Engine v2"),
];

// ===== FRAME 1: Features =====
const frame1Layers = [
  ...mastheadLayers(2, "Futuraria Design", "Julio 2026"),
  { id: "f1_tagline", name: "Tagline", kind: "text", tag: "h3", x: 72, y: 250, width: 600, height: 30, text: "LO QUE PUEDES CREAR", style: { fontFamily: "Inter, sans-serif", fontSize: "18px", fontWeight: "600", color: GREEN, textTransform: "uppercase", letterSpacing: "1.5px" } },
  { id: "f1_title", name: "Title", kind: "text", tag: "h2", x: 72, y: 300, width: 800, height: 130, text: "Posts, carruseles, presentaciones y más.", style: { fontFamily: "'Playfair Display', serif", fontSize: "50px", fontWeight: "600", color: DARK, lineHeight: "1.15" } },
  // Tags row 1
  { id: "f1_tag1", name: "Tag 1", kind: "shape", x: 72, y: 470, width: 170, height: 36, style: { backgroundColor: ACCENT, borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" } },
  { id: "f1_tag1_t", name: "Tag 1 Text", kind: "text", tag: "span", x: 88, y: 476, width: 138, height: 24, text: "Posts Instagram", style: { fontFamily: "Inter, sans-serif", fontSize: "15px", fontWeight: "600", color: DARK } },
  { id: "f1_tag2", name: "Tag 2", kind: "shape", x: 255, y: 470, width: 130, height: 36, style: { backgroundColor: ACCENT, borderRadius: "6px" } },
  { id: "f1_tag2_t", name: "Tag 2 Text", kind: "text", tag: "span", x: 271, y: 476, width: 98, height: 24, text: "Carruseles", style: { fontFamily: "Inter, sans-serif", fontSize: "15px", fontWeight: "600", color: DARK } },
  { id: "f1_tag3", name: "Tag 3", kind: "shape", x: 398, y: 470, width: 90, height: 36, style: { backgroundColor: ACCENT, borderRadius: "6px" } },
  { id: "f1_tag3_t", name: "Tag 3 Text", kind: "text", tag: "span", x: 414, y: 476, width: 58, height: 24, text: "Stories", style: { fontFamily: "Inter, sans-serif", fontSize: "15px", fontWeight: "600", color: DARK } },
  // Tags row 2
  { id: "f1_tag4", name: "Tag 4", kind: "shape", x: 72, y: 518, width: 160, height: 36, style: { backgroundColor: ACCENT, borderRadius: "6px" } },
  { id: "f1_tag4_t", name: "Tag 4 Text", kind: "text", tag: "span", x: 88, y: 524, width: 128, height: 24, text: "Presentaciones", style: { fontFamily: "Inter, sans-serif", fontSize: "15px", fontWeight: "600", color: DARK } },
  { id: "f1_tag5", name: "Tag 5", kind: "shape", x: 245, y: 518, width: 100, height: 36, style: { backgroundColor: ACCENT, borderRadius: "6px" } },
  { id: "f1_tag5_t", name: "Tag 5 Text", kind: "text", tag: "span", x: 261, y: 524, width: 68, height: 24, text: "Banners", style: { fontFamily: "Inter, sans-serif", fontSize: "15px", fontWeight: "600", color: DARK } },
  { id: "f1_tag6", name: "Tag 6", kind: "shape", x: 358, y: 518, width: 140, height: 36, style: { backgroundColor: ACCENT, borderRadius: "6px" } },
  { id: "f1_tag6_t", name: "Tag 6 Text", kind: "text", tag: "span", x: 374, y: 524, width: 108, height: 24, text: "Cotizaciones", style: { fontFamily: "Inter, sans-serif", fontSize: "15px", fontWeight: "600", color: DARK } },
  // Tags row 3
  { id: "f1_tag7", name: "Tag 7", kind: "shape", x: 72, y: 566, width: 100, height: 36, style: { backgroundColor: ACCENT, borderRadius: "6px" } },
  { id: "f1_tag7_t", name: "Tag 7 Text", kind: "text", tag: "span", x: 88, y: 572, width: 68, height: 24, text: "Facturas", style: { fontFamily: "Inter, sans-serif", fontSize: "15px", fontWeight: "600", color: DARK } },
  { id: "f1_tag8", name: "Tag 8", kind: "shape", x: 185, y: 566, width: 80, height: 36, style: { backgroundColor: ACCENT, borderRadius: "6px" } },
  { id: "f1_tag8_t", name: "Tag 8 Text", kind: "text", tag: "span", x: 201, y: 572, width: 48, height: 24, text: "Flyers", style: { fontFamily: "Inter, sans-serif", fontSize: "15px", fontWeight: "600", color: DARK } },
  { id: "f1_tag9", name: "Tag 9", kind: "shape", x: 278, y: 566, width: 100, height: 36, style: { backgroundColor: ACCENT, borderRadius: "6px" } },
  { id: "f1_tag9_t", name: "Tag 9 Text", kind: "text", tag: "span", x: 294, y: 572, width: 68, height: 24, text: "Mailing", style: { fontFamily: "Inter, sans-serif", fontSize: "15px", fontWeight: "600", color: DARK } },
  // Description
  { id: "f1_desc", name: "Description", kind: "text", tag: "p", x: 72, y: 640, width: 700, height: 80, text: "Cada diseño es un template reutilizable. Editá colores, textos e imágenes. La IA te ayuda a crear variaciones en segundos.", style: { fontFamily: "Inter, sans-serif", fontSize: "21px", fontWeight: "400", color: MUTED, lineHeight: "1.5" } },
  ...footerLayers(2, "futuraria.com", "+50 templates disponibles"),
];

// ===== FRAME 2: CTA =====
const frame2Layers = [
  ...mastheadLayers(3, "Futuraria Design", "Julio 2026"),
  { id: "f2_tagline", name: "Tagline", kind: "text", tag: "h3", x: 72, y: 250, width: 600, height: 30, text: "EMPIEZA AHORA", style: { fontFamily: "Inter, sans-serif", fontSize: "18px", fontWeight: "600", color: GREEN, textTransform: "uppercase", letterSpacing: "1.5px" } },
  { id: "f2_title_1", name: "Title Line 1", kind: "text", tag: "h1", x: 72, y: 300, width: 850, height: 80, text: "Tu primer", style: { fontFamily: "'Playfair Display', serif", fontSize: "76px", fontWeight: "700", color: DARK, lineHeight: "1.05" } },
  { id: "f2_title_2", name: "Title Line 2", kind: "text", tag: "h1", x: 72, y: 376, width: 850, height: 80, text: "diseño en", style: { fontFamily: "'Playfair Display', serif", fontSize: "76px", fontWeight: "700", color: DARK, lineHeight: "1.05" } },
  { id: "f2_title_3", name: "Title Line 3", kind: "text", tag: "h1", x: 72, y: 452, width: 850, height: 80, text: "5 minutos.", style: { fontFamily: "'Playfair Display', serif", fontSize: "76px", fontWeight: "700", color: DARK, lineHeight: "1.05" } },
  { id: "f2_desc", name: "Description", kind: "text", tag: "p", x: 72, y: 570, width: 700, height: 90, text: "Sin curva de aprendizaje. Sin instalar nada. Abrí el editor, elegí un template y personalizalo con tu marca.", style: { fontFamily: "Inter, sans-serif", fontSize: "21px", fontWeight: "400", color: MUTED, lineHeight: "1.5" } },
  // CTA Button
  { id: "f2_cta_bg", name: "CTA Button BG", kind: "shape", x: 72, y: 690, width: 240, height: 52, style: { backgroundColor: DARK, borderRadius: "8px" } },
  { id: "f2_cta_t", name: "CTA Text", kind: "text", tag: "span", x: 108, y: 702, width: 168, height: 28, text: "Abrir el Editor →", style: { fontFamily: "Inter, sans-serif", fontSize: "18px", fontWeight: "600", color: "#ffffff" } },
  ...footerLayers(3, "futuraria.com", "design.futuraria.com"),
];

// Step 1: Create template (auto-creates 1 frame)
console.log("Creating template...");
const tpl = await mcp("create_template", {
  name: "Futuraria Design - Bienvenida (3 Posts)",
  workspaceId: WS_ID,
  width: 3240, height: 1080,
  engine: "html",
});
const tplId = tpl.id;
const autoFrameId = tpl.frames[0].id;
console.log(`Template: ${tplId} | Auto frame: ${autoFrameId}`);

// Step 2: Add frames 2 and 3 via update_template (position only, no html/css)
// Modify the auto frame to be frame 0 at proper position
console.log("\nAdding frames 2 & 3...");
const framesUpdate = await mcp("update_template", {
  id: tplId,
  frames: [
    { id: autoFrameId, name: "01 - Bienvenida", x: 0, y: 0, width: 1080, height: 1080, css: "", html: "", background: BG },
    { id: "f1_features", name: "02 - Features", x: 1080, y: 0, width: 1080, height: 1080, css: "", html: "", background: BG },
    { id: "f2_cta", name: "03 - CTA", x: 2160, y: 0, width: 1080, height: 1080, css: "", html: "", background: BG },
  ]
});
console.log("Frames updated:", framesUpdate.frames?.length || "?");

// Step 3: Set layers for each frame
console.log("\nSetting layers for Frame 1 (Bienvenida)...");
const r0 = await mcp("set_frame_layers", {
  templateId: tplId,
  frameId: autoFrameId,
  background: BG,
  fontImports: FONTS,
  layers: frame0Layers,
});
console.log("Frame 1 result:", r0._editability ? `valid=${r0._editability.valid} layers=${r0._editability.layerCount}` : "ok");

console.log("\nSetting layers for Frame 2 (Features)...");
const r1 = await mcp("set_frame_layers", {
  templateId: tplId,
  frameId: "f1_features",
  background: BG,
  fontImports: FONTS,
  layers: frame1Layers,
});
console.log("Frame 2 result:", r1._editability ? `valid=${r1._editability.valid} layers=${r1._editability.layerCount}` : "ok");

console.log("\nSetting layers for Frame 3 (CTA)...");
const r2 = await mcp("set_frame_layers", {
  templateId: tplId,
  frameId: "f2_cta",
  background: BG,
  fontImports: FONTS,
  layers: frame2Layers,
});
console.log("Frame 3 result:", r2._editability ? `valid=${r2._editability.valid} layers=${r2._editability.layerCount}` : "ok");

console.log("\n=== DONE ===");
console.log("Template ID:", tplId);
console.log("Editor URL: https://design.futuraria.com?template=" + tplId);
