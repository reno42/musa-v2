// ─── HTML/CSS Template Types ────────────────────────────────

/** Template metadata shared between frontend and API */
export interface TemplateMetadata {
  createdAt: string;
  updatedAt: string;
  [key: string]: any;
}

/** HTML/CSS design template */
export interface HtmlTemplate {
  id: string;
  workspaceId: string;
  name: string;
  width: number;
  height: number;
  engine: "html";
  html?: string;
  css?: string;
  frames?: any[];
  /** Base64 data URL of a rendered preview thumbnail */
  thumbnail?: string;
  metadata: TemplateMetadata;
}

/** Payload for creating an HTML template */
export interface HtmlTemplateCreatePayload {
  name: string;
  workspaceId: string;
  width?: number;
  height?: number;
  initialHtml?: string;
  initialCss?: string;
}
