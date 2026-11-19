// Ping IndexNow (Bing, Brave, Yandex, Seznam) tras cada deploy.
// IndexNow avisa a los buscadores que alimentan ChatGPT search (Bing),
// Claude search (Brave) y Copilot (Bing) sin esperar su crawl.
//
// Uso (despues de un deploy a produccion):  npm run indexnow
//
// La clave vive en public/7a75748c44164de9f2f566a0893765d8.txt y debe ser
// reachable en https://musaworks.com/7a75748c44164de9f2f566a0893765d8.txt

const KEY = "7a75748c44164de9f2f566a0893765d8";
const HOST = "musaworks.com";

const URLS = [
  "https://musaworks.com/",
  "https://musaworks.com/agents/",
  "https://musaworks.com/faq/",
  "https://musaworks.com/preguntas/",
  "https://musaworks.com/guides/connect-agent-mcp/",
  "https://musaworks.com/compare/",
  "https://musaworks.com/comparar/",
  "https://musaworks.com/llms.txt",
  "https://musaworks.com/llms-full.txt",
  "https://musaworks.com/ai.txt",
  "https://musaworks.com/sitemap.xml",
];

const body = JSON.stringify({
  host: HOST,
  key: KEY,
  keyLocation: "https://" + HOST + "/" + KEY + ".txt",
  urlList: URLS,
});

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body,
});

console.log("IndexNow -> HTTP " + res.status + (res.status === 200 || res.status === 202 ? " OK" : " (revisa la key o las URLs)"));
if (res.status !== 200 && res.status !== 202) {
  console.log(await res.text().catch(() => ""));
  process.exitCode = 1;
}
