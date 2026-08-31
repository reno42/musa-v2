// ─── Core Types ───────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  ownerId: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

export interface Frame {
  id: string;
  templateId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  opacity?: number;
  parentFrameId?: string | null;
  order: number;
  objects: CanvasObject[];
  layoutMode: "NONE" | "HORIZONTAL" | "VERTICAL";
  clipsContent: boolean;
  constraints: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean; centerX?: boolean; centerY?: boolean; scale?: boolean };
  padding: { top: number; right: number; bottom: number; left: number };
  // HTML engine fields
  html?: string;
  css?: string;
  // Iterative change attribution
  contentHash?: string;
  lastModifiedBy?: string;
  lastModifiedAt?: string;
  // Concurrency control
  revision?: number;
}

export interface DesignTemplate {
  id: string;
  workspaceId: string;
  name: string;
  slug?: string;
  width: number;
  height: number;
  engine: "html";
  canvas: CanvasData | null;
  html?: string;
  css?: string;
  frames: Frame[];
  canvasObjects?: Array<{
    id: string;
    name: string;
    kind: string;
    frameId: null;
    html: string;
    css: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
  }>;
  styles: Style[];
  comments: Comment[];
  versions: Version[];
  variables: VariableStore;
  components: Component[];
  metadata: TemplateMetadata;
  brandId?: string;
  thumbnail?: string;
  tags?: string[];
  designArtifacts?: DesignArtifacts;
  /** When true, comments on this template default to type=documentation
   *  (usage explanations, not design feedback). The AI reads these as
   *  instructions. Part of REQ-007 Brand Manual. */
  isBrandManual?: boolean;
}

export interface Component {
  id: string;
  name: string;
  description: string;
  layers: any[];
  instances: string[];
  createdAt: string;
}

export interface CanvasData {
  version?: string;
  objects: CanvasObject[];
  background?: string;
  viewport: { x: number; y: number; zoom: number };
}

export type CanvasObject = {
  type: string;
  layerName?: string;
  layerId?: string;
  frameId?: string;
  name?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  rx?: number;
  ry?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  src?: string;
  path?: any[];
  objects?: CanvasObject[];
  [key: string]: any;
};

export interface Style {
  id: string;
  name: string;
  type: "fill" | "stroke" | "text" | "effect";
  properties: Record<string, any>;
}

export interface Comment {
  id: string;
  userId: string;
  text: string;
  x: number;
  y: number;
  resolved: boolean;
  createdAt: string;
}

export interface Version {
  id: string;
  templateId: string;
  label: string;
  canvas: CanvasData | null;  // null for V2 HTML templates (use html/css/frames instead)
  html?: string;
  css?: string;
  createdAt: string;
}

export interface VariableStore {
  collections: { id: string; name: string }[];
  variables: { id: string; collectionId: string; name: string; value: any }[];
  bindings: Record<string, any[]>;
}

export interface TemplateMetadata {
  createdAt: string;
  updatedAt: string;
  contentUpdatedAt?: string;
  createdBy?: string;
  designArtifactsGeneratedAt?: string;
  deletedAt?: string;
}

// ─── Brand Guidelines ─────────────────────────────────────

export interface DesignArtifacts {
  tokensJson: string;
  designMd: string;
  sharedCss: string;
  generatedFromHash: string;
  generatedAt: string;
}

export interface BrandGuideline {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  tokensJson?: string;
  designMd?: string;
  sharedCss?: string;
  sourceHash?: string;
  styleFingerprint?: string;
  sourceTemplateIds?: string[];
  createdAt: string;
  updatedAt: string;
  /** Template ID of the brand's Design System file (is_brand_manual=true).
   *  Created automatically when the brand is created. One brand = one DS file. */
  designSystemTemplateId?: string;
  /** CRM brand (brands.id) that owns this Design System. Linked by ID (not
   *  by name) since v35, which also enforces one live DS per brand. */
  crmBrandId?: string;
  /** Soft-delete timestamp. When set, the brand is in the trash. */
  deletedAt?: string;
}

// ─── Tool Types ───────────────────────────────────────────

export type ToolName =
  | "select" | "hand"
  | "rect" | "ellipse" | "line" | "triangle" | "star" | "polygon"
  | "frame"
  | "text" | "image"
  | "pencil" | "pen";

export type BooleanOperation = "union" | "subtract" | "intersect" | "exclude";

export type AlignDirection =
  | "left" | "center-h" | "right"
  | "top" | "center-v" | "bottom";

export type DistributeDirection = "horizontal" | "vertical";

export interface DrawShapePayload {
  tool: "rect" | "ellipse" | "line" | "triangle" | "star" | "polygon";
  x: number; y: number; width: number; height: number;
  fill?: string; stroke?: string; strokeWidth?: number;
  layerName?: string; frameId?: string;
}

export interface TextPayload {
  text: string; x: number; y: number;
  fontSize?: number; fontFamily?: string; fill?: string;
  layerName?: string; frameId?: string;
}

export interface ImagePayload {
  src: string; x: number; y: number;
  width?: number; height?: number;
  layerName?: string; frameId?: string;
}

export interface BooleanPayload {
  operation: BooleanOperation;
  targetLayerNames: string[];
  frameId?: string;
}

export interface AlignPayload {
  direction: AlignDirection;
  targetLayerNames?: string[];
  frameId?: string;
}

export interface DistributePayload {
  direction: DistributeDirection;
  targetLayerNames?: string[];
  frameId?: string;
}

export interface TransformPayload {
  targetLayerName: string;
  x?: number; y?: number; width?: number; height?: number;
  scaleX?: number; scaleY?: number; angle?: number;
  opacity?: number; visible?: boolean;
  frameId?: string;
}

export interface AutoLayoutPayload {
  targetLayerNames: string[];
  direction?: "horizontal" | "vertical";
  gap?: number; padding?: number;
  frameId?: string;
}

export interface LayerOverride {
  text?: string; fill?: string; stroke?: string;
  strokeWidth?: number; fontSize?: number; fontFamily?: string;
  opacity?: number; visible?: boolean; locked?: boolean;
  x?: number; y?: number; width?: number; height?: number;
  scaleX?: number; scaleY?: number; angle?: number;
  src?: string; rx?: number; ry?: number;
  [key: string]: any;
}

// ─── Webhook Types ────────────────────────────────────────

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  userId: string;
  active: boolean;
  createdAt: string;
}

// ─── Render Types ─────────────────────────────────────────

export type RenderFormat = "png" | "jpg" | "svg" | "json";
export type RenderStatus = "pending" | "processing" | "complete" | "failed";

export interface RenderJob {
  id: string;
  templateId: string;
  status: RenderStatus;
  format: RenderFormat;
  scale: number;
  url?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface RenderOptions {
  format?: RenderFormat;
  scale?: number;
  width?: number;
  height?: number;
}

// ─── Concurrency Types ─────────────────────────────────────

export interface SectionClaim {
  frameId: string;
  templateId: string;
  agentId: string;
  agentName: string;
  claimedAt: string;
  expiresAt: string;
}
