/**
 * Throwaway harness for the fill/stroke model.
 *
 * Mounts the real contextual panel over a frame holding a group of three
 * objects that paint through three different properties — a div, an SVG path
 * and a text — plus a stroke-only group and a lone text. What is being checked
 * is that a group never writes a background of its own, that its fill reaches
 * each member through that member's own property, and that a text is filled
 * with its colour rather than a box behind it.
 *
 * Serve with `npx vite` and open /debug/fill-model.html.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { HtmlContextualPanel } from "../src/components/HtmlContextualPanel";
import type { SelectedElementInfo } from "../src/components/DesignFrame";

const HTML = `
<div data-layer-id="grp" data-layer-kind="group">
  <div data-layer-id="box" data-layer-kind="shape"></div>
  <svg data-layer-id="star" data-layer-kind="svg"><path d="M0 0 L10 10 Z"/></svg>
  <h1 data-layer-id="title" data-layer-kind="text">Hola</h1>
</div>
<div data-layer-id="outlined" data-layer-kind="group">
  <div data-layer-id="o1" data-layer-kind="shape"></div>
  <div data-layer-id="o2" data-layer-kind="shape"></div>
</div>
<h1 data-layer-id="lone" data-layer-kind="text">Solo</h1>
`;

const CSS = `
[data-layer-id="box"] { background-color: #ff0000; }
[data-layer-id="star"] { fill: #ff0000; }
[data-layer-id="title"] { color: #00ff00; }
[data-layer-id="o1"] { border-color: #123456; border-width: 2px; border-style: solid; }
[data-layer-id="o2"] { border-color: #123456; border-width: 2px; border-style: solid; }
[data-layer-id="lone"] { color: #0000ff; }
`;

const ELEMENTS: Record<string, SelectedElementInfo> = {
  group: {
    layerId: "grp", tag: "div", selector: '[data-layer-id="grp"]', computedStyles: {},
    frameId: "f1", isSvg: false, layerKind: "group", childLayerCount: 3,
  },
  strokeOnlyGroup: {
    layerId: "outlined", tag: "div", selector: '[data-layer-id="outlined"]', computedStyles: {},
    frameId: "f1", isSvg: false, layerKind: "group", childLayerCount: 2,
  },
  text: {
    layerId: "lone", tag: "h1", selector: '[data-layer-id="lone"]', computedStyles: { color: "#0000ff" },
    frameId: "f1", isSvg: false, layerKind: "text", childLayerCount: 0,
  },
};

function Harness() {
  const [which, setWhich] = useState<keyof typeof ELEMENTS>("group");
  const [css, setCss] = useState(CSS);

  return (
    <div style={{ display: "flex", gap: 16, padding: 12, height: "100vh", boxSizing: "border-box" }}>
      <div style={{ width: 320, display: "flex", flexDirection: "column", gap: 8 }}>
        {(Object.keys(ELEMENTS) as Array<keyof typeof ELEMENTS>).map(key => (
          <button
            key={key} id={`pick-${key}`} type="button" onClick={() => setWhich(key)}
            style={{
              padding: "4px 10px", borderRadius: 4, cursor: "pointer", border: "1px solid #26262f",
              background: which === key ? "#2a2a36" : "#111118", color: "#f0ebe0",
            }}
          >{key}</button>
        ))}
        <button id="reset" type="button" onClick={() => setCss(CSS)}
          style={{ padding: "4px 10px", borderRadius: 4, cursor: "pointer", border: "1px solid #26262f", background: "#111118", color: "#f0ebe0" }}>
          reset css
        </button>
        <pre id="css" style={{ flex: 1, overflow: "auto", fontSize: 10, color: "#8fd08f", whiteSpace: "pre-wrap" }}>{css}</pre>
      </div>
      <div style={{ width: 300, border: "1px solid #26262f", borderRadius: 6, overflow: "auto" }}>
        <HtmlContextualPanel
          workspaceId="ws"
          element={ELEMENTS[which]}
          html={HTML}
          css={css}
          onCssChange={setCss}
          frameWidth={1080}
          frameHeight={1080}
          subTab="properties"
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
