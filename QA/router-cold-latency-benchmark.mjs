// Browser benchmark for the cold router path. Delays labels.json so the
// ONNX bootstrap remains pending; measures how long a user request waits.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = join(process.env.LOCALAPPDATA || "", "ms-playwright");
const installed = existsSync(root) ? readdirSync(root).find(name => name.startsWith("chromium_headless_shell-")) : null;
const candidates = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  chromium.executablePath(),
  installed ? join(root, installed, "chrome-headless-shell-win64", "chrome-headless-shell.exe") : null,
];
const executablePath = candidates.find(path => path && existsSync(path));
if (!executablePath) throw new Error("Install Playwright Chromium or set PLAYWRIGHT_CHROMIUM_PATH");
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/router/labels.json", () => new Promise(() => {}));
  await page.goto(process.env.MUSA_BENCH_URL || "http://127.0.0.1:5187/", { waitUntil: "domcontentloaded" });
  const waits = await page.evaluate(async () => {
    const router = await import("/src/lib/intentRouter.ts");
    const start = performance.now();
    const result = await router.routeIntent("Muéstrame mis plantillas");
    if (result.route !== "llm") throw new Error(`Unexpected route: ${result.route}`);
    const withLlmMs = performance.now() - start;
    const noKeyStart = performance.now();
    const noKey = await router.routeIntent("Muéstrame mis plantillas", { waitForCold: true });
    if (noKey.route !== "llm") throw new Error(`Unexpected cold fallback: ${noKey.route}`);
    return { withLlmMs, noKeyMs: performance.now() - noKeyStart };
  });
  console.log(JSON.stringify({ coldRouterWaitWithLlmMs: Math.round(waits.withLlmMs), coldRouterWaitWithoutKeyMs: Math.round(waits.noKeyMs) }));
} finally {
  await browser.close();
}
