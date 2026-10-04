import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const bridgeDir = path.resolve(sourceDir, "..");
export const runtimeDir = path.join(bridgeDir, "runtime");

export const runtimePaths = {
  dashboard: path.join(runtimeDir, "dashboard-config.json"),
  mcps: path.join(runtimeDir, "mcp-servers.json"),
  skills: path.join(runtimeDir, "skills.json"),
  layout: path.join(runtimeDir, "builder-layout.json"),
  cronJobs: path.join(runtimeDir, "cron-jobs.json"),
  newsroom: path.join(runtimeDir, "newsroom-config.json"),
  newsroomFlows: path.join(runtimeDir, "newsroom-flows.json"),
  newsroomTemplates: path.join(runtimeDir, "newsroom-templates.json"),
  newsroomRuns: path.join(runtimeDir, "newsroom-runs.json"),
  capabilities: path.join(runtimeDir, "capabilities.json"),
  events: path.join(runtimeDir, "events.ndjson"),
  voiceInbox: path.join(runtimeDir, "voice-inbox.json"),
  skillHub: path.join(runtimeDir, "skill-hub.json"),
  printer: path.join(runtimeDir, "printer-config.json"),
  automationFlows: path.join(runtimeDir, "automation-flows.json"),
  automationFlowRuns: path.join(runtimeDir, "automation-flow-runs.json"),
};

export async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(fallback);
    throw error;
  }
}

const writeQueues = new Map();

export async function writeJson(filePath, value) {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await rename(temporary, filePath);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  });
  writeQueues.set(filePath, operation);
  try {
    await operation;
  } finally {
    if (writeQueues.get(filePath) === operation) writeQueues.delete(filePath);
  }
}

export const defaults = {
  dashboard: {
    disabledTools: [],
    toolBudget: 25,
    catalogBudgetBytes: 64_000,
    resultBudgetBytes: 30_000,
  },
  mcps: { servers: [] },
  skills: { customSkills: [] },
  layout: { order: { skills: [], tools: [], mcps: [] } },
  cronJobs: { jobs: [] },
  newsroom: {
    enabled: true,
    workspaceId: "ws_user_8e9f031817184e0ab205",
    maxItems: 5,
    design: { mode: "builtin", templateId: "", postFrameId: "", storyFrameId: "" },
    feeds: [
      { name: "El País", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", enabled: true },
      { name: "BBC Mundo", url: "https://feeds.bbci.co.uk/mundo/rss.xml", enabled: true },
      { name: "DW Español", url: "https://rss.dw.com/rdf/rss-sp-top", enabled: true },
    ],
    nodePositions: {},
  },
  newsroomRuns: { runs: [] },
  newsroomTemplates: { templates: [] },
  capabilities: {
    installedPacks: [
      "musa-style",
      "musa-templates",
      "documents",
      "internet",
      "automations",
      "browser-media",
      "rss",
      "zernio",
      "voice-relay",
      "epson-printer",
    ],
  },
  voiceInbox: { messages: [] },
  skillHub: {
    version: 2,
    agents: [
      { id: "mia", name: "Agumon", type: "xiaozhi-esp32", installedSkills: ["brand-discovery", "branded-post", "template-batchamator", "document-batches", "primary-school-exams", "musa-export", "device-diagnostics", "internet-youtube", "scheduled-jobs", "daily-newsroom", "browser-media", "rss-autoconnect", "zernio-social", "voice-relay"], roleIds: [], skillSources: {} },
      { id: "cyan", name: "Cyan", type: "ilands", installedSkills: [], roleIds: [], skillSources: {} },
      { id: "musa", name: "Agentes de Musa", type: "musa", installedSkills: [], roleIds: [], skillSources: {} },
      { id: "hermes", name: "Hermes", type: "hermes", installedSkills: [], roleIds: [], skillSources: {} },
    ],
    workflows: [],
  },
  printer: { root: path.join(process.env.USERPROFILE ?? "", "Documents", "Agumon", "Documentos"), printer: "" },
};

export const getDashboardConfig = () => readJson(runtimePaths.dashboard, defaults.dashboard);
export const getMcpConfig = () => readJson(runtimePaths.mcps, defaults.mcps);
export const getSkillConfig = () => readJson(runtimePaths.skills, defaults.skills);
export const getBuilderLayout = () => readJson(runtimePaths.layout, defaults.layout);
export const getCronJobs = () => readJson(runtimePaths.cronJobs, defaults.cronJobs);
export const getNewsroomConfig = () => readJson(runtimePaths.newsroom, defaults.newsroom);
export const getNewsroomTemplates = () => readJson(runtimePaths.newsroomTemplates, defaults.newsroomTemplates);
export const getNewsroomRuns = () => readJson(runtimePaths.newsroomRuns, defaults.newsroomRuns);
export const getCapabilityConfig = () => readJson(runtimePaths.capabilities, defaults.capabilities);
export const getVoiceInbox = () => readJson(runtimePaths.voiceInbox, defaults.voiceInbox);
export const getSkillHub = () => readJson(runtimePaths.skillHub, defaults.skillHub);
export const getPrinterConfig = () => readJson(runtimePaths.printer, defaults.printer);
