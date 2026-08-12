/**
 * Throwaway harness for the canvas right-click menu.
 *
 * The editor itself sits behind a sign-in, so the menu is mounted here on its
 * own to check what can be checked without an account: that every command is
 * present, that the ones which cannot apply are disabled, that clicking one
 * fires the right callback, and that a menu opened near an edge stays on
 * screen. Serve with `npx vite` and open /debug/context-menu.html.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CanvasContextMenu } from "../src/components/CanvasContextMenu";
import type { SelectedElementInfo } from "../src/components/DesignFrame";

const asElement = (childLayerCount: number): SelectedElementInfo => ({
  layerId: "layer-a",
  tag: "div",
  selector: '[data-layer-id="layer-a"]',
  computedStyles: {},
  frameId: "frame-1",
  isSvg: false,
  childLayerCount,
});

type Scenario = "group" | "leaf" | "nothing";

function Harness() {
  const [scenario, setScenario] = useState<Scenario>("group");
  const [fired, setFired] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>({ x: 60, y: 60 });

  const log = (name: string) => () => setFired(prev => [name, ...prev].slice(0, 12));
  const selectedElement = scenario === "nothing" ? null : asElement(scenario === "group" ? 3 : 0);

  return (
    <div
      style={{ height: "100vh", padding: 16 }}
      onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["group", "leaf", "nothing"] as Scenario[]).map(option => (
          <button
            key={option} type="button" id={`scenario-${option}`}
            onClick={() => setScenario(option)}
            style={{
              padding: "4px 10px", borderRadius: 4, cursor: "pointer",
              border: "1px solid #26262f",
              background: scenario === option ? "#2a2a36" : "#111118", color: "#f0ebe0",
            }}
          >{option}</button>
        ))}
      </div>
      <p style={{ color: "#9a9484" }}>Clic derecho en cualquier punto para reabrir el menú.</p>
      <pre id="fired" style={{ color: "#8fd08f" }}>{fired.join("\n")}</pre>

      {menu && (
        <CanvasContextMenu
          x={menu.x}
          y={menu.y}
          selectedElement={selectedElement}
          selectedLayerCount={scenario === "nothing" ? 0 : 2}
          hasFrameSelection={scenario !== "nothing"}
          isHidden={false}
          isLocked={false}
          canUndo
          canRedo={false}
          hasClipboard={false}
          onClose={() => setMenu(null)}
          onCopy={log("copy")}
          onPaste={log("paste")}
          onPasteAllFrames={log("pasteAllFrames")}
          onStackChange={move => log(`stack:${move}`)()}
          onGroup={log("group")}
          onUngroup={log("ungroup")}
          onUngroupAll={log("ungroupAll")}
          onToggleVisibility={log("toggleVisibility")}
          onToggleLock={log("toggleLock")}
          onFlip={axis => log(`flip:${axis}`)()}
          onCopyCode={log("copyCode")}
          onCopyCss={log("copyCss")}
          onUndo={log("undo")}
          onRedo={log("redo")}
          onBatchAMator={log("batchAMator")}
          onFrameToTemplate={log("frameToTemplate")}
          onExtractDesignSystem={log("extractDesignSystem")}
          onInspect={log("inspect")}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
