/**
 * Research (REQ-051) — constants shared by the harness, the UI and the AI
 * briefing. One source of truth for the networks and formats an encargo
 * can ask for, so the pane's toggles, the MCP validation and the briefing
 * text can never drift apart.
 *
 * Extensible by design: adding a network here makes it available to the
 * briefing copy automatically — the ResearchTab renders this list and the
 * worker validates against it.
 */

export interface ResearchNetworkMeta {
  id: string;
  label: string;
  /** How the copy should sound / how long it can be, in one line. */
  note: string;
}

export const RESEARCH_NETWORKS: readonly ResearchNetworkMeta[] = [
  { id: "linkedin", label: "LinkedIn", note: "profesional, hasta ~1.300 caracteres, sin lluvia de hashtags" },
  { id: "x", label: "X", note: "máximo 280 caracteres, directo, 0-2 hashtags" },
  { id: "instagram", label: "Instagram", note: "gancho en la primera línea, 3-5 hashtags al final" },
  { id: "facebook", label: "Facebook", note: "conversacional, puede ser más largo, link en el texto" },
  { id: "tiktok", label: "TikTok", note: "gancho cortísimo para portada/video, tono hablado" },
] as const;

export interface ResearchFormatMeta {
  id: string;
  label: string;
  /** Canvas size for the design pass (post 4:5, story 9:16). */
  width: number;
  height: number;
  note: string;
}

export const RESEARCH_FORMATS: readonly ResearchFormatMeta[] = [
  { id: "post", label: "Post", width: 1080, height: 1350, note: "una pieza única" },
  { id: "carrusel", label: "Carrusel", width: 1080, height: 1350, note: "portada + 4-7 slides, copy por página" },
  { id: "story", label: "Story", width: 1080, height: 1920, note: "secuencia de 1-3 stories con texto breve" },
] as const;

export const RESEARCH_NETWORK_IDS: readonly string[] = RESEARCH_NETWORKS.map(n => n.id);
export const RESEARCH_FORMAT_IDS: readonly string[] = RESEARCH_FORMATS.map(f => f.id);

export function isResearchNetwork(v: unknown): boolean {
  return typeof v === "string" && RESEARCH_NETWORK_IDS.includes(v);
}

export function isResearchFormat(v: unknown): boolean {
  return typeof v === "string" && RESEARCH_FORMAT_IDS.includes(v);
}
