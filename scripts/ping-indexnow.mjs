// Ping IndexNow (Bing, Brave, Yandex, Seznam) tras cada deploy.
// IndexNow avisa a los buscadores que alimentan ChatGPT search (Bing),
// Claude search (Brave) y Copilot (Bing) sin esperar su crawl.
//
// Uso (despues de un deploy a produccion):  npm run indexnow
//
// La clave vive en public/7a75748c44164de9f2f566a0893765d8.txt y debe ser
// reachable en https://design.futuraria.com/7a75748c44164de9f2f566a0893765d8.txt

const KEY = "7a75748c44164de9f2f566a0893765d8";
const HOST = "design.futuraria.com";

const URLS = [
  "https://design.futuraria.com/agents/",
  "https://design.futuraria.com/",
  "https://design.futuraria.com/llms.txt",
  "https://design.futuraria.com/SKILL.md",
  "https://design.futuraria.com/docs/why-agents-choose-musa.md",
  "https://design.futuraria.com/docs/musa-vs-generic-design-tools.md",
  "https://design.futuraria.com/docs/how-ai-agents-find-work.md",
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
