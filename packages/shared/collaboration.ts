// packages/shared/collaboration.ts
// Re-exports collaboration types from index

export type {
  Comment,
  CommentReply,
  TemplateVersion,
  DesignTemplate,
  CursorPosition,
  UserPresence,
  CanvasDelta,
} from "./index";

export { USER_COLORS, assignUserColor } from "./index";
