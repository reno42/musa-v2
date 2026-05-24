// packages/shared/index.ts
// All shared types for Futuraria Design — consolidated from Sprint 3/4/5

// ═════════════════════════════════════════════════════════════════
// Prototype Types (Sprint 7)
// ═════════════════════════════════════════════════════════════════

export type PrototypeTrigger = "click" | "hover" | "press" | "drag" | "afterDelay";

export interface PrototypeAction {
  type: "navigate" | "openOverlay" | "closeOverlay" | "swapOverlay" | "changeTo";
  targetFrameId?: string;
  overlayPosition?: { x: number; y: number };
  delay?: number;
}

export type TransitionType = "instant" | "dissolve" | "moveIn" | "moveOut" | "push" | "slideIn";
export type TransitionDirection = "left" | "right" | "top" | "bottom";
export type EasingType = "linear" | "easeIn" | "easeOut" | "easeInOut";

export interface PrototypeTransition {
  type: TransitionType;
  direction?: TransitionDirection;
  duration: number;
  easing: EasingType;
}

export interface PrototypeInteraction {
  id: string;
  trigger: PrototypeTrigger;
  actions: PrototypeAction[];
  transition: PrototypeTransition;
}

export interface PrototypeFlow {
  id: string;
  name: string;
  startFrameId: string;
}

// ═════════════════════════════════════════════════════════════════
// Canvas & Base Types
// ═════════════════════════════════════════════════════════════════

export interface CanvasConfig {
  width: number;
  height: number;
  background: string;
  objects?: any[];
  viewport?: { zoom: number; x: number; y: number };
}

export type LayerType =
  | "rect"
  | "ellipse"
  | "text"
  | "textbox"
  | "i-text"
  | "image"
  | "group"
  | "path"
  | "line";

/**
 * Constraints system: controls how a child layer responds when its parent frame is resized.
 * - `true` ("fixed"): the child maintains a fixed distance from that edge.
 * - `"scale"`: the child's position/dimension scales proportionally from that edge.
 * - `centerX/centerY: true`: the child stays centered relative to the parent.
 * - No constraints → proportional move (default behavior).
 */
export interface LayoutConstraint {
  left?: boolean | "scale";
  right?: boolean | "scale";
  top?: boolean | "scale";
  bottom?: boolean | "scale";
  centerX?: boolean;
  centerY?: boolean;
}


// ─── Auto Layout Types ─────────────────────────────────────────

export type AutoLayoutDirection = "horizontal" | "vertical";
export type AutoLayoutAlignItems = "start" | "center" | "end" | "stretch";
export type ResizingMode = "hug" | "fill" | "fixed";

export interface AutoLayoutPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface AutoLayoutConfig {
  enabled: boolean;
  direction: AutoLayoutDirection;
  padding: AutoLayoutPadding;
  gap: number | "auto";
  alignItems: AutoLayoutAlignItems;
  wrap: boolean;
}

export interface BaseLayer {
  id: string;
  name: string;
  type: LayerType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  styleId?: string;
  constraints?: LayoutConstraint;
  interactions?: PrototypeInteraction[];
}

// ═════════════════════════════════════════════════════════════════
// Layer Types
// ═════════════════════════════════════════════════════════════════

export interface RectLayer extends BaseLayer {
  type: "rect";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
}

export interface EllipseLayer extends BaseLayer {
  type: "ellipse";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface TextLayer extends BaseLayer {
  type: "text" | "textbox" | "i-text";
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fill?: string;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  letterSpacing?: number;
}

export interface ImageLayer extends BaseLayer {
  type: "image";
  src: string;
  fit?: "cover" | "contain" | "fill" | "none";
  filters?: ImageFilters;
}

export interface GroupLayer extends BaseLayer {
  type: "group";
  children: Layer[];
}

export interface LineLayer extends BaseLayer {
  type: "line";
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  strokeLinecap?: "butt" | "round" | "square";
}

export interface PathLayer extends BaseLayer {
  type: "path";
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fillRule?: "nonzero" | "evenodd";
}

export interface SectionLayer {
  id: string;
  name: string;
  type: "section";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  collapsed: boolean;
}

export type Layer =
  | RectLayer
  | EllipseLayer
  | TextLayer
  | ImageLayer
  | GroupLayer
  | LineLayer
  | PathLayer
  | SectionLayer;

// ═════════════════════════════════════════════════════════════════
// Image Filters
// ═════════════════════════════════════════════════════════════════

export interface ImageFilters {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  grayscale?: boolean;
  sepia?: boolean;
}

// ═════════════════════════════════════════════════════════════════
// Layer Overrides (for n8n / API automation)
// ═════════════════════════════════════════════════════════════════

export interface LayerOverride {
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fill?: string;
  stroke?: string;
  imageUrl?: string;
  imageBase64?: string;
  visible?: boolean;
  opacity?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

// ═════════════════════════════════════════════════════════════════
// Template
// ═════════════════════════════════════════════════════════════════

export interface TemplateMetadata {
  createdAt: string;
  updatedAt: string;
}

// ═════════════════════════════════════════════════════════════════
// Variables / Design Tokens (Sprint 6)
// ═════════════════════════════════════════════════════════════════

export type VariableType = "color" | "number" | "string" | "boolean";

/** Scope restricts which layer properties a variable can be applied to. */
export type VariableScope =
  | "fill"
  | "stroke"
  | "fontSize"
  | "fontFamily"
  | "opacity"
  | "lineHeight"
  | "letterSpacing"
  | "cornerRadius"
  | "shadow"
  | "*"; // wildcard = all properties

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  /** Per-mode value map: { modeId → value }. If an alias, value is a variable reference id. */
  values: Record<string, string | number | boolean>;
  collectionId: string;
  /** If set, this variable is an alias that resolves to another variable. */
  aliasOf?: string;
  /** Optional scope restrictions. */
  scopes?: VariableScope[];
  createdAt: string;
  updatedAt: string;
}

export interface VariableCollection {
  id: string;
  name: string;
  modes: string[];
  defaultMode: string;
  createdAt: string;
  updatedAt: string;
}

// ═════════════════════════════════════════════════════════════════
// Branching (Sprint 8)
// ═════════════════════════════════════════════════════════════════

export interface Branch {
  id: string;
  name: string;
  templateId: string;
  parentBranchId?: string;
  createdAt: string;
  createdBy?: string;
}

export interface DesignTemplate {
  id: string;
  name: string;
  schemaVersion: number;
  canvas: CanvasConfig;
  layers: Layer[];
  variables?: Record<string, string>;
  variableCollections?: VariableCollection[];
  variableList?: Variable[];
  prototypeFlows?: PrototypeFlow[];
  branches?: Branch[];
  metadata: TemplateMetadata;
}

// ═════════════════════════════════════════════════════════════════
// Render Types
// ═════════════════════════════════════════════════════════════════

export interface RenderRequest {
  format?: "png" | "jpg" | "svg";
  scale?: number;
  quality?: number;
  width?: number;
  height?: number;
  overrides?: {
    layers?: Record<string, LayerOverride>;
    variables?: Record<string, string>;
  };
  webhookUrl?: string;
}

export interface RenderResponse {
  id: string;
  status: "completed" | "failed" | "processing";
  templateId: string;
  format: string;
  width?: number;
  height?: number;
  url?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

// ═════════════════════════════════════════════════════════════════
// Paginated Response
// ═════════════════════════════════════════════════════════════════

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// ═════════════════════════════════════════════════════════════════
// API Key Types
// ═════════════════════════════════════════════════════════════════

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  last_used_at: string | null;
  active: boolean;
  created_at: string;
}

export interface AuthContext {
  apiKeyId: string;
  userId: string;
  permissions: string[];
}

// ═════════════════════════════════════════════════════════════════
// Styles System (Sprint 3)
// ═════════════════════════════════════════════════════════════════

export interface StyleDefinition {
  id: string;
  name: string;
  type: "color" | "text" | "effect";
  fills?: Array<{ color: string; opacity: number }>;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  lineHeight?: number;
  letterSpacing?: number;
  effects?: Array<{
    type: "shadow" | "blur" | "glow";
    props: {
      color?: string;
      blur?: number;
      offsetX?: number;
      offsetY?: number;
      opacity?: number;
    };
  }>;
  metadata: {
    createdAt: string;
    updatedAt: string;
  };
}

export interface CreateStyleRequest {
  name: string;
  type: "color" | "text" | "effect";
  fills?: Array<{ color: string; opacity: number }>;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  lineHeight?: number;
  letterSpacing?: number;
  effects?: Array<{
    type: "shadow" | "blur" | "glow";
    props: Record<string, any>;
  }>;
}

export interface UpdateStyleRequest {
  name?: string;
  fills?: Array<{ color: string; opacity: number }>;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  lineHeight?: number;
  letterSpacing?: number;
  effects?: Array<{
    type: "shadow" | "blur" | "glow";
    props: Record<string, any>;
  }>;
}

// ═════════════════════════════════════════════════════════════════
// Component System (Sprint 3)
// ═════════════════════════════════════════════════════════════════

export type ComponentPropertyType =
  | "boolean"
  | "text"
  | "number"
  | "enum"
  | "color"
  | "instance_swap";

export interface ComponentProperty {
  id: string;
  name: string;
  type: ComponentPropertyType;
  defaultValue: any;
  options?: any[];
}

export interface ComponentDefinition {
  id: string;
  name: string;
  description?: string;
  properties: ComponentProperty[];
  defaultValues: Record<string, any>;
  canvas: CanvasConfig;
  layers: Layer[];
  metadata: {
    createdAt: string;
    updatedAt: string;
    tags?: string[];
  };
}

export interface ComponentInstance {
  componentId: string;
  overrides: Record<string, any>;
}

export interface CreateComponentPayload {
  name: string;
  description?: string;
  properties?: ComponentProperty[];
  canvas: CanvasConfig;
  layers: Layer[];
  tags?: string[];
}

export interface UpdateComponentPayload {
  name?: string;
  description?: string;
  properties?: ComponentProperty[];
  defaultValues?: Record<string, any>;
  canvas?: CanvasConfig;
  layers?: Layer[];
  tags?: string[];
}

// ═════════════════════════════════════════════════════════════════
// Comments (Sprint 5)
// ═════════════════════════════════════════════════════════════════

export interface Comment {
  id: string;
  templateId: string;
  frameId?: string;
  x: number;
  y: number;
  author: string;
  text: string;
  thread: CommentReply[];
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommentReply {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

// ═════════════════════════════════════════════════════════════════
// Version History (Sprint 5)
// ═════════════════════════════════════════════════════════════════

export interface TemplateVersion {
  id: string;
  templateId: string;
  versionNumber: number;
  data: DesignTemplate;
  author?: string;
  message?: string;
  createdAt: string;
}

// ═════════════════════════════════════════════════════════════════
// Boolean Operations (Sprint 6)
// ═════════════════════════════════════════════════════════════════

export type BooleanOperation = "union" | "subtract" | "intersect" | "exclude";

// ═════════════════════════════════════════════════════════════════
// Grid Styles (Feature)
// ═════════════════════════════════════════════════════════════════

export type GridStyleType = "columns" | "rows" | "grid";

export interface GridStyle {
  id: string;
  name: string;
  type: GridStyleType;
  count: number;
  gutter: number;
  margin: number;
  color: string;
  /** If true, the grid is visible on canvas. */
  visible?: boolean;
  metadata: {
    createdAt: string;
    updatedAt: string;
  };
}

export interface CreateGridStyleRequest {
  name: string;
  type: GridStyleType;
  count: number;
  gutter: number;
  margin: number;
  color: string;
}

export interface ImageFitMode {
  mode: "fill" | "fit" | "crop";
  offsetX: number;
  offsetY: number;
  scale: number;
}

// ═════════════════════════════════════════════════════════════════
// Multiplayer / Collaboration (Sprint 8)
// ═════════════════════════════════════════════════════════════════

export interface CursorPosition {
  userId: string;
  userName: string;
  x: number;
  y: number;
  color: string;
}

export interface UserPresence {
  userId: string;
  userName: string;
  color: string;
  cursor?: CursorPosition;
  lastSeen: number;
}

/** Broadcast payload for canvas object changes. */
export interface CanvasDelta {
  type: "object:modified" | "object:added" | "object:removed";
  objectId: string;
  /** For modified: partial properties. For added: full serialized object. For removed: just objectId. */
  payload?: Record<string, any>;
  userId: string;
  timestamp: number;
}

/** Predefined palette of 10 distinct user colors. */
export const USER_COLORS = [
  "#6366f1", // indigo
  "#22c55e", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#a855f7", // purple
] as const;

/** Assign a color to a user based on their index in the presence list. */
export function assignUserColor(userId: string, existingUsers: UserPresence[]): string {
  const usedColors = new Set(existingUsers.map((u) => u.color));
  // First try: use hash of userId for stable assignment
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const preferred = USER_COLORS[Math.abs(hash) % USER_COLORS.length];
  if (!usedColors.has(preferred)) return preferred;
  // Fallback: find first unused color
  for (const color of USER_COLORS) {
    if (!usedColors.has(color)) return color;
  }
  // All taken: cycle
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}
