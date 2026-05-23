import { useState, useEffect, useCallback } from "react";
import type { RefObject } from "react";
import * as fabric from "fabric";
import type { LayoutConstraint } from "@futuraria/shared";
import type { GridStyle, ImageFitMode } from "@futuraria/shared";

const GOOGLE_FONTS = [
  "Inter", "Roboto", "Open Sans", "Montserrat", "Poppins", "Lato",
  "Oswald", "Raleway", "Nunito", "Merriweather", "Playfair Display",
  "Source Sans 3", "Ubuntu", "DM Sans", "Space Grotesk", "JetBrains Mono",
  "Fira Code", "Archivo", "Manrope", "Outfit", "Sora", "Plus Jakarta Sans",
  "Bebas Neue", "Anton", "Lobster", "Dancing Script", "Pacifico",
];

const BLEND_MODES = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light",
  "difference", "exclusion", "hue", "saturation", "color", "luminosity",
];

interface ImageFilters {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  grayscale?: boolean;
  sepia?: boolean;
}

interface Props {
  selectedObj: fabric.FabricObject | null;
  fabricRef: RefObject<fabric.Canvas | null>;
  onLayerUpdate: () => void;
  variableBindings?: Record<string, string>;
  onDropVariable?: (variableId: string, property: string) => void;
  onUnbindVariable?: (property: string) => void;
  // Grid Styles
  gridStyles?: GridStyle[];
  activeGridStyleId?: string | null;
  onApplyGridStyle?: (styleId: string) => void;
  onRemoveGridStyle?: () => void;
  // Image Fit Mode
  onSetImageFitMode?: (layerId: string, fitMode: ImageFitMode) => void;
  currentImageFitMode?: ImageFitMode;
}

export function PropertiesPanel({ selectedObj, fabricRef, onLayerUpdate, variableBindings, onDropVariable, onUnbindVariable, gridStyles, activeGridStyleId, onApplyGridStyle, onRemoveGridStyle, onSetImageFitMode, currentImageFitMode }: Props) {
  const [, tick] = useState(0);
  const force = () => tick((n) => n + 1);
  const [fontsLoaded, setFontsLoaded] = useState<Set<string>>(new Set());

  const loadFont = useCallback((fontName: string) => {
    if (fontsLoaded.has(fontName)) return;
    const link = document.createElement("link");
    link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, "+")}&display=swap`;
    link.rel = "stylesheet";
    document.head.appendChild(link);
    setFontsLoaded((prev) => new Set(prev).add(fontName));
  }, [fontsLoaded]);

  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;
    const h = () => force();
    c.on("object:modified", h);
    c.on("selection:updated", h);
    c.on("selection:created", h);
    c.on("selection:cleared", h);
    return () => {
      c.off("object:modified", h);
      c.off("selection:updated", h);
      c.off("selection:created", h);
      c.off("selection:cleared", h);
    };
  }, [fabricRef]);

  const set = useCallback((key: string, val: any) => {
    if (!selectedObj) return;
    selectedObj.set(key, val);
    fabricRef.current?.renderAll();
    onLayerUpdate();
    force();
  }, [selectedObj, fabricRef, onLayerUpdate]);

  const setShadow = useCallback((prop: string, val: any) => {
    if (!selectedObj) return;
    const s = selectedObj.shadow || new fabric.Shadow({ color: "rgba(0,0,0,0.3)", blur: 0, offsetX: 0, offsetY: 0 });
    (s as any)[prop] = val;
    selectedObj.set("shadow", s);
    fabricRef.current?.renderAll();
    onLayerUpdate();
    force();
  }, [selectedObj, fabricRef, onLayerUpdate]);

  const setImageFilter = useCallback((key: keyof ImageFilters, value: number | boolean) => {
    if (!selectedObj || selectedObj.type !== "image") return;
    const img = selectedObj as fabric.FabricImage;
    const currentFilters: ImageFilters = (img as any).imageFilters || {};
    const updatedFilters: ImageFilters = { ...currentFilters, [key]: value };
    (img as any).imageFilters = updatedFilters;
    const fabricFilters: any[] = [];
    if (updatedFilters.brightness && updatedFilters.brightness !== 0) fabricFilters.push(new fabric.filters.Brightness({ brightness: updatedFilters.brightness }));
    if (updatedFilters.contrast && updatedFilters.contrast !== 0) fabricFilters.push(new fabric.filters.Contrast({ contrast: updatedFilters.contrast }));
    if (updatedFilters.saturation && updatedFilters.saturation !== 0) fabricFilters.push(new fabric.filters.Saturation({ saturation: updatedFilters.saturation }));
    if (updatedFilters.blur && updatedFilters.blur > 0) fabricFilters.push(new fabric.filters.Blur({ blur: updatedFilters.blur }));
    if (updatedFilters.grayscale) fabricFilters.push(new fabric.filters.Grayscale());
    if (updatedFilters.sepia) fabricFilters.push(new fabric.filters.Sepia());
    img.filters = fabricFilters;
    img.applyFilters();
    fabricRef.current?.renderAll();
    onLayerUpdate();
    force();
  }, [selectedObj, fabricRef, onLayerUpdate]);

  const resetFilters = useCallback(() => {
    if (!selectedObj || selectedObj.type !== "image") return;
    const img = selectedObj as fabric.FabricImage;
    (img as any).imageFilters = {};
    img.filters = [];
    img.applyFilters();
    fabricRef.current?.renderAll();
    onLayerUpdate();
    force();
  }, [selectedObj, fabricRef, onLayerUpdate]);

  if (!selectedObj) {
    return (
      <div className="properties-panel">
        <div className="sidebar-header">Properties</div>
        <div className="empty-state">Select an element to<br />edit its properties</div>
      </div>
    );
  }

  const obj = selectedObj;
  const isText = obj.type === "textbox" || obj.type === "i-text";
  const isShape = obj.type === "rect" || obj.type === "ellipse";
  const isPath = obj.type === "path";
  const isLine = obj.type === "line";
  const isImage = obj.type === "image";
  const isClosedPath = isPath && (obj as any).isClosedPath;
  const isFrameBg = !!(obj as any).isFrameBg;
  const shadow = obj.shadow as any;
  const imageFilters: ImageFilters = isImage ? ((obj as any).imageFilters || {}) : {};

  return (
    <div className="properties-panel">
      <div className="sidebar-header">
        <span>Properties</span>
        <span className="obj-type">{isFrameBg ? "frame" : obj.type}{isClosedPath ? " (closed)" : isPath ? " (open)" : ""}</span>
      </div>

      {/* ─── Layer Name ──────────────────────────────────────────── */}
      <Section title={isFrameBg ? "Frame" : "Layer"}>
        <Row>
          <Label>name</Label>
          <input className="prop-input" value={(obj as any).layerName || ""} onChange={(e) => { (obj as any).layerName = e.target.value; onLayerUpdate(); force(); }} />
        </Row>
      </Section>

      {/* ─── Position ────────────────────────────────────────────── */}
      <Section title="Position">
        <div className="grid-2x2">
          <InputGroup label="X" value={Math.round(obj.left || 0)} onChange={(v) => set("left", v)} />
          <InputGroup label="Y" value={Math.round(obj.top || 0)} onChange={(v) => set("top", v)} />
        </div>
        <Row>
          <Label>rotation</Label>
          <input className="prop-input prop-input-sm" type="number" value={Math.round(obj.angle || 0)} onChange={(e) => set("angle", Number(e.target.value))} />
          <span className="range-label">°</span>
        </Row>
      </Section>

      {/* ─── Layout ──────────────────────────────────────────────── */}
      <Section title="Layout">
        <div className="grid-2x2">
          <InputGroup label="W" value={Math.round((obj.width || 0) * (obj.scaleX || 1))} onChange={(v) => set("scaleX", v / (obj.width || 1))} />
          <InputGroup label="H" value={Math.round((obj.height || 0) * (obj.scaleY || 1))} onChange={(v) => set("scaleY", v / (obj.height || 1))} />
        </div>
        <Row>
          <Label>scale</Label>
          <input className="prop-input prop-input-sm" type="number" step={0.01} value={Number((obj.scaleX || 1).toFixed(2))} onChange={(e) => { const v = Number(e.target.value); set("scaleX", v); set("scaleY", v); }} />
          <Label style={{ width: 20 }}>X</Label>
          <input className="prop-input prop-input-sm" type="number" step={0.01} value={Number((obj.scaleX || 1).toFixed(2))} onChange={(e) => set("scaleX", Number(e.target.value))} />
          <Label style={{ width: 20 }}>Y</Label>
          <input className="prop-input prop-input-sm" type="number" step={0.01} value={Number((obj.scaleY || 1).toFixed(2))} onChange={(e) => set("scaleY", Number(e.target.value))} />
        </Row>
        <Row>
          <Label>skew</Label>
          <Label style={{ width: 20 }}>X</Label>
          <input className="prop-input prop-input-sm" type="number" value={obj.skewX || 0} onChange={(e) => set("skewX", Number(e.target.value))} />
          <Label style={{ width: 20 }}>Y</Label>
          <input className="prop-input prop-input-sm" type="number" value={obj.skewY || 0} onChange={(e) => set("skewY", Number(e.target.value))} />
        </Row>
        <Row>
          <label className="checkbox-row"><input type="checkbox" checked={obj.flipX || false} onChange={(e) => set("flipX", e.target.checked)} /><span>Flip H</span></label>
          <label className="checkbox-row"><input type="checkbox" checked={obj.flipY || false} onChange={(e) => set("flipY", e.target.checked)} /><span>Flip V</span></label>
        </Row>
      </Section>

      {/* ─── Auto Layout (frame/group) ───────────────────────────── */}
      {(isFrameBg || obj.type === "group") && (
        <Section title="Auto Layout">
          <Row>
            <Label>enabled</Label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={!!(obj as any).autoLayout?.enabled}
                onChange={(e) => {
                  const cur = (obj as any).autoLayout || {
                    enabled: false, direction: "horizontal",
                    padding: { top: 10, right: 10, bottom: 10, left: 10 },
                    gap: 10, alignItems: "start", wrap: false,
                  };
                  (obj as any).autoLayout = { ...cur, enabled: e.target.checked };
                  onLayerUpdate(); force();
                }}
              />
              <span>Enable</span>
            </label>
          </Row>

          {(obj as any).autoLayout?.enabled && (
            <>
              <Row>
                <Label>direction</Label>
                <div className="btn-group">
                  <button className={`align-btn ${(obj as any).autoLayout?.direction === "horizontal" ? "active" : ""}`}
                    onClick={() => { (obj as any).autoLayout = { ...(obj as any).autoLayout, direction: "horizontal" }; onLayerUpdate(); force(); }} title="Horizontal">↔</button>
                  <button className={`align-btn ${(obj as any).autoLayout?.direction === "vertical" ? "active" : ""}`}
                    onClick={() => { (obj as any).autoLayout = { ...(obj as any).autoLayout, direction: "vertical" }; onLayerUpdate(); force(); }} title="Vertical">↕</button>
                </div>
              </Row>
              <Row>
                <Label>gap</Label>
                <input className="prop-input prop-input-sm" type="number" min={0}
                  value={typeof (obj as any).autoLayout?.gap === "number" ? (obj as any).autoLayout.gap : 10}
                  onChange={(e) => { (obj as any).autoLayout = { ...(obj as any).autoLayout, gap: Number(e.target.value) }; onLayerUpdate(); force(); }} />
                <button className={`align-btn ${((obj as any).autoLayout?.gap === "auto") ? "active" : ""}`}
                  onClick={() => { const g = (obj as any).autoLayout?.gap; (obj as any).autoLayout = { ...(obj as any).autoLayout, gap: g === "auto" ? 10 : "auto" }; onLayerUpdate(); force(); }}
                  title="Auto gap">Auto</button>
              </Row>
              <Row>
                <Label>padding</Label>
                <div className="grid-2x2" style={{ gap: 4 }}>
                  <InputGroup label="T" value={(obj as any).autoLayout?.padding?.top ?? 10}
                    onChange={(v) => { const p = { ...((obj as any).autoLayout?.padding || {}), top: v }; (obj as any).autoLayout = { ...(obj as any).autoLayout, padding: p }; onLayerUpdate(); force(); }} />
                  <InputGroup label="R" value={(obj as any).autoLayout?.padding?.right ?? 10}
                    onChange={(v) => { const p = { ...((obj as any).autoLayout?.padding || {}), right: v }; (obj as any).autoLayout = { ...(obj as any).autoLayout, padding: p }; onLayerUpdate(); force(); }} />
                  <InputGroup label="B" value={(obj as any).autoLayout?.padding?.bottom ?? 10}
                    onChange={(v) => { const p = { ...((obj as any).autoLayout?.padding || {}), bottom: v }; (obj as any).autoLayout = { ...(obj as any).autoLayout, padding: p }; onLayerUpdate(); force(); }} />
                  <InputGroup label="L" value={(obj as any).autoLayout?.padding?.left ?? 10}
                    onChange={(v) => { const p = { ...((obj as any).autoLayout?.padding || {}), left: v }; (obj as any).autoLayout = { ...(obj as any).autoLayout, padding: p }; onLayerUpdate(); force(); }} />
                </div>
              </Row>
              <Row>
                <Label>align</Label>
                <div className="btn-group">
                  {(["start", "center", "end", "stretch"] as const).map((a) => (
                    <button key={a} className={`align-btn ${(obj as any).autoLayout?.alignItems === a ? "active" : ""}`}
                      onClick={() => { (obj as any).autoLayout = { ...(obj as any).autoLayout, alignItems: a }; onLayerUpdate(); force(); }}
                      title={a}>{a === "start" ? "⊤" : a === "center" ? "⊟" : a === "end" ? "⊥" : "⊞"}</button>
                  ))}
                </div>
              </Row>
              <Row>
                <Label>wrap</Label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={!!(obj as any).autoLayout?.wrap}
                    onChange={(e) => { (obj as any).autoLayout = { ...(obj as any).autoLayout, wrap: e.target.checked }; onLayerUpdate(); force(); }} />
                  <span>Wrap</span>
                </label>
              </Row>
              <Row>
                <Label>sizing</Label>
                <div className="btn-group">
                  {(["hug", "fixed"] as const).map((m) => (
                    <button key={m} className={`align-btn ${((obj as any).resizingMode || "hug") === m ? "active" : ""}`}
                      onClick={() => { (obj as any).resizingMode = m; onLayerUpdate(); force(); }}
                      title={m === "hug" ? "Hug contents" : "Fixed size"}>{m === "hug" ? "🔸" : "🔹"}</button>
                  ))}
                </div>
              </Row>
            </>
          )}
        </Section>
      )}

      {/* ─── Child Resizing ──────────────────────────────────────── */}
      {(obj as any).autoLayout?.enabled && (
        <Section title="Resizing">
          <Row>
            <Label>mode</Label>
            <div className="btn-group">
              {(["hug", "fill", "fixed"] as const).map((m) => (
                <button key={m} className={`align-btn ${((obj as any).resizingMode || "fixed") === m ? "active" : ""}`}
                  onClick={() => { (obj as any).resizingMode = m; onLayerUpdate(); force(); }}
                  title={m}>{m}</button>
              ))}
            </div>
          </Row>
        </Section>
      )}

      {/* ─── Appearance ──────────────────────────────────────────── */}
      <Section title="Appearance">
        <Row>
          <Label>opacity</Label>
          <input className="prop-range" type="range" min={0} max={1} step={0.01} value={obj.opacity ?? 1} onChange={(e) => set("opacity", Number(e.target.value))} />
          <span className="range-val">{Math.round((obj.opacity ?? 1) * 100)}%</span>
        </Row>
        <Row>
          <Label>blend</Label>
          <select className="prop-select" value={(obj as any).globalCompositeOperation || "normal"}
            onChange={(e) => { (obj as any).globalCompositeOperation = e.target.value; fabricRef.current?.renderAll(); force(); }}>
            {BLEND_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Row>
        <Row>
          <Label>visible</Label>
          <label className="checkbox-row">
            <input type="checkbox" checked={obj.visible !== false} onChange={(e) => set("visible", e.target.checked)} />
            <span>{obj.visible !== false ? "Yes" : "No"}</span>
          </label>
        </Row>
        <Row>
          <Label>locked</Label>
          <label className="checkbox-row">
            <input type="checkbox" checked={obj.selectable === false} onChange={(e) => { obj.set("selectable", !e.target.checked); obj.set("evented", !e.target.checked); fabricRef.current?.renderAll(); force(); }} />
            <span>{obj.selectable === false ? "Yes" : "No"}</span>
          </label>
        </Row>
        {isFrameBg && (
          <Row>
            <Label>clip</Label>
            <label className="checkbox-row">
              <input type="checkbox" checked={(obj as any).clipsContent !== false} onChange={(e) => set("clipsContent", e.target.checked)} />
              <span>Clip to frame</span>
            </label>
          </Row>
        )}
      </Section>

      {/* ─── Fill ────────────────────────────────────────────────── */}
      <VariableBoundRow property="fill" label="Fill" bindings={variableBindings} onDropVariable={onDropVariable} onUnbindVariable={onUnbindVariable}>
        <Section title="Fill">
          {(isShape || isText || isClosedPath || isFrameBg) ? (
            <div className="prop-color-preview">
              <div className="color-swatch" style={{ background: (obj.fill as string) || "#000" }}>
                <input type="color" value={rgbToHex(obj.fill as string)} onChange={(e) => set("fill", e.target.value)} />
              </div>
              <input className="prop-input" value={rgbToHex(obj.fill as string).replace("#", "").toUpperCase()} onChange={(e) => set("fill", `#${e.target.value}`)} style={{ fontWeight: "bold" }} />
            </div>
          ) : (
            <div className="empty-state-sm">No fill</div>
          )}
        </Section>
      </VariableBoundRow>

      {/* ─── Stroke ──────────────────────────────────────────────── */}
      {(isShape || isPath || isLine) && (
        <VariableBoundRow property="stroke" label="Stroke" bindings={variableBindings} onDropVariable={onDropVariable} onUnbindVariable={onUnbindVariable}>
          <Section title="Stroke">
            <div className="prop-color-preview">
              <div className="color-swatch" style={{ background: (obj.stroke as string) || "#000" }}>
                <input type="color" value={rgbToHex(obj.stroke as string || "#000000")} onChange={(e) => set("stroke", e.target.value)} />
              </div>
              <input className="prop-input" value={rgbToHex(obj.stroke as string || "#000000").replace("#", "").toUpperCase()} onChange={(e) => set("stroke", `#${e.target.value}`)} />
            </div>
            <Row>
              <Label>width</Label>
              <input className="prop-range" type="range" min={0} max={30} step={0.5} value={obj.strokeWidth || 0} onChange={(e) => set("strokeWidth", Number(e.target.value))} />
              <span className="range-val">{obj.strokeWidth || 0}px</span>
            </Row>
            <Row>
              <Label>cap</Label>
              <select className="prop-select" value={(obj as any).strokeLineCap || "butt"} onChange={(e) => set("strokeLineCap", e.target.value)}>
                <option value="butt">Butt</option><option value="round">Round</option><option value="square">Square</option>
              </select>
            </Row>
            <Row>
              <Label>join</Label>
              <select className="prop-select" value={(obj as any).strokeLineJoin || "miter"} onChange={(e) => set("strokeLineJoin", e.target.value)}>
                <option value="miter">Miter</option><option value="round">Round</option><option value="bevel">Bevel</option>
              </select>
            </Row>
          </Section>
        </VariableBoundRow>
      )}

      {/* ─── Corner Radius ───────────────────────────────────────── */}
      {isShape && obj.type === "rect" && (
        <Section title="Corner Radius">
          <Row>
            <Label>radius</Label>
            <input className="prop-range" type="range" min={0} max={200} value={(obj as any).rx || 0}
              onChange={(e) => { const v = Number(e.target.value); obj.set("rx", v); obj.set("ry", v); fabricRef.current?.renderAll(); force(); }} />
            <span className="range-val">{(obj as any).rx || 0}</span>
          </Row>
        </Section>
      )}

      {/* ─── Effects: Shadow ─────────────────────────────────────── */}
      <Section title="Effects">
        <div className="prop-color-preview">
          <div className="color-swatch" style={{ background: shadow?.color || "rgba(0,0,0,0)" }}>
            <input type="color" value="#000000" onChange={(e) => setShadow("color", e.target.value)} />
          </div>
          <input className="prop-input" value={shadow?.color || ""} onChange={(e) => setShadow("color", e.target.value)} placeholder="rgba(0,0,0,0.3)" />
        </div>
        <Row>
          <Label>blur</Label>
          <input className="prop-range" type="range" min={0} max={100} step={1} value={shadow?.blur || 0} onChange={(e) => setShadow("blur", Number(e.target.value))} />
          <span className="range-val">{shadow?.blur || 0}</span>
        </Row>
        <Row>
          <Label>offset</Label>
          <Label style={{ width: 20 }}>X</Label>
          <input className="prop-input prop-input-sm" type="number" value={shadow?.offsetX || 0} onChange={(e) => setShadow("offsetX", Number(e.target.value))} />
          <Label style={{ width: 20 }}>Y</Label>
          <input className="prop-input prop-input-sm" type="number" value={shadow?.offsetY || 0} onChange={(e) => setShadow("offsetY", Number(e.target.value))} />
        </Row>
      </Section>

      {/* ─── Constraints ─────────────────────────────────────────── */}
      {!isFrameBg && (obj as any).frameId && (
        <Section title="Constraints">
          <ConstraintsEditor
            constraints={(obj as any).constraints || {}}
            onChange={(c) => { (obj as any).constraints = c; fabricRef.current?.renderAll(); onLayerUpdate(); force(); }}
          />
        </Section>
      )}

      {/* ─── Image Filters ───────────────────────────────────────── */}
      {isImage && (
        <Section title="Image Filters">
          <Row><Label>brightness</Label>
            <input className="prop-range" type="range" min={-1} max={1} step={0.01} value={imageFilters.brightness ?? 0} onChange={(e) => setImageFilter("brightness", Number(e.target.value))} />
            <span className="range-val">{(imageFilters.brightness ?? 0).toFixed(2)}</span>
          </Row>
          <Row><Label>contrast</Label>
            <input className="prop-range" type="range" min={-1} max={1} step={0.01} value={imageFilters.contrast ?? 0} onChange={(e) => setImageFilter("contrast", Number(e.target.value))} />
            <span className="range-val">{(imageFilters.contrast ?? 0).toFixed(2)}</span>
          </Row>
          <Row><Label>saturation</Label>
            <input className="prop-range" type="range" min={-1} max={1} step={0.01} value={imageFilters.saturation ?? 0} onChange={(e) => setImageFilter("saturation", Number(e.target.value))} />
            <span className="range-val">{(imageFilters.saturation ?? 0).toFixed(2)}</span>
          </Row>
          <Row><Label>blur</Label>
            <input className="prop-range" type="range" min={0} max={10} step={0.1} value={imageFilters.blur ?? 0} onChange={(e) => setImageFilter("blur", Number(e.target.value))} />
            <span className="range-val">{(imageFilters.blur ?? 0).toFixed(1)}</span>
          </Row>
          <Row>
            <div className="btn-group">
              <button className={`filter-toggle-btn ${imageFilters.grayscale ? "active" : ""}`} onClick={() => setImageFilter("grayscale", !imageFilters.grayscale)}>Grayscale</button>
              <button className={`filter-toggle-btn ${imageFilters.sepia ? "active" : ""}`} onClick={() => setImageFilter("sepia", !imageFilters.sepia)}>Sepia</button>
            </div>
          </Row>
          <Row><button className="filter-reset-btn" onClick={resetFilters}>Reset Filters</button></Row>
        </Section>
      )}

      {/* ─── Image Fit / Crop / Fill ──────────────────────────────── */}
      {isImage && onSetImageFitMode && (
        <Section title="Image Fit">
          <Row>
            <Label>mode</Label>
            <div className="btn-group">
              {(["fill", "fit", "crop"] as const).map((m) => (
                <button
                  key={m}
                  className={`align-btn ${currentImageFitMode?.mode === m ? "active" : ""}`}
                  onClick={() => {
                    const layerId = (obj as any).layerId;
                    if (!layerId) return;
                    const fitMode: ImageFitMode = {
                      mode: m,
                      offsetX: currentImageFitMode?.offsetX || 0,
                      offsetY: currentImageFitMode?.offsetY || 0,
                      scale: currentImageFitMode?.scale || 1,
                    };
                    onSetImageFitMode(layerId, fitMode);
                    force();
                  }}
                  title={m === "fill" ? "Fill: covers container" : m === "fit" ? "Fit: entire image visible" : "Crop: manual control"}
                >
                  {m === "fill" ? "▣" : m === "fit" ? "▢" : "⬒"} {m}
                </button>
              ))}
            </div>
          </Row>

          {/* Crop mode controls */}
          {currentImageFitMode?.mode === "crop" && (
            <>
              <Row>
                <Label>offset X</Label>
                <input
                  className="prop-input prop-input-sm"
                  type="number"
                  value={currentImageFitMode?.offsetX || 0}
                  onChange={(e) => {
                    const layerId = (obj as any).layerId;
                    if (!layerId || !onSetImageFitMode) return;
                    onSetImageFitMode(layerId, {
                      ...currentImageFitMode!,
                      offsetX: Number(e.target.value),
                    });
                    force();
                  }}
                />
                <Label style={{ width: 20 }}>Y</Label>
                <input
                  className="prop-input prop-input-sm"
                  type="number"
                  value={currentImageFitMode?.offsetY || 0}
                  onChange={(e) => {
                    const layerId = (obj as any).layerId;
                    if (!layerId || !onSetImageFitMode) return;
                    onSetImageFitMode(layerId, {
                      ...currentImageFitMode!,
                      offsetY: Number(e.target.value),
                    });
                    force();
                  }}
                />
              </Row>
              <Row>
                <Label>scale</Label>
                <input
                  className="prop-range"
                  type="range"
                  min={0.1}
                  max={5}
                  step={0.01}
                  value={currentImageFitMode?.scale || 1}
                  onChange={(e) => {
                    const layerId = (obj as any).layerId;
                    if (!layerId || !onSetImageFitMode) return;
                    onSetImageFitMode(layerId, {
                      ...currentImageFitMode!,
                      scale: Number(e.target.value),
                    });
                    force();
                  }}
                />
                <span className="range-val">{((currentImageFitMode?.scale || 1) * 100).toFixed(0)}%</span>
              </Row>
            </>
          )}
        </Section>
      )}

      {/* ─── Grid Style (for frames) ────────────────────────────────── */}
      {isFrameBg && gridStyles && gridStyles.length > 0 && (
        <Section title="Grid Style">
          <Row>
            <Label>style</Label>
            <select
              className="prop-select"
              value={activeGridStyleId || ""}
              onChange={(e) => {
                if (e.target.value && onApplyGridStyle) {
                  onApplyGridStyle(e.target.value);
                } else if (onRemoveGridStyle) {
                  onRemoveGridStyle();
                }
                force();
              }}
            >
              <option value="">None</option>
              {gridStyles.map((gs) => (
                <option key={gs.id} value={gs.id}>
                  {gs.name} ({gs.type}: {gs.count})
                </option>
              ))}
            </select>
          </Row>
          {activeGridStyleId && (
            <Row>
              <button
                className="filter-reset-btn"
                onClick={() => {
                  if (onRemoveGridStyle) onRemoveGridStyle();
                  force();
                }}
              >
                Remove Grid
              </button>
            </Row>
          )}
        </Section>
      )}

      {/* ─── Typography ──────────────────────────────────────────── */}
      {isText && (
        <Section title="Typography">
          <Row><Label>text</Label><textarea className="prop-textarea" value={(obj as any).text || ""} onChange={(e) => set("text", e.target.value)} /></Row>
          <Row>
            <Label>font</Label>
            <select className="prop-select" value={(obj as any).fontFamily || "Inter, sans-serif"}
              onChange={(e) => { loadFont(e.target.value.split(",")[0].trim()); set("fontFamily", e.target.value); }}>
              {GOOGLE_FONTS.map((f) => <option key={f} value={`${f}, sans-serif`}>{f}</option>)}
            </select>
          </Row>
          <Row>
            <Label>size</Label>
            <input className="prop-input prop-input-sm" type="number" value={(obj as any).fontSize || 16} onChange={(e) => set("fontSize", Number(e.target.value))} />
            <Label style={{ width: 30 }}>wt</Label>
            <select className="prop-select" value={String((obj as any).fontWeight || "normal")} onChange={(e) => set("fontWeight", e.target.value)}>
              <option value="100">Thin</option><option value="300">Light</option><option value="normal">Regular</option>
              <option value="500">Medium</option><option value="600">Semi</option><option value="bold">Bold</option><option value="900">Black</option>
            </select>
          </Row>
          <Row><Label>line height</Label><input className="prop-input prop-input-sm" type="number" step={0.1} value={(obj as any).lineHeight || 1.16} onChange={(e) => set("lineHeight", Number(e.target.value))} /></Row>
          <Row><Label>letter sp</Label><input className="prop-input prop-input-sm" type="number" value={(obj as any).charSpacing || 0} onChange={(e) => set("charSpacing", Number(e.target.value))} /><span className="range-label">px/1000</span></Row>
          <Row>
            <Label>align</Label>
            <div className="btn-group">
              {(["left", "center", "right", "justify"] as const).map((a) => (
                <button key={a} className={`align-btn ${(obj as any).textAlign === a ? "active" : ""}`} onClick={() => set("textAlign", a)}>
                  {a === "left" ? "≡←" : a === "center" ? "≡↔" : a === "right" ? "≡→" : "≡☰"}
                </button>
              ))}
            </div>
          </Row>
          <Row>
            <Label>style</Label>
            <div className="btn-group">
              <button className={`align-btn ${(obj as any).fontWeight === "bold" ? "active" : ""}`} onClick={() => set("fontWeight", (obj as any).fontWeight === "bold" ? "normal" : "bold")}>B</button>
              <button className={`align-btn ${(obj as any).fontStyle === "italic" ? "active" : ""}`} onClick={() => set("fontStyle", (obj as any).fontStyle === "italic" ? "normal" : "italic")}>I</button>
              <button className={`align-btn ${(obj as any).underline ? "active" : ""}`} onClick={() => set("underline", !(obj as any).underline)}>U</button>
              <button className={`align-btn ${(obj as any).linethrough ? "active" : ""}`} onClick={() => set("linethrough", !(obj as any).linethrough)}>S</button>
              <button className={`align-btn ${(obj as any).textTransform === "uppercase" ? "active" : ""}`} onClick={() => {
                if ((obj as any).textTransform === "uppercase") { obj.set("text", (obj as any)._originalText || (obj as any).text); (obj as any).textTransform = ""; }
                else { (obj as any)._originalText = (obj as any).text; obj.set("text", ((obj as any).text || "").toUpperCase()); (obj as any).textTransform = "uppercase"; }
                force();
              }}>AA</button>
            </div>
          </Row>
        </Section>
      )}
    </div>
  );
}

// ─── Variable Bound Row (drop zone) ──────────────────────────────

function VariableBoundRow({
  property, label, children, bindings, onDropVariable, onUnbindVariable,
}: {
  property: string; label: string; children: React.ReactNode;
  bindings?: Record<string, string>;
  onDropVariable?: (variableId: string, property: string) => void;
  onUnbindVariable?: (property: string) => void;
}) {
  const isBound = bindings?.[property];
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/variable-id")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const varId = e.dataTransfer.getData("application/variable-id");
    if (varId && onDropVariable) onDropVariable(varId, property);
  };
  return (
    <div className={`var-bound-row ${isBound ? "var-bound-active" : ""}`} onDragOver={handleDragOver} onDrop={handleDrop}>
      {isBound && <div className="var-bound-indicator" title="Bound to variable (click to unbind)" onClick={() => onUnbindVariable?.(property)}>🔗</div>}
      {children}
    </div>
  );
}

// ─── Constraints Editor ──────────────────────────────────────────

interface ConstraintsEditorProps {
  constraints: LayoutConstraint;
  onChange: (c: LayoutConstraint) => void;
}

function ConstraintsEditor({ constraints, onChange }: ConstraintsEditorProps) {
  const toggle = (key: keyof LayoutConstraint) => {
    const current = constraints[key];
    let next: boolean | "scale" | undefined;
    if (current === undefined || current === false) next = true;
    else if (current === true) next = "scale";
    else next = undefined;
    onChange({ ...constraints, [key]: next });
  };

  const pinStyle = (active: boolean, mode?: boolean | "scale"): React.CSSProperties => ({
    width: 14, height: 14, borderRadius: 2,
    border: active ? `2px solid ${mode === "scale" ? "#f59e0b" : "#6366f1"}` : "1.5px solid #555",
    background: active ? (mode === "scale" ? "rgba(245,158,11,0.2)" : "rgba(99,102,241,0.25)") : "transparent",
    cursor: "pointer", transition: "all 0.15s",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 8, color: active ? (mode === "scale" ? "#f59e0b" : "#6366f1") : "#888",
    fontWeight: 700, userSelect: "none" as const,
  });

  const labelFor = (key: keyof LayoutConstraint): string => {
    const v = constraints[key];
    if (v === true) return "Fixed";
    if (v === "scale") return "Scale";
    return "Off";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{
        display: "grid", gridTemplateColumns: "auto 1fr auto", gridTemplateRows: "auto 1fr auto",
        gap: 2, width: "100%", aspectRatio: "1.4", maxWidth: 200, margin: "0 auto",
        alignItems: "center", justifyItems: "center",
      }}>
        <div />
        <div style={pinStyle(!!constraints.top, constraints.top)} onClick={() => toggle("top")} title={`Top: ${labelFor("top")}`}>
          {constraints.top === "scale" ? "↗" : constraints.top ? "↑" : ""}
        </div>
        <div />
        <div style={pinStyle(!!constraints.left, constraints.left)} onClick={() => toggle("left")} title={`Left: ${labelFor("left")}`}>
          {constraints.left === "scale" ? "↙" : constraints.left ? "←" : ""}
        </div>
        <div style={{ width: "100%", height: "100%", border: "1.5px solid #444", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
            <div style={{ display: "flex", gap: 2 }}>
              <div style={{ ...pinStyle(!!constraints.centerX, constraints.centerX), width: 10, height: 10 }} onClick={() => toggle("centerX")} title={`Center X`}>↔</div>
            </div>
            <div style={{ display: "flex", gap: 2 }}>
              <div style={{ ...pinStyle(!!constraints.centerY, constraints.centerY), width: 10, height: 10 }} onClick={() => toggle("centerY")} title={`Center Y`}>↕</div>
            </div>
          </div>
        </div>
        <div style={pinStyle(!!constraints.right, constraints.right)} onClick={() => toggle("right")} title={`Right: ${labelFor("right")}`}>
          {constraints.right === "scale" ? "↗" : constraints.right ? "→" : ""}
        </div>
        <div />
        <div style={pinStyle(!!constraints.bottom, constraints.bottom)} onClick={() => toggle("bottom")} title={`Bottom: ${labelFor("bottom")}`}>
          {constraints.bottom === "scale" ? "↘" : constraints.bottom ? "↓" : ""}
        </div>
        <div />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {(["left", "right", "top", "bottom"] as const).map((key) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="prop-label" style={{ width: 44, textTransform: "capitalize", fontSize: 11 }}>{key}</span>
            <select className="prop-select" style={{ flex: 1, fontSize: 11 }}
              value={constraints[key] === true ? "fixed" : constraints[key] === "scale" ? "scale" : "off"}
              onChange={(e) => { const v = e.target.value; onChange({ ...constraints, [key]: v === "fixed" ? true : v === "scale" ? "scale" : undefined }); }}>
              <option value="off">Off</option><option value="fixed">Fixed</option><option value="scale">Scale</option>
            </select>
          </div>
        ))}
        {(["centerX", "centerY"] as const).map((key) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="prop-label" style={{ width: 44, textTransform: "capitalize", fontSize: 11 }}>{key === "centerX" ? "Cent X" : "Cent Y"}</span>
            <label className="checkbox-row" style={{ fontSize: 11 }}>
              <input type="checkbox" checked={!!constraints[key]} onChange={(e) => onChange({ ...constraints, [key]: e.target.checked || undefined })} />
              <span>{constraints[key] ? "On" : "Off"}</span>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="prop-section"><div className="prop-section-title">{title}</div>{children}</div>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="prop-row">{children}</div>;
}
function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <span className="prop-label" style={style}>{children}</span>;
}
function InputGroup({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <div className="input-group"><span>{label}</span><input type="text" value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>;
}
function rgbToHex(color: string): string {
  if (!color) return "#000000";
  if (color.startsWith("#")) return color.length === 4 ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}` : color;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "#000000";
  return `#${[m[1], m[2], m[3]].map((x) => parseInt(x).toString(16).padStart(2, "0")).join("")}`;
}
