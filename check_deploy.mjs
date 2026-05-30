const res = await fetch("https://bejewelled-llama-a6719d.netlify.app/");
const html = await res.text();
const m = html.match(/assets\/index-[^"]+\.js/);
console.log("Deployed JS:", m?.[0]);

// Check if the deployed JS contains our new components
const jsRes = await fetch(`https://bejewelled-llama-a6719d.netlify.app/${m[0]}`);
const js = await jsRes.text();
const checks = ["GoogleFontPicker", "GradientEditor", "ShadowEditor", "charSpacing", "underline"];
for (const c of checks) {
  console.log(`  ${js.includes(c) ? "✅" : "❌"} ${c}`);
}
