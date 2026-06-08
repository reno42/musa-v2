import { useState, useEffect, useCallback } from "react";
import type { FabricObject } from "fabric";
import { mcpCall } from "../lib/mcpClient";
import { getTemplate } from "../lib/templateApi";

interface InteractionDef {
  id: string;
  sourceId: string;
  trigger: string;
  action: string;
  targetId: string | null;
  transition: string;
  duration: number;
  delay: number;
  easing: string;
}

interface AnimationDef {
  id: string;
  objectId: string;
  type: string;
  direction: string | null;
  duration: number;
  easing: string;
  delay: number;
}

interface OverlayDef {
  position: string;
  backdrop: boolean;
  backdropColor: string;
  closeOnBackdrop: boolean;
  manualX: number | null;
  manualY: number | null;
}

interface FrameItem {
  id: string;
  name: string;
  metadata?: { overlay?: OverlayDef; scroll?: any };
}

interface PrototypePanelProps {
  templateId: string | null;
  selectedObjects: FabricObject[];
  onUpdate?: () => void;
  onClose: () => void;
}

type TabId = "interactions" | "animations" | "overlay";

export function PrototypePanel({ templateId, selectedObjects, onUpdate, onClose }: PrototypePanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("interactions");
  const [interactions, setInteractions] = useState<InteractionDef[]>([]);
  const [animations, setAnimations] = useState<AnimationDef[]>([]);
  const [frames, setFrames] = useState<FrameItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Interaction form
  const [ixSourceId, setIxSourceId] = useState("");
  const [ixTrigger, setIxTrigger] = useState("onClick");
  const [ixAction, setIxAction] = useState("navigate");
  const [ixTargetId, setIxTargetId] = useState("");
  const [ixTransition, setIxTransition] = useState("instant");
  const [ixDuration, setIxDuration] = useState(300);
  const [ixDelay, setIxDelay] = useState(0);
  const [ixEasing, setIxEasing] = useState("easeOut");
  const [showAddInteraction, setShowAddInteraction] = useState(false);

  // Animation form
  const [animObjectId, setAnimObjectId] = useState("");
  const [animType, setAnimType] = useState("fade");
  const [animDirection, setAnimDirection] = useState("");
  const [animDuration, setAnimDuration] = useState(300);
  const [animDelay, setAnimDelay] = useState(0);
  const [animEasing, setAnimEasing] = useState("easeOut");
  const [showAddAnimation, setShowAddAnimation] = useState(false);

  // Overlay form (per frame)
  const [overlayFrameId, setOverlayFrameId] = useState("");
  const [ovPosition, setOvPosition] = useState("center");
  const [ovBackdrop, setOvBackdrop] = useState(true);
  const [ovBackdropColor, setOvBackdropColor] = useState("rgba(0,0,0,0.5)");
  const [ovCloseOnBackdrop, setOvCloseOnBackdrop] = useState(true);
  const [ovManualX, setOvManualX] = useState("");
  const [ovManualY, setOvManualY] = useState("");

  const loadData = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    try {
      const tpl = await getTemplate(templateId);
      setInteractions((tpl as any)?.metadata?.interactions || []);
      setAnimations((tpl as any)?.metadata?.animations || []);
      const f = (tpl as any)?.frames || [];
      setFrames(f.map((fr: any) => ({ id: fr.id || fr.frameId, name: fr.name || fr.frameName || "Unnamed", metadata: fr.metadata })));
    } catch {
      setError("Failed to load prototype data");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Interactions ──
  const handleAddInteraction = async () => {
    if (!templateId || !ixSourceId) return;
    try {
      await mcpCall("add_interaction", {
        templateId, sourceId: ixSourceId, trigger: ixTrigger, action: ixAction,
        targetId: ixTargetId || null, transition: ixTransition,
        duration: ixDuration, delay: ixDelay, easing: ixEasing,
      });
      setShowAddInteraction(false);
      await loadData();
    } catch (e: any) { setError(e.message || "Failed to add interaction"); }
  };

  const handleDeleteInteraction = async (ixId: string) => {
    setInteractions(prev => prev.filter(i => i.id !== ixId));
  };

  // ── Animations ──
  const handleAddAnimation = async () => {
    if (!templateId || !animObjectId || !animType) return;
    try {
      await mcpCall("set_animation", {
        templateId, objectId: animObjectId, type: animType,
        direction: animDirection || null, duration: animDuration,
        delay: animDelay, easing: animEasing,
      });
      setShowAddAnimation(false);
      await loadData();
    } catch (e: any) { setError(e.message || "Failed to set animation"); }
  };

  const handleDeleteAnimation = (animId: string) => {
    setAnimations(prev => prev.filter(a => a.id !== animId));
  };

  // ── Overlay ──
  const handleSaveOverlay = async () => {
    if (!templateId || !overlayFrameId) return;
    try {
      await mcpCall("add_overlay", {
        templateId, frameId: overlayFrameId, position: ovPosition,
        backdrop: ovBackdrop, backdropColor: ovBackdropColor,
        closeOnBackdrop: ovCloseOnBackdrop,
        manualX: ovManualX ? Number(ovManualX) : null,
        manualY: ovManualY ? Number(ovManualY) : null,
      });
      await loadData();
    } catch (e: any) { setError(e.message || "Failed to save overlay"); }
  };

  const selName = selectedObjects.length === 1
    ? ((selectedObjects[0] as any).layerName || (selectedObjects[0] as any).name || selectedObjects[0].type || "object")
    : "";

  const triggerLabel: Record<string, string> = { onClick: "Click", onHover: "Hover", onPress: "Press", onDelay: "Delay" };
  const actionLabel: Record<string, string> = { navigate: "Navigate", overlay: "Overlay", scroll: "Scroll", back: "Back", close: "Close" };
  const transitionLabel: Record<string, string> = { instant: "Instant", dissolve: "Dissolve", slide: "Slide", push: "Push", smartAnimate: "Smart" };

  if (!templateId) return <div style={emptyStyle}>Open a template to manage prototypes</div>;
  if (loading) return <div style={emptyStyle}>Loading...</div>;

  return (
    <div style={{
      position: "fixed", top: 48, right: 0, bottom: 0, width: 300,
      background: "#0e0e14", borderLeft: "1px solid #1c1c26",
      display: "flex", flexDirection: "column", zIndex: 50,
      fontFamily: "Inter, sans-serif", fontSize: 12, color: "#c4c4d4",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 12px", borderBottom: "1px solid #1c1c26",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>▶ Prototype</span>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "#7a7a90", cursor: "pointer", fontSize: 16,
        }}>✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1c1c26" }}>
        {(["interactions", "animations", "overlay"] as TabId[]).map(tab => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: "6px 4px", fontSize: 11, cursor: "pointer",
              background: activeTab === tab ? "#1a1a2e" : "transparent",
              border: "none", borderBottom: activeTab === tab ? "2px solid #818cf8" : "2px solid transparent",
              color: activeTab === tab ? "#e4e4f0" : "#7a7a90",
              fontWeight: activeTab === tab ? 600 : 400,
            }}>
            {tab === "interactions" ? "Interactions" : tab === "animations" ? "Animations" : "Overlay"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {error && <div style={{ ...emptyStyle, color: "#e44", padding: "8px 12px" }}>{error}</div>}

        {/* ─── INTERACTIONS TAB ─── */}
        {activeTab === "interactions" && (
          <div style={{ padding: "0 8px" }}>
            {/* Add button */}
            {!showAddInteraction ? (
              <button type="button" onClick={() => setShowAddInteraction(true)}
                disabled={frames.length < 1}
                style={{
                  width: "100%", padding: "5px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer", marginBottom: 8,
                  background: frames.length > 0 ? "#1a2a3a" : "#111118",
                  border: frames.length > 0 ? "1px solid #2a3a5a" : "1px solid #1c1c26",
                  color: frames.length > 0 ? "#60a5fa" : "#5a5a70",
                }}>
                + Add Interaction
              </button>
            ) : (
              <div style={{ background: "#111118", border: "1px solid #1c1c26", borderRadius: 6, padding: 8, marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 6, color: "#60a5fa" }}>New Interaction</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {/* Source */}
                  <div style={rowStyle}>
                    <span style={labelStyle}>Source</span>
                    <select value={ixSourceId} onChange={e => setIxSourceId(e.target.value)} style={selectStyle}>
                      <option value="">-- Select frame --</option>
                      {frames.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </div>
                  {/* Trigger */}
                  <div style={rowStyle}>
                    <span style={labelStyle}>Trigger</span>
                    <select value={ixTrigger} onChange={e => setIxTrigger(e.target.value)} style={selectStyle}>
                      {Object.entries(triggerLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  {/* Action */}
                  <div style={rowStyle}>
                    <span style={labelStyle}>Action</span>
                    <select value={ixAction} onChange={e => setIxAction(e.target.value)} style={selectStyle}>
                      {Object.entries(actionLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  {/* Target (only for navigate/overlay) */}
                  {(ixAction === "navigate" || ixAction === "overlay") && (
                    <div style={rowStyle}>
                      <span style={labelStyle}>Target</span>
                      <select value={ixTargetId} onChange={e => setIxTargetId(e.target.value)} style={selectStyle}>
                        <option value="">-- Select frame --</option>
                        {frames.filter(f => f.id !== ixSourceId).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </div>
                  )}
                  {/* Transition */}
                  <div style={rowStyle}>
                    <span style={labelStyle}>Transition</span>
                    <select value={ixTransition} onChange={e => setIxTransition(e.target.value)} style={selectStyle}>
                      {Object.entries(transitionLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  {/* Duration */}
                  <div style={rowStyle}>
                    <span style={labelStyle}>Duration</span>
                    <input type="number" value={ixDuration} onChange={e => setIxDuration(Number(e.target.value))}
                      style={inputStyle} min={0} max={5000} step={100} />
                    <span style={{ fontSize: 10, color: "#5a5a70" }}>ms</span>
                  </div>
                  {/* Delay */}
                  <div style={rowStyle}>
                    <span style={labelStyle}>Delay</span>
                    <input type="number" value={ixDelay} onChange={e => setIxDelay(Number(e.target.value))}
                      style={inputStyle} min={0} max={10000} step={100} />
                    <span style={{ fontSize: 10, color: "#5a5a70" }}>ms</span>
                  </div>
                  {/* Easing */}
                  <div style={rowStyle}>
                    <span style={labelStyle}>Easing</span>
                    <select value={ixEasing} onChange={e => setIxEasing(e.target.value)} style={selectStyle}>
                      <option value="easeIn">easeIn</option><option value="easeOut">easeOut</option>
                      <option value="easeInOut">easeInOut</option><option value="linear">linear</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <button type="button" onClick={handleAddInteraction} disabled={!ixSourceId}
                      style={{ ...btnSm, flex: 1, background: "#1a2a1a", border: "1px solid #2a4a2a", color: "#4ade80" }}>
                      Save
                    </button>
                    <button type="button" onClick={() => setShowAddInteraction(false)}
                      style={{ ...btnSm, background: "#111118", border: "1px solid #1c1c26", color: "#7a7a90" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Interactions list */}
            {interactions.length === 0 && (
              <div style={emptyStyle}>No interactions yet.</div>
            )}
            {interactions.map(ix => {
              const srcFrame = frames.find(f => f.id === ix.sourceId);
              const tgtFrame = frames.find(f => f.id === ix.targetId);
              return (
                <div key={ix.id} style={{
                  padding: "6px 8px", marginBottom: 4, borderRadius: 4,
                  background: "#111118", border: "1px solid #1c1c26",
                  fontSize: 11,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#e4e4f0", fontWeight: 600 }}>
                      {srcFrame?.name || ix.sourceId}
                    </span>
                    <button type="button" onClick={() => handleDeleteInteraction(ix.id)}
                      style={{ background: "none", border: "none", color: "#5a5a70", cursor: "pointer", fontSize: 12 }}>
                      ✕
                    </button>
                  </div>
                  <div style={{ color: "#7a7a90", marginTop: 2 }}>
                    {triggerLabel[ix.trigger] || ix.trigger} → {actionLabel[ix.action] || ix.action}
                    {tgtFrame && ` → ${tgtFrame.name}`}
                  </div>
                  <div style={{ color: "#5a5a70", fontSize: 10, marginTop: 1 }}>
                    {transitionLabel[ix.transition] || ix.transition} · {ix.duration}ms · {ix.easing}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ─── ANIMATIONS TAB ─── */}
        {activeTab === "animations" && (
          <div style={{ padding: "0 8px" }}>
            {/* Add button */}
            {!showAddAnimation ? (
              <button type="button" onClick={() => {
                setShowAddAnimation(true);
                if (selName) setAnimObjectId(selName);
              }}
                style={{
                  width: "100%", padding: "5px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer", marginBottom: 8,
                  background: "#1a2a3a", border: "1px solid #2a3a5a", color: "#60a5fa",
                }}>
                + Add Animation {selName ? `for "${selName}"` : ""}
              </button>
            ) : (
              <div style={{ background: "#111118", border: "1px solid #1c1c26", borderRadius: 6, padding: 8, marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 6, color: "#818cf8" }}>New Animation</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={rowStyle}>
                    <span style={labelStyle}>Object</span>
                    <input value={animObjectId} onChange={e => setAnimObjectId(e.target.value)}
                      placeholder="Layer name or ID" style={inputStyle} />
                  </div>
                  <div style={rowStyle}>
                    <span style={labelStyle}>Type</span>
                    <select value={animType} onChange={e => setAnimType(e.target.value)} style={selectStyle}>
                      <option value="fade">Fade</option>
                      <option value="slideIn">Slide In</option>
                      <option value="slideOut">Slide Out</option>
                      <option value="dissolve">Dissolve</option>
                      <option value="push">Push</option>
                      <option value="smartAnimate">Smart Animate</option>
                    </select>
                  </div>
                  {(animType === "slideIn" || animType === "slideOut") && (
                    <div style={rowStyle}>
                      <span style={labelStyle}>Direction</span>
                      <select value={animDirection} onChange={e => setAnimDirection(e.target.value)} style={selectStyle}>
                        <option value="">Auto</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                        <option value="up">Up</option>
                        <option value="down">Down</option>
                      </select>
                    </div>
                  )}
                  <div style={rowStyle}>
                    <span style={labelStyle}>Duration</span>
                    <input type="number" value={animDuration} onChange={e => setAnimDuration(Number(e.target.value))}
                      style={inputStyle} min={0} max={5000} step={100} />
                    <span style={{ fontSize: 10, color: "#5a5a70" }}>ms</span>
                  </div>
                  <div style={rowStyle}>
                    <span style={labelStyle}>Delay</span>
                    <input type="number" value={animDelay} onChange={e => setAnimDelay(Number(e.target.value))}
                      style={inputStyle} min={0} max={10000} step={100} />
                    <span style={{ fontSize: 10, color: "#5a5a70" }}>ms</span>
                  </div>
                  <div style={rowStyle}>
                    <span style={labelStyle}>Easing</span>
                    <select value={animEasing} onChange={e => setAnimEasing(e.target.value)} style={selectStyle}>
                      <option value="easeIn">easeIn</option><option value="easeOut">easeOut</option>
                      <option value="easeInOut">easeInOut</option><option value="linear">linear</option>
                      <option value="spring">spring</option><option value="bounce">bounce</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <button type="button" onClick={handleAddAnimation} disabled={!animObjectId}
                      style={{ ...btnSm, flex: 1, background: "#1a2a1a", border: "1px solid #2a4a2a", color: "#4ade80" }}>
                      Save
                    </button>
                    <button type="button" onClick={() => setShowAddAnimation(false)}
                      style={{ ...btnSm, background: "#111118", border: "1px solid #1c1c26", color: "#7a7a90" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Animations list */}
            {animations.length === 0 && (
              <div style={emptyStyle}>No animations yet.</div>
            )}
            {animations.map(anim => (
              <div key={anim.id} style={{
                padding: "6px 8px", marginBottom: 4, borderRadius: 4,
                background: "#111118", border: "1px solid #1c1c26",
                fontSize: 11,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#e4e4f0", fontWeight: 600 }}>{anim.objectId}</span>
                  <button type="button" onClick={() => handleDeleteAnimation(anim.id)}
                    style={{ background: "none", border: "none", color: "#5a5a70", cursor: "pointer", fontSize: 12 }}>
                    ✕
                  </button>
                </div>
                <div style={{ color: "#7a7a90", marginTop: 2 }}>
                  {anim.type} {anim.direction ? `· ${anim.direction}` : ""}
                </div>
                <div style={{ color: "#5a5a70", fontSize: 10, marginTop: 1 }}>
                  {anim.duration}ms · {anim.easing} · delay {anim.delay}ms
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ─── OVERLAY TAB ─── */}
        {activeTab === "overlay" && (
          <div style={{ padding: "0 8px" }}>
            {frames.length === 0 ? (
              <div style={emptyStyle}>No frames available. Create a frame first.</div>
            ) : (
              <>
                <div style={rowStyle}>
                  <span style={labelStyle}>Frame</span>
                  <select value={overlayFrameId} onChange={e => { setOverlayFrameId(e.target.value); }}
                    style={selectStyle}>
                    <option value="">-- Select frame --</option>
                    {frames.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>

                {overlayFrameId && (() => {
                  const selFrame = frames.find(f => f.id === overlayFrameId);
                  const existing = selFrame?.metadata?.overlay;
                  // Populate from existing if available
                  if (existing && ovPosition === "center" && !ovBackdrop) {
                    // Use effect would be better but inline for simplicity
                  }
                  return (
                    <div style={{ background: "#111118", border: "1px solid #1c1c26", borderRadius: 6, padding: 8, marginTop: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 6, color: "#c084fc" }}>
                        Overlay: {selFrame?.name}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={rowStyle}>
                          <span style={labelStyle}>Position</span>
                          <select value={ovPosition} onChange={e => setOvPosition(e.target.value)} style={selectStyle}>
                            <option value="center">Center</option>
                            <option value="topLeft">Top Left</option>
                            <option value="topRight">Top Right</option>
                            <option value="bottomLeft">Bottom Left</option>
                            <option value="bottomRight">Bottom Right</option>
                            <option value="manual">Manual</option>
                          </select>
                        </div>
                        {ovPosition === "manual" && (
                          <>
                            <div style={rowStyle}>
                              <span style={labelStyle}>X</span>
                              <input value={ovManualX} onChange={e => setOvManualX(e.target.value)}
                                placeholder="px" style={inputStyle} />
                            </div>
                            <div style={rowStyle}>
                              <span style={labelStyle}>Y</span>
                              <input value={ovManualY} onChange={e => setOvManualY(e.target.value)}
                                placeholder="px" style={inputStyle} />
                            </div>
                          </>
                        )}

                        <div style={rowStyle}>
                          <span style={labelStyle}>Backdrop</span>
                          <button type="button" onClick={() => setOvBackdrop(!ovBackdrop)}
                            style={{
                              padding: "2px 8px", borderRadius: 3, fontSize: 10, cursor: "pointer",
                              background: ovBackdrop ? "#1a2a1a" : "#1a1111",
                              border: ovBackdrop ? "1px solid #2a4a2a" : "1px solid #2a1a1a",
                              color: ovBackdrop ? "#4ade80" : "#7a5a5a",
                            }}>
                            {ovBackdrop ? "ON" : "OFF"}
                          </button>
                        </div>

                        {ovBackdrop && (
                          <div style={rowStyle}>
                            <span style={labelStyle}>Color</span>
                            <input value={ovBackdropColor} onChange={e => setOvBackdropColor(e.target.value)}
                              style={{ ...inputStyle, flex: 1 }} />
                          </div>
                        )}

                        <div style={rowStyle}>
                          <span style={labelStyle}>Close on backdrop</span>
                          <button type="button" onClick={() => setOvCloseOnBackdrop(!ovCloseOnBackdrop)}
                            style={{
                              padding: "2px 8px", borderRadius: 3, fontSize: 10, cursor: "pointer",
                              background: ovCloseOnBackdrop ? "#1a2a1a" : "#1a1111",
                              border: ovCloseOnBackdrop ? "1px solid #2a4a2a" : "1px solid #2a1a1a",
                              color: ovCloseOnBackdrop ? "#4ade80" : "#7a5a5a",
                            }}>
                            {ovCloseOnBackdrop ? "ON" : "OFF"}
                          </button>
                        </div>

                        <button type="button" onClick={handleSaveOverlay}
                          style={{
                            width: "100%", padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer", marginTop: 4,
                            background: "#1a2a1a", border: "1px solid #2a4a2a", color: "#4ade80",
                          }}>
                          Save Overlay
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

            {/* Show existing overlays */}
            {frames.filter(f => f.metadata?.overlay).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#5a5a70", marginBottom: 4 }}>Existing Overlays:</div>
                {frames.filter(f => f.metadata?.overlay).map(f => (
                  <div key={f.id} style={{
                    padding: "6px 8px", marginBottom: 4, borderRadius: 4,
                    background: "#111118", border: "1px solid #1c1c26", fontSize: 11,
                  }}>
                    <span style={{ color: "#c084fc", fontWeight: 600 }}>{f.name}</span>
                    <span style={{ color: "#5a5a70", marginLeft: 8 }}>
                      {f.metadata!.overlay!.position}
                      {f.metadata!.overlay!.backdrop ? " · backdrop" : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  padding: 20, color: "#666", fontSize: 12, textAlign: "center",
};

const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10, color: "#7a7a90", minWidth: 60, textAlign: "right",
};

const inputStyle: React.CSSProperties = {
  flex: 1, background: "#0a0a14", border: "1px solid #1c1c26",
  color: "#e4e4f0", borderRadius: 4, padding: "2px 6px", fontSize: 11,
  fontFamily: "monospace", minWidth: 60,
};

const selectStyle: React.CSSProperties = {
  flex: 1, background: "#0a0a14", border: "1px solid #1c1c26",
  color: "#e4e4f0", borderRadius: 4, padding: "2px 4px", fontSize: 11,
  minWidth: 60,
};

const btnSm: React.CSSProperties = {
  padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer",
};
