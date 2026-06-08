import { useState, useEffect, useCallback } from "react";
import { mcpCall } from "../lib/mcpClient";
import { IconDna, IconX, IconSearch, IconCheck, IconMicroscope, IconTarget, IconWarn, IconPlay } from "../shared/icons";

interface SkillPanelProps {
  templateId: string | null;
  onClose: () => void;
  onUpdate: () => void;
}

type TabId = "extract" | "clone" | "apply" | "brand";
type BrandSubTab = "analyze" | "apply";

interface SavedSkill {
  id: string;
  name: string;
  description?: string;
  patterns?: any;
  rules?: string[];
  sourceTemplateId?: string;
  created?: string;
}

interface ExtractedPatterns {
  skillId: string;
  name: string;
  patterns: any;
  rules: string[];
}

interface BrandDNA {
  brandId: string;
  brandName: string;
  brandDNA: any;
  confidence?: number;
}

export function SkillPanel({ templateId, onClose, onUpdate }: SkillPanelProps) {
  const [tab, setTab] = useState<TabId>("extract");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract state
  const [skillName, setSkillName] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [extracted, setExtracted] = useState<ExtractedPatterns | null>(null);

  // Clone state
  const [cloneName, setCloneName] = useState("");
  const [cloneDesc, setCloneDesc] = useState("");
  const [clonePatterns, setClonePatterns] = useState("");
  const [cloneSourceId, setCloneSourceId] = useState("");
  const [cloneResult, setCloneResult] = useState<any>(null);

  // Apply state
  const [applySkillId, setApplySkillId] = useState("");
  const [applyMode, setApplyMode] = useState<"adaptive" | "strict">("adaptive");
  const [applyResult, setApplyResult] = useState<any>(null);

  // Brand state
  const [brandTab, setBrandTab] = useState<BrandSubTab>("analyze");
  const [brandName, setBrandName] = useState("");
  const [brandTemplateIds, setBrandTemplateIds] = useState("");
  const [brandUseAi, setBrandUseAi] = useState(true);
  const [brandDNA, setBrandDNA] = useState<BrandDNA | null>(null);
  const [brandAggressiveness, setBrandAggressiveness] = useState(0.8);
  const [brandApplyResult, setBrandApplyResult] = useState<any>(null);

  // Saved skills from template metadata
  const [savedSkills, setSavedSkills] = useState<SavedSkill[]>([]);

  // Load saved skills on mount / templateId change
  useEffect(() => {
    if (!templateId) return;
    (async () => {
      try {
        const tpl = await mcpCall("get_template", { id: templateId });
        const skills = tpl?.metadata?.clonedSkills || [];
        if (tpl?.metadata?.extractedPatterns) {
          skills.push({ id: tpl.metadata.extractedPatterns.skillId, name: tpl.metadata.extractedPatterns.name || "Extracted", patterns: tpl.metadata.extractedPatterns.patterns, rules: tpl.metadata.extractedPatterns.rules });
        }
        setSavedSkills(skills);
      } catch { /* silent */ }
    })();
  }, [templateId]);

  // ── Handlers ──

  const handleExtract = async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    setExtracted(null);
    try {
      const result = await mcpCall("skill_extract", { templateId, name: skillName || undefined, useAi });
      setExtracted(result);
      // Pre-fill clone tab
      setCloneName(result.name || skillName || "");
      setClonePatterns(JSON.stringify(result.patterns, null, 2));
      setCloneSourceId(templateId);
    } catch (e: any) {
      setError(e?.message || "Extraction failed");
    }
    setLoading(false);
  };

  const handleClone = async () => {
    if (!templateId || !cloneName.trim()) return;
    setLoading(true);
    setError(null);
    setCloneResult(null);
    try {
      let patterns;
      try { patterns = JSON.parse(clonePatterns); } catch { patterns = {}; }
      const result = await mcpCall("skill_clone", {
        templateId,
        skillName: cloneName.trim(),
        description: cloneDesc.trim() || undefined,
        patterns,
        sourceTemplateId: cloneSourceId || templateId,
      });
      setCloneResult(result);
      // Refresh saved skills
      const tpl = await mcpCall("get_template", { id: templateId });
      setSavedSkills(tpl?.metadata?.clonedSkills || []);
    } catch (e: any) {
      setError(e?.message || "Clone failed");
    }
    setLoading(false);
  };

  const handleApply = async () => {
    if (!templateId) return;
    setLoading(true);
    setError(null);
    setApplyResult(null);
    try {
      const params: any = { templateId, mode: applyMode };
      if (applySkillId) {
        const skill = savedSkills.find(s => s.id === applySkillId || s.name === applySkillId);
        if (skill) params.skillId = skill.id;
        else params.skillId = applySkillId;
      }
      const result = await mcpCall("skill_apply", params);
      setApplyResult(result);
      onUpdate();
    } catch (e: any) {
      setError(e?.message || "Apply failed");
    }
    setLoading(false);
  };

  const handleBrandAnalyze = async () => {
    setLoading(true);
    setError(null);
    setBrandDNA(null);
    try {
      const ids = brandTemplateIds.split(",").map(s => s.trim()).filter(Boolean);
      const params: any = { brandName: brandName || undefined, useAi: brandUseAi };
      if (ids.length > 0) params.templateIds = ids;
      else if (templateId) params.templateIds = [templateId];
      if (!params.templateIds) { setError("Provide at least one template ID"); setLoading(false); return; }
      const result = await mcpCall("brand_analyze", params);
      setBrandDNA({ brandId: result.brandId, brandName: result.brandName, brandDNA: result.brandDNA, confidence: result.confidence });
    } catch (e: any) {
      setError(e?.message || "Brand analysis failed");
    }
    setLoading(false);
  };

  const handleBrandApply = async () => {
    if (!templateId || !brandDNA) return;
    setLoading(true);
    setError(null);
    setBrandApplyResult(null);
    try {
      const result = await mcpCall("brand_apply", { templateId, brandDNA: brandDNA.brandDNA, aggressiveness: brandAggressiveness });
      setBrandApplyResult(result);
      onUpdate();
    } catch (e: any) {
      setError(e?.message || "Brand apply failed");
    }
    setLoading(false);
  };

  // Select a saved skill for apply
  const selectSkill = (skill: SavedSkill) => {
    setApplySkillId(skill.id);
    setTab("apply");
  };

  // ── UI ──

  const tabs: { id: TabId; label: string }[] = [
    { id: "extract", label: "Extract" },
    { id: "clone", label: "Clone" },
    { id: "apply", label: "Apply" },
    { id: "brand", label: "Brand" },
  ];

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.6)", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Inter, sans-serif",
    }}>
      <div className="glass-panel" style={{
        width: 620, maxHeight: "85vh",
        display: "flex", flexDirection: "column",
        fontSize: 12, color: "#c4c0b4",
      }}>
        {/* Header */}
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid #1c1c26",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}><IconDna size={16} style={{ marginRight: 6, verticalAlign: -3 }} />Clone Skills</span>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#7a7668", cursor: "pointer",
          }}><IconX size={18} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1c1c26" }}>
          {tabs.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: "8px 4px", border: "none", cursor: "pointer",
                background: tab === t.id ? "#1a1a2e" : "transparent",
                color: tab === t.id ? "#c8b898" : "#7a7668",
                borderBottom: tab === t.id ? "2px solid #c8b898" : "2px solid transparent",
                fontSize: 11, fontWeight: tab === t.id ? 600 : 400,
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", gap: 16 }}>
          {/* Main content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* ── Extract Tab ── */}
            {tab === "extract" && (
              <>
                <label style={labelStyle}>Template ID</label>
                <input type="text" value={templateId || ""} readOnly style={{ ...inputStyle, opacity: 0.6 }} />

                <label style={{ ...labelStyle, marginTop: 10 }}>Skill Name (optional)</label>
                <input type="text" value={skillName} onChange={e => setSkillName(e.target.value)}
                  placeholder="e.g. Brutalist Dark Theme" style={inputStyle} />

                <label style={{ ...labelStyle, marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={useAi} onChange={e => setUseAi(e.target.checked)}
                    style={{ accentColor: "#c8b898" }} />
                  Use AI semantic analysis
                </label>

                <button type="button" onClick={handleExtract} disabled={loading || !templateId}
                  style={{ ...btnPrimary, marginTop: 14, width: "100%", opacity: loading || !templateId ? 0.5 : 1 }}>
                  {loading ? "Extracting..." : <><IconSearch size={14} style={{ marginRight: 4, verticalAlign: -2 }} />Extract Patterns</>}
                </button>

                {extracted && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                      Extracted Patterns
                    </div>
                    <div style={{ ...codeBlock, maxHeight: 200, overflowY: "auto" }}>
                      <div style={{ fontSize: 10, color: "#4ade80", marginBottom: 4 }}>Skill: {extracted.name}</div>
                      {extracted.patterns?.palette?.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ color: "#7a7668" }}>Palette: </span>
                          <span style={{ display: "flex", gap: 3, marginTop: 2 }}>
                            {extracted.patterns.palette.slice(0, 6).map((c: any, i: number) => (
                              <span key={i} style={{
                                display: "inline-block", width: 16, height: 16, borderRadius: 3,
                                background: c.hex, border: "1px solid #2a2a3a",
                              }} title={c.hex} />
                            ))}
                          </span>
                        </div>
                      )}
                      {extracted.patterns?.typography?.fonts?.length > 0 && (
                        <div style={{ marginTop: 6, fontSize: 10 }}>
                          <span style={{ color: "#7a7668" }}>Fonts: </span>
                          {extracted.patterns.typography.fonts.map((f: any, i: number) => (
                            <span key={i} style={{ color: "#c4c0b4" }}>{f.family}{i < extracted.patterns.typography.fonts.length - 1 ? ", " : ""}</span>
                          ))}
                        </div>
                      )}
                      {extracted.rules?.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ color: "#7a7668", fontSize: 10 }}>Rules:</span>
                          {extracted.rules.map((r: string, i: number) => (
                            <div key={i} style={{ fontSize: 10, color: "#fbbf24", marginTop: 1 }}>• {r}</div>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => { setCloneName(extracted.name); setClonePatterns(JSON.stringify(extracted.patterns, null, 2)); setCloneSourceId(templateId || ""); setTab("clone"); }}
                      style={{ ...btnSecondary, marginTop: 8, width: "100%" }}>
                      Save as Skill →
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── Clone Tab ── */}
            {tab === "clone" && (
              <>
                <label style={labelStyle}>Skill Name</label>
                <input type="text" value={cloneName} onChange={e => setCloneName(e.target.value)}
                  placeholder="e.g. Brutalist Dark Theme" style={inputStyle} />

                <label style={{ ...labelStyle, marginTop: 10 }}>Description (optional)</label>
                <input type="text" value={cloneDesc} onChange={e => setCloneDesc(e.target.value)}
                  placeholder="What this skill captures" style={inputStyle} />

                <label style={{ ...labelStyle, marginTop: 10 }}>Patterns (JSON)</label>
                <textarea value={clonePatterns} onChange={e => setClonePatterns(e.target.value)}
                  placeholder='Paste patterns JSON from Extract or write manually'
                  rows={5} style={textareaStyle} />

                <label style={{ ...labelStyle, marginTop: 10 }}>Source Template ID</label>
                <input type="text" value={cloneSourceId} onChange={e => setCloneSourceId(e.target.value)}
                  placeholder={templateId || "tpl_..."} style={inputStyle} />

                <button type="button" onClick={handleClone} disabled={loading || !cloneName.trim()}
                  style={{ ...btnPrimary, marginTop: 14, width: "100%", opacity: loading || !cloneName.trim() ? 0.5 : 1 }}>
                  {loading ? "Cloning..." : <><IconDna size={14} style={{ marginRight: 4, verticalAlign: -2 }} />Clone Skill</>}
                </button>

                {cloneResult && (
                  <div style={{ ...successBox, marginTop: 10 }}>
                    <IconCheck size={12} style={{ marginRight: 2, color: "#4ade80" }} /> Skill "{cloneResult.skillName}" cloned! ID: {cloneResult.skillId}
                  </div>
                )}
              </>
            )}

            {/* ── Apply Tab ── */}
            {tab === "apply" && (
              <>
                <label style={labelStyle}>Skill</label>
                <select value={applySkillId} onChange={e => setApplySkillId(e.target.value)} style={selectStyle}>
                  <option value="">Select a saved skill...</option>
                  {savedSkills.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {savedSkills.length === 0 && (
                  <div style={{ fontSize: 10, color: "#7a7668", marginTop: 4 }}>No saved skills. Extract or clone one first.</div>
                )}

                <label style={{ ...labelStyle, marginTop: 12 }}>Mode</label>
                <div style={{ display: "flex", gap: 4 }}>
                  {(["adaptive", "strict"] as const).map(m => (
                    <button key={m} type="button" onClick={() => setApplyMode(m)}
                      style={{
                        flex: 1, padding: "6px", borderRadius: 4, cursor: "pointer",
                        background: applyMode === m ? "#1a1a2e" : "transparent",
                        border: applyMode === m ? "1px solid #c8b898" : "1px solid rgba(255, 255, 255, 0.04)",
                        color: applyMode === m ? "#c8b898" : "#7a7668", fontSize: 11,
                        textTransform: "capitalize",
                      }}>
                      {m}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "#7a7668", marginTop: 3 }}>
                  {applyMode === "adaptive" ? "Respect content, adapt style" : "Full compliance with skill rules"}
                </div>

                <button type="button" onClick={handleApply} disabled={loading || !templateId}
                  style={{ ...btnPrimary, marginTop: 14, width: "100%", opacity: loading || !templateId ? 0.5 : 1 }}>
                  {loading ? "Applying..." : <><IconPlay size={14} style={{ marginRight: 4, verticalAlign: -2 }} />Apply Skill</>}
                </button>

                {applyResult && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ ...successBox }}>
                      <IconCheck size={12} style={{ marginRight: 2, color: "#4ade80" }} /> Applied "{applyResult.skillName}" in {applyResult.mode} mode
                    </div>
                    {applyResult.changes?.length > 0 && (
                      <div style={{ ...codeBlock, marginTop: 8, maxHeight: 160, overflowY: "auto" }}>
                        <div style={{ fontSize: 10, color: "#7a7668", marginBottom: 4 }}>Changes ({applyResult.changeCount})</div>
                        {applyResult.changes.slice(0, 10).map((c: any, i: number) => (
                          <div key={i} style={{ fontSize: 10, padding: "2px 0", borderBottom: "1px solid #1c1c26" }}>
                            <span style={{ color: "#c8b898" }}>{c.layer}</span>
                            <span style={{ color: "#7a7668" }}> {c.field}: </span>
                            <span style={{ color: "#f87171" }}>{String(c.old).substring(0, 20)}</span>
                            <span style={{ color: "#7a7668" }}> → </span>
                            <span style={{ color: "#4ade80" }}>{String(c.new).substring(0, 20)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── Brand Tab ── */}
            {tab === "brand" && (
              <>
                <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
                  {(["analyze", "apply"] as BrandSubTab[]).map(b => (
                    <button key={b} type="button" onClick={() => setBrandTab(b)}
                      style={{
                        flex: 1, padding: "6px", borderRadius: 4, cursor: "pointer",
                        background: brandTab === b ? "#1a1a2e" : "transparent",
                        border: brandTab === b ? "1px solid #c8b898" : "1px solid #2a2a3a",
                        color: brandTab === b ? "#c8b898" : "#7a7668", fontSize: 11,
                        textTransform: "capitalize",
                      }}>
                      {b === "analyze" ? <><IconMicroscope size={12} style={{ marginRight: 3 }} />Analyze</> : <><IconTarget size={12} style={{ marginRight: 3 }} />Apply</>}
                    </button>
                  ))}
                </div>

                {brandTab === "analyze" && (
                  <>
                    <label style={labelStyle}>Brand Name</label>
                    <input type="text" value={brandName} onChange={e => setBrandName(e.target.value)}
                      placeholder="e.g. Acme Corp" style={inputStyle} />

                    <label style={{ ...labelStyle, marginTop: 10 }}>Template IDs (comma-separated)</label>
                    <input type="text" value={brandTemplateIds} onChange={e => setBrandTemplateIds(e.target.value)}
                      placeholder={templateId || "tpl_1, tpl_2, ..."} style={inputStyle} />

                    <label style={{ ...labelStyle, marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" checked={brandUseAi} onChange={e => setBrandUseAi(e.target.checked)}
                        style={{ accentColor: "#c8b898" }} />
                      Use AI for tone analysis
                    </label>

                    <button type="button" onClick={handleBrandAnalyze} disabled={loading}
                      style={{ ...btnPrimary, marginTop: 14, width: "100%", opacity: loading ? 0.5 : 1 }}>
                      {loading ? "Analyzing..." : <><IconMicroscope size={14} style={{ marginRight: 4, verticalAlign: -2 }} />Analyze Brand</>}
                    </button>

                    {brandDNA && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                          Brand DNA: {brandDNA.brandName}
                        </div>
                        <div style={{ ...codeBlock }}>
                          <div style={{ fontSize: 11, fontWeight: 600 }}>{brandDNA.brandName}</div>
                          <div style={{ fontSize: 10, color: "#7a7668", marginTop: 2 }}>
                            Confidence: {brandDNA.confidence}%
                          </div>
                          {brandDNA.brandDNA?.colors?.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                              <span style={{ fontSize: 10, color: "#7a7668" }}>Colors:</span>
                              <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                                {brandDNA.brandDNA.colors.map((c: any, i: number) => (
                                  <span key={i} style={{
                                    display: "inline-block", width: 22, height: 22, borderRadius: 4,
                                    background: c.hex, border: "1px solid #2a2a3a",
                                  }} title={`${c.hex} (${c.frequency}×)`} />
                                ))}
                              </div>
                            </div>
                          )}
                          {brandDNA.brandDNA?.typography?.fonts?.length > 0 && (
                            <div style={{ marginTop: 6, fontSize: 10 }}>
                              <span style={{ color: "#7a7668" }}>Fonts: </span>
                              {brandDNA.brandDNA.typography.fonts.map((f: any, i: number) => (
                                <span key={i} style={{ color: "#c4c0b4" }}>{f.family}{f.frequency ? ` (${f.frequency}×)` : ""}{i < brandDNA.brandDNA.typography.fonts.length - 1 ? ", " : ""}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <button type="button" onClick={() => setBrandTab("apply")}
                          style={{ ...btnSecondary, marginTop: 8, width: "100%" }}>
                          Apply this Brand →
                        </button>
                      </div>
                    )}
                  </>
                )}

                {brandTab === "apply" && (
                  <>
                    {!brandDNA && (
                      <div style={{ fontSize: 10, color: "#7a7668", marginBottom: 10 }}>
                        Analyze a brand first, or the last analyzed brand will be used.
                      </div>
                    )}
                    {brandDNA && (
                      <div style={{ fontSize: 11, marginBottom: 10, color: "#c8b898" }}>
                        Brand: {brandDNA.brandName} (confidence: {brandDNA.confidence}%)
                      </div>
                    )}

                    <label style={labelStyle}>Aggressiveness: {Math.round(brandAggressiveness * 100)}%</label>
                    <input type="range" min={0} max={100} value={Math.round(brandAggressiveness * 100)}
                      onChange={e => setBrandAggressiveness(Number(e.target.value) / 100)}
                      style={{ width: "100%", accentColor: "#c8b898" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#7a7668" }}>
                      <span>Gentle</span><span>Aggressive</span>
                    </div>

                    <button type="button" onClick={handleBrandApply} disabled={loading || !templateId || !brandDNA}
                      style={{ ...btnPrimary, marginTop: 14, width: "100%", opacity: loading || !templateId || !brandDNA ? 0.5 : 1 }}>
                      {loading ? "Applying..." : <><IconTarget size={14} style={{ marginRight: 4, verticalAlign: -2 }} />Apply Brand</>}
                    </button>

                    {brandApplyResult && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
                          <div style={{ textAlign: "center", padding: "8px 12px", background: "#111118", borderRadius: 6, flex: 1 }}>
                            <div style={{ fontSize: 9, color: "#7a7668" }}>Before</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(brandApplyResult.scoreBefore) }}>{brandApplyResult.scoreBefore}</div>
                          </div>
                          <div style={{ fontSize: 16, color: "#4ade80" }}>→</div>
                          <div style={{ textAlign: "center", padding: "8px 12px", background: "#111118", borderRadius: 6, flex: 1 }}>
                            <div style={{ fontSize: 9, color: "#7a7668" }}>After</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(brandApplyResult.scoreAfter) }}>{brandApplyResult.scoreAfter}</div>
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: "#4ade80", textAlign: "center" }}>
                          ↑ +{brandApplyResult.scoreAfter - brandApplyResult.scoreBefore} points
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Saved Skills sidebar */}
          <div style={{
            width: 180, borderLeft: "1px solid #1c1c26", paddingLeft: 12,
            display: "flex", flexDirection: "column", gap: 4,
          }}>
            <div style={{ fontSize: 10, color: "#7a7668", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              Saved Skills
            </div>
            {savedSkills.length === 0 && (
              <div style={{ fontSize: 10, color: "#4a4a5a" }}>No skills yet</div>
            )}
            {savedSkills.map(s => (
              <div key={s.id}
                onClick={() => selectSkill(s)}
                style={{
                  padding: "6px 8px", borderRadius: 4, cursor: "pointer",
                  background: applySkillId === s.id ? "#1a1a2e" : "#0a0a10",
                  border: applySkillId === s.id ? "1px solid #c8b898" : "1px solid #1c1c26",
                  fontSize: 10,
                }}>
                <div style={{ fontWeight: 600, color: "#c4c0b4" }}>{s.name}</div>
                {s.description && <div style={{ color: "#7a7668", fontSize: 9, marginTop: 1 }}>{s.description.substring(0, 40)}</div>}
                {s.patterns && (
                  <div style={{ color: "#7a7668", fontSize: 9, marginTop: 2 }}>
                    {Object.keys(s.patterns).length} pattern groups
                  </div>
                )}
                <button type="button" onClick={(e) => { e.stopPropagation(); selectSkill(s); }}
                  style={{
                    marginTop: 4, background: "none", border: "1px solid #2a2a3a",
                    color: "#c8b898", borderRadius: 3, padding: "1px 6px",
                    cursor: "pointer", fontSize: 9, width: "100%",
                  }}>
                  <IconPlay size={10} style={{ marginRight: 2, verticalAlign: -2 }} />Apply
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Error bar */}
        {error && (
          <div style={{
            padding: "8px 12px", borderTop: "1px solid #2a1a1a",
            background: "#1a0a0a", color: "#f87171", fontSize: 11,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}><IconWarn size={14} />{error}</span>
            <button type="button" onClick={() => setError(null)}
              style={{ background: "none", border: "none", color: "#7a7668", cursor: "pointer" }}><IconX size={16} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ──

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 10, color: "#7a7668",
  marginBottom: 3, textTransform: "uppercase", letterSpacing: 1,
};

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "6px 8px", borderRadius: 4,
  background: "#0a0a14", border: "1px solid #2a2a3a",
  color: "#f0ebe0", fontSize: 11, outline: "none",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical", minHeight: 80,
  fontFamily: "monospace", fontSize: 10,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 6,
  background: "rgba(200, 184, 152, 0.12)", border: "1px solid #c8b898",
  color: "#c8b898", fontSize: 12, fontWeight: 600,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 4,
  background: "#111118", border: "1px solid #2a2a3a",
  color: "#c8b898", fontSize: 11, cursor: "pointer",
};

const codeBlock: React.CSSProperties = {
  padding: "8px 10px", background: "#0a0a10",
  border: "1px solid #1c1c26", borderRadius: 6,
  fontSize: 10, fontFamily: "monospace",
  lineHeight: 1.5, color: "#c4c0b4",
};

const successBox: React.CSSProperties = {
  padding: "8px 10px", background: "#0a1a0a",
  border: "1px solid #1a3a1a", borderRadius: 6,
  fontSize: 11, color: "#4ade80",
};

function scoreColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 60) return "#fbbf24";
  return "#f87171";
}
