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
  canvasObjects?: any[];
  /** Preview thumbnail: Storage public URL (preferred) or legacy base64 data URL */
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
