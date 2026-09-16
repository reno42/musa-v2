import type { Request, Response, NextFunction } from "express";
import { ZodSchema, z } from "zod";

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

// ─── Schemas ───────────────────────────────────────────

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

export const addMemberSchema = z.object({ userId: z.string().min(1) });

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  width: z.number().int().min(1).max(10000).optional(),
  height: z.number().int().min(1).max(10000).optional(),
  canvas: z.any().optional(),
  workspaceId: z.string().min(1),
  engine: z.enum(["html"]).optional(),
  html: z.string().optional(),
  css: z.string().optional(),
  // REQ-022: false → create the file with ZERO frames (the caller adds the
  // first frame at exact dimensions). Default behavior is unchanged.
  initialFrame: z.boolean().optional(),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  width: z.number().int().min(1).max(10000).optional(),
  height: z.number().int().min(1).max(10000).optional(),
  metadata: z.object({ updatedAt: z.string().optional() }).optional(),
  engine: z.enum(["html"]).optional(),
  html: z.string().optional(),
  css: z.string().optional(),
  frames: z.array(z.any()).optional(),
  canvasObjects: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.string().min(1),
    frameId: z.null(),
    html: z.string(),
    css: z.string(),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    zIndex: z.number(),
  }).passthrough()).optional(),
  thumbnail: z.string().optional(),
  // Video Mode v2: template-level timeline state (audio placement, etc.).
  // Normalized client-side (videoTimelineDoc.ts) — validated loosely here so
  // future fields don't need a server deploy.
  videoTimeline: z.any().optional(),
});

export const duplicateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
});

export const createFrameSchema = z.object({
  name: z.string().min(1).max(200),
  x: z.number().int(), y: z.number().int(),
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(10000),
  fill: z.string().optional(),
});

export const updateFrameSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  x: z.number().int().optional(), y: z.number().int().optional(),
  width: z.number().int().min(1).optional(),
  height: z.number().int().min(1).optional(),
  fill: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  order: z.number().int().min(0).optional(),
});

export const drawShapeSchema = z.object({
  tool: z.enum(["rect", "ellipse", "line", "triangle", "star", "polygon"]),
  x: z.number(), y: z.number(),
  width: z.number().min(1), height: z.number().min(1),
  fill: z.string().optional(), stroke: z.string().optional(),
  strokeWidth: z.number().min(0).optional(),
  layerName: z.string().optional(), frameId: z.string().optional(),
});

export const textSchema = z.object({
  text: z.string(), x: z.number(), y: z.number(),
  fontSize: z.number().min(1).max(1000).optional(),
  fontFamily: z.string().optional(), fill: z.string().optional(),
  layerName: z.string().optional(), frameId: z.string().optional(),
});

export const imageSchema = z.object({
  src: z.string().url(), x: z.number(), y: z.number(),
  width: z.number().min(1).optional(), height: z.number().min(1).optional(),
  layerName: z.string().optional(), frameId: z.string().optional(),
});

export const booleanSchema = z.object({
  operation: z.enum(["union", "subtract", "intersect", "exclude"]),
  targetLayerNames: z.array(z.string()).min(2),
  frameId: z.string().optional(),
});

export const alignSchema = z.object({
  direction: z.enum(["left", "center-h", "right", "top", "center-v", "bottom"]),
  targetLayerNames: z.array(z.string()).optional(),
  frameId: z.string().optional(),
});

export const distributeSchema = z.object({
  direction: z.enum(["horizontal", "vertical"]),
  targetLayerNames: z.array(z.string()).optional(),
  frameId: z.string().optional(),
});

export const transformSchema = z.object({
  targetLayerName: z.string().min(1),
  x: z.number().optional(), y: z.number().optional(),
  width: z.number().min(1).optional(), height: z.number().min(1).optional(),
  scaleX: z.number().min(0).optional(), scaleY: z.number().min(0).optional(),
  angle: z.number().optional(), opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(), frameId: z.string().optional(),
});

export const autoLayoutSchema = z.object({
  targetLayerNames: z.array(z.string()).min(1),
  direction: z.enum(["horizontal", "vertical"]).optional(),
  gap: z.number().int().min(0).optional(),
  padding: z.number().int().min(0).optional(),
  frameId: z.string().optional(),
});

export const layerOverrideSchema = z.record(z.string(), z.any());

export const renderSchema = z.object({
  format: z.enum(["png", "jpg", "svg", "json"]).optional(),
  scale: z.number().min(1).max(4).optional(),
  width: z.number().int().min(1).optional(),
  height: z.number().int().min(1).optional(),
});

export const webhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().optional(),
});
