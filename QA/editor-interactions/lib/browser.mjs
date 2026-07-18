/**
 * Locate a system Chrome/Edge and launch it via puppeteer-core.
 * puppeteer-core never downloads a browser — it drives the one already installed,
 * so the QA suite stays a light devDependency with no post-install browser fetch.
 */
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA || ""}\\Google\\Chrome\\Application\\chrome.exe`,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function resolveBrowserPath() {
  const found = CANDIDATES.filter(Boolean).find(p => existsSync(p));
  if (!found) {
    throw new Error(
      "No system Chrome/Edge found. Set CHROME_PATH to your browser executable.",
    );
  }
  return found;
}

export async function launchBrowser() {
  const executablePath = resolveBrowserPath();
  return puppeteer.launch({
    executablePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
    defaultViewport: { width: 1600, height: 1000 },
  });
}
