import { useRef, useState, useCallback } from "react";
import { Canvas, FabricObject, Rect, Ellipse, Line, Triangle, Polygon, IText, Point, Path, Group, StaticCanvas, FabricImage } from "fabric";

export type ToolName =
  | "select"
  | "hand"
  | "rect"
  | "ellipse"
  | "line"
  | "triangle"
  | "star"
  | "polygon"
  | "frame"
  | "text"
  | "image"
  | "pencil"
  | "pen"
  | "eyedropper";

const SNAP_HISTORY_LIMIT = 50;
const FRAME_MAX = 50;
const EXTRA_PROPS = ["layerId", "layerName", "frameId", "isFrameVisual", "isFrameLabel", "frameName", "frameFill", "frameStroke", "styleId", "isGridLine"];

function canvasToJSON(c: Canvas): any {
  return (c as any).toJSON(EXTRA_PROPS);
}

function objectToJSON(obj: FabricObject): any {
  return (obj as any).toJSON(EXTRA_PROPS);
}

function isMouseEvent(e: any): e is MouseEvent {
  return e && typeof e.button === "number";
}

export function useCanvas() {
  const canvasRef = useRef<Canvas | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tool, setToolState] = useState<ToolName>("select");
  const [zoom, setZoom] = useState(1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [selectedObjects, setSelectedObjects] = useState<FabricObject[]>([]);

  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const isUndoRedoRef = useRef(false);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const toolRef = useRef<ToolName>("select");
  const panningRef = useRef(false);
  const snapRef = useRef(false);
  const gridSizeRef = useRef(50);

  const pushHistory = useCallback(() => {
    const c = canvasRef.current;
    if (!c || isUndoRedoRef.current) return;
    const json = JSON.stringify(canvasToJSON(c));
    const stack = historyRef.current;
    while (stack.length - 1 > historyIndexRef.current) stack.pop();
    stack.push(json);
    if (stack.length > SNAP_HISTORY_LIMIT) stack.shift();
    historyIndexRef.current = stack.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    const c = canvasRef.current;
    if (!c || historyIndexRef.current <= 0) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current--;
    const json = historyRef.current[historyIndexRef.current];
    (c as any).loadFromJSON(JSON.parse(json), () => {
      c.requestRenderAll();
      isUndoRedoRef.current = false;
    });
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const redo = useCallback(() => {
    const c = canvasRef.current;
    if (!c || historyIndexRef.current >= historyRef.current.length - 1) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current++;
    const json = historyRef.current[historyIndexRef.current];
    (c as any).loadFromJSON(JSON.parse(json), () => {
      c.requestRenderAll();
      isUndoRedoRef.current = false;
    });
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  // --- Zoom ---
  const zoomIn = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const z = Math.min(c.getZoom() * 1.2, 5);
    (c as any).zoomToPoint(new Point(c.width! / 2, c.height! / 2), z);
    setZoom(z);
  }, []);

  const zoomOut = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const z = Math.max(c.getZoom() / 1.2, 0.1);
    (c as any).zoomToPoint(new Point(c.width! / 2, c.height! / 2), z);
    setZoom(z);
  }, []);

  const zoomToFit = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !containerRef.current) return;
    const objs = c.getObjects().filter((o: any) => !o.isGridLine && !o.isFrameLabel);
    if (objs.length === 0) { c.setZoom(1); setZoom(1); return; }
    const bounds = objs.reduce(
      (acc: any, o: any) => {
        const l = o.left || 0, t = o.top || 0;
        const w = (o.width || 0) * (o.scaleX || 1);
        const h = (o.height || 0) * (o.scaleY || 1);
        return {
          minX: Math.min(acc.minX, l), minY: Math.min(acc.minY, t),
          maxX: Math.max(acc.maxX, l + w), maxY: Math.max(acc.maxY, t + h),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    );
    const bw = bounds.maxX - bounds.minX, bh = bounds.maxY - bounds.minY;
    if (bw <= 0 || bh <= 0) { c.setZoom(1); setZoom(1); return; }
    const pad = 60;
    const zw = (containerRef.current.clientWidth - pad) / bw;
    const zh = (containerRef.current.clientHeight - pad) / bh;
    const z = Math.round(Math.min(zw, zh, 5) * 100) / 100;
    c.setZoom(z);
    const cx = bounds.minX + bw / 2, cy = bounds.minY + bh / 2;
    const vpt = c.viewportTransform!;
    vpt[4] = containerRef.current.clientWidth / 2 - cx * z;
    vpt[5] = containerRef.current.clientHeight / 2 - cy * z;
    c.requestRenderAll();
    setZoom(z);
  }, []);

  // --- Selection ---
  const updateSelection = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    setSelectedObjects([...c.getActiveObjects()]);
  }, []);

  // --- Export ---
  const exportPNG = useCallback(async (scale = 2): Promise<Blob> => {
    const c = canvasRef.current;
    if (!c) throw new Error("No canvas");
    const dataUrl = c.toDataURL({ format: "png", multiplier: scale });
    const res = await fetch(dataUrl);
    return res.blob();
  }, []);

  const exportSVG = useCallback((): string => {
    const c = canvasRef.current;
    if (!c) return "";
    return c.toSVG();
  }, []);

  const exportJSON = useCallback((): string => {
    const c = canvasRef.current;
    if (!c) return "{}";
    return JSON.stringify(canvasToJSON(c));
  }, []);

  // --- Tool setter ---
  const setTool = useCallback((t: ToolName) => {
    toolRef.current = t;
    setToolState(t);
    const c = canvasRef.current;
    if (!c) return;
    c.isDrawingMode = t === "pencil";
    c.selection = t === "select" || t === "hand";
    (c as any).defaultCursor = t === "hand" ? "grab" : "default";
  }, []);

  // --- Object creation helpers ---
  function makeLayerName(prefix: string): string {
    return `${prefix}_${Date.now() % 100000}`;
  }

  function createShape(t: string, x: number, y: number, w: number, h: number, sx: number, sy: number): FabricObject | null {
    const color = "#3B82F6";
    const name = makeLayerName(t);
    let obj: FabricObject | null = null;
    switch (t) {
      case "rect":
        obj = new Rect({ left: x, top: y, width: w, height: h, fill: color, rx: 4, ry: 4 });
        break;
      case "ellipse":
        obj = new Ellipse({ left: x, top: y, rx: w / 2, ry: h / 2, fill: color });
        break;
      case "line":
        obj = new Line([sx, sy, sx + w, sy + h], { stroke: color, strokeWidth: 2 });
        break;
      case "triangle":
        obj = new Triangle({ left: x, top: y, width: w, height: h, fill: color });
        break;
      case "star": {
        const cx = x + w / 2, cy = y + h / 2, or = Math.min(w, h) / 2, ir = or * 0.45;
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < 10; i++) {
          const angle = -Math.PI / 2 + (Math.PI / 5) * i;
          const r = i % 2 === 0 ? or : ir;
          pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
        }
        obj = new Polygon(pts, { fill: color, left: cx, top: cy, originX: "center", originY: "center" });
        break;
      }
      case "polygon": {
        const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < 6; i++) {
          pts.push({ x: cx + r * Math.cos(-Math.PI / 2 + (Math.PI / 3) * i), y: cy + r * Math.sin(-Math.PI / 2 + (Math.PI / 3) * i) });
        }
        obj = new Polygon(pts, { fill: color, left: cx, top: cy, originX: "center", originY: "center" });
        break;
      }
      case "frame": {
        const frameId = `frame_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        obj = new Rect({ left: x, top: y, width: w, height: h, fill: "#ffffff", stroke: "#6366f1", strokeWidth: 2, rx: 0, ry: 0 });
        (obj as any).isFrameVisual = true;
        (obj as any).frameId = frameId;
        (obj as any).frameName = `Frame ${Date.now() % 1000}`;
        (obj as any).frameFill = "#ffffff";
        (obj as any).frameStroke = "#6366f1";
        (obj as any).layerName = (obj as any).frameName;
        break;
      }
    }
    if (obj && !(obj as any).isFrameLabel) (obj as any).layerName = name;
    return obj;
  }

  // --- Init canvas (infinite, no fixed size) ---
  const initCanvas = useCallback((el: HTMLCanvasElement, container: HTMLDivElement, _width?: number, _height?: number) => {
    containerRef.current = container;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const c = new Canvas(el, {
      width: w, height: h,
      backgroundColor: "transparent",
      selection: true,
      preserveObjectStacking: true,
    });
    canvasRef.current = c;

    // Pan with hand tool or middle click
    let lastX = 0, lastY = 0;

    c.on("mouse:down", (opt) => {
      const e = opt.e as any;
      const currentTool = toolRef.current;

      if (currentTool === "hand" || (isMouseEvent(e) && e.button === 1)) {
        panningRef.current = true;
        c.selection = false;
        (c as any).defaultCursor = "grabbing";
        lastX = (e as MouseEvent).clientX;
        lastY = (e as MouseEvent).clientY;
        return;
      }

      if (currentTool === "eyedropper") {
        const pointer = (c as any).getScenePoint(e);
        const all = c.getObjects();
        for (let i = all.length - 1; i >= 0; i--) {
          const o = all[i] as any;
          if (o.containsPoint && o.containsPoint(pointer) && o.fill && typeof o.fill === "string") {
            (c as any).fire("canvas:eyedropper", { color: o.fill });
            break;
          }
        }
        return;
      }

      if (currentTool === "image") {
        const clickPoint = (c as any).getScenePoint(e);
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          const url = URL.createObjectURL(file);
          try {
            const img = await FabricImage.fromURL(url);
            img.set({ left: clickPoint.x, top: clickPoint.y });
            (img as any).layerName = makeLayerName("image");
            img.scaleToWidth(Math.min(img.width || 400, 400));
            c.add(img);
            c.setActiveObject(img);
            c.requestRenderAll();
            pushHistory();
          } catch { /* ignore */ }
          URL.revokeObjectURL(url);
        };
        input.click();
        return;
      }

      if (["rect", "ellipse", "line", "triangle", "star", "polygon", "frame"].includes(currentTool) && !panningRef.current) {
        // If clicking on an existing object, let Fabric handle selection/drag — don't start a new draw
        if (opt.target) return;
        const ptr = (c as any).getScenePoint(e);
        drawStartRef.current = { x: ptr.x, y: ptr.y };
      }
    });

    c.on("mouse:move", (opt) => {
      if (panningRef.current) {
        const e = opt.e as MouseEvent;
        const vpt = c.viewportTransform!;
        vpt[4] += e.clientX - lastX;
        vpt[5] += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        c.requestRenderAll();
      }
    });

    c.on("mouse:up", (opt) => {
      if (panningRef.current) {
        panningRef.current = false;
        (c as any).defaultCursor = "grab";
        if (toolRef.current === "select") c.selection = true;
        return;
      }

      // Text tool: single click adds text only on empty canvas (doesn't need drawStartRef)
      if (toolRef.current === "text") {
        // If clicking on an existing object, let Fabric handle it — don't add new text
        if (opt.target) return;
        const e = opt.e as any;
        const end = (c as any).getScenePoint(e);
        const text = new IText("Double-click to edit", {
          left: end.x, top: end.y,
          fontSize: 24, fontFamily: "Inter, sans-serif", fill: "#000000",
        });
        (text as any).layerName = makeLayerName("text");
        // Link to containing frame immediately
        const frames = c.getObjects().filter((o: any) => o.isFrameVisual);
        for (const f of frames) {
          const fb = f.getBoundingRect();
          if (end.x >= fb.left && end.x <= fb.left + fb.width && end.y >= fb.top && end.y <= fb.top + fb.height) {
            (text as any).frameId = (f as any).frameId;
            break;
          }
        }
        c.add(text);
        c.setActiveObject(text);
        text.enterEditing();
        c.requestRenderAll();
        pushHistory();
        return;
      }

      if (!drawStartRef.current) return;
      const currentTool = toolRef.current;
      const e = opt.e as any;
      const end = (c as any).getScenePoint(e);
      const start = drawStartRef.current;
      drawStartRef.current = null;

      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);
      if (w < 3 && h < 3) return;

      const obj = createShape(currentTool, x, y, w, h, start.x, start.y);
      if (obj) {
        c.add(obj);
        c.setActiveObject(obj);
        c.requestRenderAll();
        pushHistory();
      }
    });

    // Zoom with wheel
    c.on("mouse:wheel", (opt: any) => {
      const delta = opt.e.deltaY;
      let z = c.getZoom() * (0.999 ** delta);
      z = Math.min(Math.max(z, 0.1), 5);
      (c as any).zoomToPoint(new Point(opt.e.offsetX, opt.e.offsetY), z);
      setZoom(Math.round(z * 100) / 100);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    c.on("selection:created", updateSelection);
    c.on("selection:updated", updateSelection);
    c.on("selection:cleared", () => setSelectedObjects([]));
    c.on("object:modified", (opt: any) => {
      if (!isUndoRedoRef.current) {
        // Frame member sync: detect if object entered/exited a frame
        const obj = opt.target;
        if (obj && !(obj as any).isFrameVisual) {
          const frames = c.getObjects().filter((o: any) => o.isFrameVisual);
          let foundFrameId: string | null = null;
          for (const f of frames) {
            const fb = f.getBoundingRect();
            const ob = obj.getBoundingRect();
            // Check if object center is inside frame bounds
            const ocx = ob.left + ob.width / 2;
            const ocy = ob.top + ob.height / 2;
            if (ocx >= fb.left && ocx <= fb.left + fb.width && ocy >= fb.top && ocy <= fb.top + fb.height) {
              foundFrameId = (f as any).frameId;
              break;
            }
          }
          (obj as any).frameId = foundFrameId;
        }
        pushHistory();
      }
    });

    // Frame move: move contained children
    let frameMoveDelta = { x: 0, y: 0 };
    c.on("object:moving", (opt: any) => {
      const obj = opt.target;
      if ((obj as any).isFrameVisual) {
        const fid = (obj as any).frameId;
        if (!fid) return;
        const dx = (obj.left ?? 0) - (((obj as any)._prevLeft) ?? obj.left ?? 0);
        const dy = (obj.top ?? 0) - (((obj as any)._prevTop) ?? obj.top ?? 0);
        (obj as any)._prevLeft = obj.left;
        (obj as any)._prevTop = obj.top;
        if (dx === 0 && dy === 0) return;
        // Move all children
        const children = c.getObjects().filter((o: any) => o.frameId === fid && !o.isFrameVisual);
        for (const child of children) {
          child.set({ left: (child.left ?? 0) + dx, top: (child.top ?? 0) + dy });
          child.setCoords();
        }
      }
    });

    // Snap-to-grid on moving
    c.on("object:moving", (opt: any) => {
      if (!snapRef.current) return;
      const obj = opt.target;
      const step = gridSizeRef.current;
      if (obj.left !== undefined) obj.left = Math.round(obj.left / step) * step;
      if (obj.top !== undefined) obj.top = Math.round(obj.top / step) * step;
    });

    // Pen tool: click to add points (bezier)
    const penPoints: { x: number; y: number }[] = [];
    let penPreview: any = null;
    c.on("mouse:down", (opt) => {
      if (toolRef.current !== "pen") return;
      // If clicking on an existing object, let Fabric handle it
      if (opt.target) return;
      const e = opt.e as any;
      const ptr = (c as any).getScenePoint(e);
      penPoints.push({ x: ptr.x, y: ptr.y });
      if (penPoints.length >= 3) {
        if (penPreview) c.remove(penPreview);
        const pathStr = `M ${penPoints[0].x} ${penPoints[0].y} ` +
          penPoints.slice(1).map((p, i) => {
            const prev = penPoints[i];
            const cpx = (prev.x + p.x) / 2;
            const cpy = (prev.y + p.y) / 2;
            return `Q ${prev.x} ${prev.y} ${cpx} ${cpy}`;
          }).join(" ") + ` L ${penPoints[penPoints.length - 1].x} ${penPoints[penPoints.length - 1].y}`;
        penPreview = new Path(pathStr, {
          fill: "transparent", stroke: "#3B82F6", strokeWidth: 2,
          selectable: false, evented: false,
        });
        c.add(penPreview);
        c.requestRenderAll();
      }
    });

    // Double-click finishes pen path
    c.on("mouse:dblclick", () => {
      if (toolRef.current !== "pen" || penPoints.length < 2) return;
      if (penPreview) c.remove(penPreview);
      const pathStr = `M ${penPoints[0].x} ${penPoints[0].y} ` +
        penPoints.slice(1).map((p, i) => {
          const prev = penPoints[i];
          return `L ${p.x} ${p.y}`;
        }).join(" ");
      const pathObj = new Path(pathStr, {
        fill: "transparent", stroke: "#3B82F6", strokeWidth: 2,
      });
      (pathObj as any).layerName = makeLayerName("pen");
      c.add(pathObj);
      penPoints.length = 0;
      c.requestRenderAll();
      pushHistory();
    });

    pushHistory();
    return c;
  }, [pushHistory, updateSelection]);

  const loadTemplate = useCallback((json: any) => {
    const c = canvasRef.current;
    if (!c) return;
    isUndoRedoRef.current = true;
    c.clear();
    historyRef.current = [];
    historyIndexRef.current = -1;
    (c as any).loadFromJSON(json, () => {
      c.requestRenderAll();
      isUndoRedoRef.current = false;
      historyRef.current = [JSON.stringify(json)];
      historyIndexRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
    });
  }, []);

  // Group / Ungroup
  const group = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const sel = c.getActiveObjects();
    if (sel.length < 2) return;
    const grp = new Group(sel as any, {});
    (grp as any).layerName = makeLayerName("group");
    c.remove(...sel);
    c.add(grp);
    c.setActiveObject(grp);
    c.requestRenderAll();
    pushHistory();
  }, [pushHistory]);

  const ungroup = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const sel = c.getActiveObject();
    if (!sel || !(sel as any).isGroup) return;
    const items = (sel as any).removeAll();
    c.remove(sel);
    c.add(...items);
    c.discardActiveObject();
    c.requestRenderAll();
    pushHistory();
  }, [pushHistory]);

  const deleteSelected = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const sel = c.getActiveObjects();
    if (sel.length === 0) return;
    c.remove(...sel);
    c.discardActiveObject();
    c.requestRenderAll();
    pushHistory();
  }, [pushHistory]);

  const copySelected = useCallback((): any => {
    const c = canvasRef.current;
    if (!c) return null;
    const sel = c.getActiveObject();
    if (!sel) return null;
    return objectToJSON(sel);
  }, []);

  const pasteObject = useCallback((json: any) => {
    const c = canvasRef.current;
    if (!c || !json) return;
    FabricObject.fromObject(json).then((cloned: any) => {
      cloned.set({ left: (cloned.left || 0) + 20, top: (cloned.top || 0) + 20 });
      (cloned as any).layerName = `${(json as any).layerName || "copy"}_paste`;
      c.add(cloned);
      c.setActiveObject(cloned);
      c.requestRenderAll();
      pushHistory();
    });
  }, [pushHistory]);

  const duplicateSelected = useCallback(() => {
    const json = copySelected();
    if (json) pasteObject(json);
  }, [copySelected, pasteObject]);

  const showGrid = useCallback((show: boolean) => {
    const c = canvasRef.current;
    if (!c) return;
    const existing = c.getObjects().filter((o: any) => o.isGridLine);
    for (const g of existing) c.remove(g);
    if (!show) { c.requestRenderAll(); return; }
    const step = gridSizeRef.current;
    const w = c.width || 1080, h = c.height || 1080;
    for (let x = 0; x <= w; x += step) {
      const line = new Line([x, 0, x, h], { stroke: "#d0d0d0", strokeWidth: 0.5, selectable: false, evented: false });
      (line as any).isGridLine = true;
      c.add(line);
    }
    for (let y = 0; y <= h; y += step) {
      const line = new Line([0, y, w, y], { stroke: "#d0d0d0", strokeWidth: 0.5, selectable: false, evented: false });
      (line as any).isGridLine = true;
      c.add(line);
    }
    c.requestRenderAll();
  }, []);

  const toggleSnap = useCallback((enabled: boolean) => {
    snapRef.current = enabled;
  }, []);

  const setGridSize = useCallback((size: number) => {
    gridSizeRef.current = size;
  }, []);

  // Snap helper
  function snapToGrid(value: number): number {
    if (!snapRef.current) return value;
    const step = gridSizeRef.current;
    const snapped = Math.round(value / step) * step;
    return Math.abs(snapped - value) < step / 2 ? snapped : value;
  }

  const getCanvasJSON = useCallback((): any => {
    const c = canvasRef.current;
    if (!c) return { objects: [], viewport: { x: 0, y: 0, zoom: 1 } };
    return {
      ...canvasToJSON(c),
      viewport: { x: c.viewportTransform![4], y: c.viewportTransform![5], zoom: c.getZoom() },
    };
  }, []);

  const toggleLock = useCallback((layerName: string) => {
    const c = canvasRef.current;
    if (!c) return;
    const obj = c.getObjects().find((o: any) => o.layerName === layerName || o.name === layerName);
    if (!obj) return;
    const locked = !obj.lockMovementX;
    obj.set({
      lockMovementX: locked, lockMovementY: locked,
      lockRotation: locked, lockScalingX: locked, lockScalingY: locked,
      selectable: !locked, evented: !locked,
    } as any);
    c.requestRenderAll();
  }, []);

  // --- Align ---
  type AlignDir = "left" | "center-h" | "right" | "top" | "center-v" | "bottom";

  const align = useCallback((direction: AlignDir) => {
    const c = canvasRef.current;
    if (!c) return;
    const sel = c.getActiveObjects();
    if (sel.length < 2) return;

    const bounds = sel.reduce(
      (acc: any, o: any) => {
        const l = o.left ?? 0, t = o.top ?? 0;
        const w = (o.width ?? 0) * (o.scaleX ?? 1);
        const h = (o.height ?? 0) * (o.scaleY ?? 1);
        return {
          minX: Math.min(acc.minX, l), minY: Math.min(acc.minY, t),
          maxX: Math.max(acc.maxX, l + w), maxY: Math.max(acc.maxY, t + h),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    );

    for (const obj of sel as any[]) {
      const w = (obj.width ?? 0) * (obj.scaleX ?? 1);
      const h = (obj.height ?? 0) * (obj.scaleY ?? 1);
      switch (direction) {
        case "left": obj.set("left", bounds.minX); break;
        case "right": obj.set("left", bounds.maxX - w); break;
        case "center-h": obj.set("left", (bounds.minX + bounds.maxX) / 2 - w / 2); break;
        case "top": obj.set("top", bounds.minY); break;
        case "bottom": obj.set("top", bounds.maxY - h); break;
        case "center-v": obj.set("top", (bounds.minY + bounds.maxY) / 2 - h / 2); break;
      }
      obj.setCoords();
    }
    c.requestRenderAll();
    pushHistory();
  }, [pushHistory]);

  // --- Distribute ---
  const distribute = useCallback((direction: "horizontal" | "vertical") => {
    const c = canvasRef.current;
    if (!c) return;
    const sel = c.getActiveObjects();
    if (sel.length < 3) return;

    if (direction === "horizontal") {
      sel.sort((a: any, b: any) => (a.left ?? 0) - (b.left ?? 0));
      const first = sel[0] as any;
      const last = sel[sel.length - 1] as any;
      const totalW = sel.reduce((s: number, o: any) => s + (o.width ?? 0) * (o.scaleX ?? 1), 0);
      const firstLeft = first.left ?? 0;
      const lastRight = (last.left ?? 0) + (last.width ?? 0) * (last.scaleX ?? 1);
      const gap = sel.length > 1 ? (lastRight - firstLeft - totalW) / (sel.length - 1) : 0;
      let x = firstLeft;
      for (const obj of sel as any[]) {
        obj.set("left", x);
        x += (obj.width ?? 0) * (obj.scaleX ?? 1) + gap;
        obj.setCoords();
      }
    } else {
      sel.sort((a: any, b: any) => (a.top ?? 0) - (b.top ?? 0));
      const first = sel[0] as any;
      const last = sel[sel.length - 1] as any;
      const totalH = sel.reduce((s: number, o: any) => s + (o.height ?? 0) * (o.scaleY ?? 1), 0);
      const firstTop = first.top ?? 0;
      const lastBottom = (last.top ?? 0) + (last.height ?? 0) * (last.scaleY ?? 1);
      const gap = sel.length > 1 ? (lastBottom - firstTop - totalH) / (sel.length - 1) : 0;
      let y = firstTop;
      for (const obj of sel as any[]) {
        obj.set("top", y);
        y += (obj.height ?? 0) * (obj.scaleY ?? 1) + gap;
        obj.setCoords();
      }
    }
    c.requestRenderAll();
    pushHistory();
  }, [pushHistory]);

  // --- Boolean Operations (simplified: groups objects) ---
  const booleanOp = useCallback((operation: string) => {
    const c = canvasRef.current;
    if (!c) return;
    const sel = c.getActiveObjects();
    if (sel.length < 2) return;
    const grp = new Group(sel as any, {});
    (grp as any).layerName = makeLayerName(`bool_${operation}`);
    (grp as any).booleanOperation = operation;
    c.remove(...sel);
    c.add(grp);
    c.setActiveObject(grp);
    c.requestRenderAll();
    pushHistory();
  }, [pushHistory]);

  // --- Auto Layout ---
  const autoLayout = useCallback((direction: "horizontal" | "vertical" = "horizontal", gap = 16) => {
    const c = canvasRef.current;
    if (!c) return;
    const sel = c.getActiveObjects();
    if (sel.length < 2) return;

    const sorted = [...sel] as any[];
    if (direction === "horizontal") {
      sorted.sort((a, b) => (a.left ?? 0) - (b.left ?? 0));
      let x = sorted[0].left ?? 0;
      for (const obj of sorted) {
        obj.set("left", x);
        x += (obj.width ?? 0) * (obj.scaleX ?? 1) + gap;
        obj.setCoords();
      }
    } else {
      sorted.sort((a, b) => (a.top ?? 0) - (b.top ?? 0));
      let y = sorted[0].top ?? 0;
      for (const obj of sorted) {
        obj.set("top", y);
        y += (obj.height ?? 0) * (obj.scaleY ?? 1) + gap;
        obj.setCoords();
      }
    }
    c.requestRenderAll();
    pushHistory();
  }, [pushHistory]);

  // --- Frame Management ---

  const getFrames = useCallback((): any[] => {
    const c = canvasRef.current;
    if (!c) return [];
    return c.getObjects().filter((o: any) => o.isFrameVisual);
  }, []);

  const getFrameCount = useCallback((): number => {
    const c = canvasRef.current;
    if (!c) return 0;
    return c.getObjects().filter((o: any) => o.isFrameVisual).length;
  }, []);

  const getFrameObjects = useCallback((frameId: string): FabricObject[] => {
    const c = canvasRef.current;
    if (!c) return [];
    return c.getObjects().filter((o: any) => o.frameId === frameId && !o.isFrameVisual);
  }, []);

  const getFreeObjects = useCallback((): FabricObject[] => {
    const c = canvasRef.current;
    if (!c) return [];
    return c.getObjects().filter((o: any) => !o.frameId && !o.isFrameVisual && !o.isGridLine);
  }, []);

  const createFrame = useCallback((name: string, x: number, y: number, w: number, h: number) => {
    const c = canvasRef.current;
    if (!c) return null;
    const count = c.getObjects().filter((o: any) => o.isFrameVisual).length;
    if (count >= FRAME_MAX) return null;
    const frameId = `frame_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const frame = new Rect({
      left: x, top: y, width: w, height: h,
      fill: "#ffffff", stroke: "#6366f1", strokeWidth: 2, rx: 0, ry: 0,
    });
    (frame as any).isFrameVisual = true;
    (frame as any).frameId = frameId;
    (frame as any).frameName = name || `Frame ${count + 1}`;
    (frame as any).frameFill = "#ffffff";
    (frame as any).frameStroke = "#6366f1";
    (frame as any).layerName = (frame as any).frameName;
    c.add(frame);
    c.setActiveObject(frame);
    c.requestRenderAll();
    pushHistory();
    return frame;
  }, [pushHistory]);

  const deleteFrame = useCallback((frameId: string) => {
    const c = canvasRef.current;
    if (!c) return;
    const frame = c.getObjects().find((o: any) => o.frameId === frameId);
    if (!frame) return;
    // Remove frame and all its children
    const children = c.getObjects().filter((o: any) => o.frameId === frameId && !o.isFrameVisual);
    c.remove(frame, ...children);
    c.discardActiveObject();
    c.requestRenderAll();
    pushHistory();
  }, [pushHistory]);

  const renameFrame = useCallback((frameId: string, name: string) => {
    const c = canvasRef.current;
    if (!c) return;
    const frame = c.getObjects().find((o: any) => o.frameId === frameId);
    if (!frame) return;
    (frame as any).frameName = name;
    (frame as any).layerName = name;
    c.requestRenderAll();
  }, []);

  const moveObjectToFrame = useCallback((objectId: string, frameId: string | null) => {
    const c = canvasRef.current;
    if (!c) return;
    const obj = c.getObjects().find((o: any) => o.layerName === objectId || o.name === objectId);
    if (!obj || (obj as any).isFrameVisual) return;
    (obj as any).frameId = frameId;
    c.requestRenderAll();
    pushHistory();
  }, [pushHistory]);

  // --- Frame-Scoped Export ---

  const exportFramePNG = useCallback(async (frameId: string, scale = 2): Promise<Blob | null> => {
    const c = canvasRef.current;
    if (!c) return null;
    const frame = c.getObjects().find((o: any) => o.frameId === frameId && o.isFrameVisual);
    if (!frame) return null;
    const children = c.getObjects().filter((o: any) => o.frameId === frameId && !o.isFrameVisual);
    if (children.length === 0) return null;

    // Create temp canvas sized to frame
    const fw = (frame.width ?? 0) * (frame.scaleX ?? 1);
    const fh = (frame.height ?? 0) * (frame.scaleY ?? 1);
    const sc = new StaticCanvas(document.createElement("canvas"), {
      width: fw * scale, height: fh * scale,
      backgroundColor: (frame as any).frameFill || "#ffffff",
    });
    sc.setZoom(scale);

    // Clone children with relative positions
    const clones: any[] = [];
    const fl = frame.left ?? 0, ft = frame.top ?? 0;
    for (const obj of children) {
      const json = (obj as any).toJSON(EXTRA_PROPS);
      if (!json) continue;
      const clone = await FabricObject.fromObject(json);
      clone.set({
        left: (obj.left ?? 0) - fl,
        top: (obj.top ?? 0) - ft,
      });
      clones.push(clone);
    }
    sc.add(...clones);
    sc.requestRenderAll();

    const dataUrl = sc.toDataURL({ format: "png", multiplier: 1 });
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    sc.dispose();
    return blob;
  }, []);

  const exportAllFramesPNG = useCallback(async (): Promise<{ name: string; blob: Blob }[]> => {
    const c = canvasRef.current;
    if (!c) return [];
    const frames = c.getObjects().filter((o: any) => o.isFrameVisual);
    const results: { name: string; blob: Blob }[] = [];
    for (const frame of frames) {
      const fid = (frame as any).frameId;
      const blob = await exportFramePNG(fid);
      if (blob) {
        results.push({ name: (frame as any).frameName || fid, blob });
      }
    }
    return results;
  }, [exportFramePNG]);

  return {
    canvasRef, containerRef,
    tool, setTool, zoom, zoomIn, zoomOut, zoomToFit,
    canUndo, canRedo, undo, redo,
    selectedObjects,
    initCanvas, loadTemplate, getCanvasJSON,
    exportPNG, exportSVG, exportJSON,
    group, ungroup, deleteSelected, copySelected, pasteObject, duplicateSelected,
    toggleLock, showGrid, toggleSnap, setGridSize, pushHistory,
    align, distribute, booleanOp, autoLayout,
    // Frame management
    getFrames, getFrameCount, getFrameObjects, getFreeObjects,
    createFrame, deleteFrame, renameFrame, moveObjectToFrame,
    // Frame-scoped export
    exportFramePNG, exportAllFramesPNG,
    FRAME_MAX,
  };
}
