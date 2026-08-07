import React, { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "../lib/supabase";
import { downloadBlob } from "../lib/download";
import { AssetsPanel } from "./AssetsPanel";

interface Props {
  workspaceId: string;
  onToast?: (msg: string, type?: "info" | "success" | "error") => void;
  /** Extracts colors/typography/CSS from whichever frame(s) are currently
   *  selected on the canvas and creates or updates a Style Library entry
   *  under the given name. Naming is always explicit — never inferred from
   *  the frame or template name, since that's what caused unrelated
   *  captures to silently collide into the same entry. */
  onPublish?: (name: string) => Promise<boolean>;
  publishing?: boolean;
  /** Saves whichever frame(s) are currently selected as a Key Visual. */
  onSaveKeyVisual: () => Promise<void>;
  saveRecipeMsg: string;
  selectedFrameCount: number;
  /** Opens a template — used to jump into a design created from a Key Visual. */
  onOpenTemplate?: (id: string) => void;
  /** Recursos (Assets) tab — same contract as AssetsPanel's own props. */
  onAssetUploaded?: (asset: { id: string; name: string; filename: string; mimeType: string; sizeBytes: number; url: string; width?: number; height?: number; tags?: string[]; workspaceId?: string; createdAt?: string }) => void;
  onManageStorage?: () => void;
  selectedImageSrc?: string | null;
}

interface BrandStyle {
  id: string;
  name: string;
  description?: string;
  tokensJson?: string;
  designMd?: string;
  sharedCss?: string;
  styleFingerprint?: string;
  sourceTemplateIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

interface WorkspaceTemplate {
  id: string;
  name: string;
}

interface StyleDraft {
  name: string;
  description: string;
  tokensJson: string;
  designMd: string;
  sharedCss: string;
  sourceTemplateIds: string[];
}

type DraftErrors = Partial<Record<keyof StyleDraft | "form", string>>;

interface KeyVisual {
  id: string;
  name: string;
  structure?: { frames?: Array<{ name?: string }>; layout?: { width?: number; height?: number } };
  created_at?: string;
}

const panelStyle: React.CSSProperties = {
  color: "#e0e0e0", fontSize: 13, display: "flex", flexDirection: "column",
  height: "100%", overflow: "hidden",
};

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)", borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.08)", padding: 12,
  cursor: "default", transition: "border 0.15s",
};

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)", color: "#ccc",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
  padding: "8px 14px", minHeight: 40, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
};

const inputStyle: React.CSSProperties = {
  width: "100%", minHeight: 40, padding: "8px 12px",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 6, color: "#e0e0e0", fontSize: 12,
  fontFamily: "inherit",
};

const emptyDraft = (): StyleDraft => ({
  name: "", description: "", tokensJson: "", designMd: "", sharedCss: "", sourceTemplateIds: [],
});

const normalizeStyleName = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

const hasStyleArtifacts = (style: Pick<BrandStyle, "tokensJson" | "designMd" | "sharedCss">): boolean =>
  Boolean(style.tokensJson?.trim() || style.designMd?.trim() || style.sharedCss?.trim());

const isUsableStyle = (style: BrandStyle, availableTemplateIds: Set<string>): boolean =>
  hasStyleArtifacts(style)
  && Array.isArray(style.sourceTemplateIds)
  && style.sourceTemplateIds.length > 0
  && style.sourceTemplateIds.every(templateId => availableTemplateIds.has(templateId));

function errorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (/duplicate|already exists|unique|conflict/i.test(message)) {
    return "Ya existe un estilo con ese nombre en este workspace.";
  }
  return message || fallback;
}

async function callStyleMcp<T = any>(method: string, params: Record<string, unknown>): Promise<T> {
  const response = await apiFetch<any>("/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  if (response?.error) throw new Error(response.error.message || "MCP error");
  const result = response?.result;
  if (result?.isError) {
    throw new Error(result?.content?.[0]?.text || "MCP error");
  }
  const text = result?.content?.[0]?.text;
  if (typeof text === "string") {
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Respuesta inválida de ${method}`);
    }
  }
  if (result === undefined) throw new Error(`Sin respuesta de ${method}`);
  return result as T;
}

function StyleFormFields({
  idPrefix, draft, errors, templates, onChange, nameRef,
}: {
  idPrefix: string;
  draft: StyleDraft;
  errors: DraftErrors;
  templates: WorkspaceTemplate[];
  onChange: (next: StyleDraft) => void;
  nameRef?: React.Ref<HTMLInputElement>;
}): React.ReactElement {
  const setField = <K extends keyof StyleDraft>(field: K, value: StyleDraft[K]) => onChange({ ...draft, [field]: value });
  const toggleTemplate = (templateId: string) => {
    const next = draft.sourceTemplateIds.includes(templateId)
      ? draft.sourceTemplateIds.filter(id => id !== templateId)
      : [...draft.sourceTemplateIds, templateId];
    setField("sourceTemplateIds", next);
  };
  const errorId = (field: keyof StyleDraft | "form") => `${idPrefix}-${field}-error`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {errors.form && <div id={errorId("form")} role="alert" style={{ color: "#fca5a5", fontSize: 11 }}>{errors.form}</div>}
      <div>
        <label htmlFor={`${idPrefix}-name`} style={{ fontSize: 11, color: "#aaa", marginBottom: 4, display: "block" }}>Nombre del estilo *</label>
        <input
          ref={nameRef}
          id={`${idPrefix}-name`}
          value={draft.name}
          onChange={event => setField("name", event.target.value)}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? errorId("name") : undefined}
          autoComplete="off"
          style={inputStyle}
        />
        {errors.name && <div id={errorId("name")} role="alert" style={{ color: "#fca5a5", fontSize: 11, marginTop: 4 }}>{errors.name}</div>}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-description`} style={{ fontSize: 11, color: "#aaa", marginBottom: 4, display: "block" }}>Descripción</label>
        <textarea id={`${idPrefix}-description`} value={draft.description} onChange={event => setField("description", event.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
      </div>
      <fieldset style={{ margin: 0, padding: 10, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6 }} aria-describedby={errors.sourceTemplateIds ? errorId("sourceTemplateIds") : undefined}>
        <legend style={{ padding: "0 4px", fontSize: 11, color: "#aaa" }}>Diseños fuente * ({draft.sourceTemplateIds.length} seleccionados)</legend>
        {templates.length === 0 ? (
          <div role="status" style={{ color: "#fca5a5", fontSize: 11 }}>No hay diseños disponibles en este workspace.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 144, overflowY: "auto" }}>
            {templates.map(template => (
              <label key={template.id} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 40, cursor: "pointer", fontSize: 11 }}>
                <input type="checkbox" checked={draft.sourceTemplateIds.includes(template.id)} onChange={() => toggleTemplate(template.id)} />
                <span>{template.name}</span>
              </label>
            ))}
          </div>
        )}
        {errors.sourceTemplateIds && <div id={errorId("sourceTemplateIds")} role="alert" style={{ color: "#fca5a5", fontSize: 11 }}>{errors.sourceTemplateIds}</div>}
      </fieldset>
      <div>
        <label htmlFor={`${idPrefix}-tokens`} style={{ fontSize: 11, color: "#aaa", marginBottom: 4, display: "block" }}>tokens.json</label>
        <textarea
          id={`${idPrefix}-tokens`}
          value={draft.tokensJson}
          onChange={event => setField("tokensJson", event.target.value)}
          aria-invalid={Boolean(errors.tokensJson)}
          aria-describedby={errors.tokensJson ? errorId("tokensJson") : undefined}
          placeholder='{ "color": { ... } }'
          rows={4}
          style={{ ...inputStyle, fontFamily: "monospace", fontSize: 10, resize: "vertical" }}
        />
        {errors.tokensJson && <div id={errorId("tokensJson")} role="alert" style={{ color: "#fca5a5", fontSize: 11 }}>{errors.tokensJson}</div>}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-css`} style={{ fontSize: 11, color: "#aaa", marginBottom: 4, display: "block" }}>shared.css</label>
        <textarea id={`${idPrefix}-css`} value={draft.sharedCss} onChange={event => setField("sharedCss", event.target.value)} placeholder=":root { --color-... }" rows={4} style={{ ...inputStyle, fontFamily: "monospace", fontSize: 10, resize: "vertical" }} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-design`} style={{ fontSize: 11, color: "#aaa", marginBottom: 4, display: "block" }}>DESIGN.md</label>
        <textarea id={`${idPrefix}-design`} value={draft.designMd} onChange={event => setField("designMd", event.target.value)} placeholder="# Referencia visual..." rows={4} style={{ ...inputStyle, fontFamily: "monospace", fontSize: 10, resize: "vertical" }} />
      </div>
    </div>
  );
}

export function StyleLibraryPanel({
  workspaceId, onToast, onPublish, publishing,
  onSaveKeyVisual, saveRecipeMsg, selectedFrameCount, onOpenTemplate,
  onAssetUploaded, onManageStorage, selectedImageSrc,
}: Props) {
  const [styles, setStyles] = useState<BrandStyle[]>([]);
  const [workspaceTemplates, setWorkspaceTemplates] = useState<WorkspaceTemplate[]>([]);
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [stylesError, setStylesError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [tab, setTab] = useState<"library" | "keyvisuals" | "assets">("library");
  const [showUpload, setShowUpload] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [dupGroups, setDupGroups] = useState<any[]>([]);
  const [dupLoading, setDupLoading] = useState(false);
  const [capturingName, setCapturingName] = useState(false);
  const [captureName, setCaptureName] = useState("");
  const [captureError, setCaptureError] = useState("");
  const [uploadData, setUploadData] = useState<StyleDraft>(emptyDraft);
  const [uploadErrors, setUploadErrors] = useState<DraftErrors>({});
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<StyleDraft>(emptyDraft);
  const [editErrors, setEditErrors] = useState<DraftErrors>({});
  const [busyStyleId, setBusyStyleId] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);

  const [keyVisuals, setKeyVisuals] = useState<KeyVisual[]>([]);
  const [kvLoading, setKvLoading] = useState(false);
  const [kvBusyId, setKvBusyId] = useState<string | null>(null);

  // ── Load all styles + lock state ──
  const loadStyles = useCallback(async () => {
    setLoading(true);
    setStylesError("");
    try {
      const [brandsData, activeData, templatesData] = await Promise.all([
        callStyleMcp<{ brands?: BrandStyle[] }>("list_brand_guidelines", { workspaceId, includeArtifacts: true }),
        callStyleMcp<{ styles?: BrandStyle[] }>("get_active_styles", { workspaceId }),
        callStyleMcp<{ data?: WorkspaceTemplate[]; templates?: WorkspaceTemplate[] }>("list_templates", { workspaceId, limit: 1000 }),
      ]);
      const allStyles = Array.isArray(brandsData?.brands) ? brandsData.brands : [];
      const active = Array.isArray(activeData?.styles) ? activeData.styles : [];
      const templates = Array.isArray(templatesData?.data)
        ? templatesData.data
        : Array.isArray(templatesData?.templates) ? templatesData.templates : [];
      const availableTemplateIds = new Set(templates.map(template => template.id));
      setStyles(allStyles);
      setLockedIds(new Set(active.filter(style => isUsableStyle(style, availableTemplateIds)).map(style => style.id)));
      setWorkspaceTemplates(templates.filter(template => template?.id && template?.name));
    } catch (error) {
      const message = errorMessage(error, "No se pudo cargar la biblioteca de estilos.");
      setStylesError(message);
      onToast?.(message, "error");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, onToast]);

  useEffect(() => { loadStyles(); }, [loadStyles]);

  // ── Load Key Visuals (this workspace only) ──
  const loadKeyVisuals = useCallback(async () => {
    setKvLoading(true);
    try {
      const res = await apiFetch<{ success: boolean; data: KeyVisual[] }>(`/api/recipes?workspaceId=${encodeURIComponent(workspaceId)}`);
      setKeyVisuals(res.data || []);
    } catch {
      onToast?.("Failed to load Key Visuals", "error");
    }
    setKvLoading(false);
  }, [workspaceId, onToast]);

  useEffect(() => { if (tab === "keyvisuals") loadKeyVisuals(); }, [tab, loadKeyVisuals]);

  const handleAddKeyVisual = useCallback(async () => {
    await onSaveKeyVisual();
    loadKeyVisuals();
  }, [onSaveKeyVisual, loadKeyVisuals]);

  const handleUseKeyVisual = useCallback(async (id: string) => {
    setKvBusyId(id);
    try {
      const res = await apiFetch<{ success: boolean; data: { templateId: string } }>(`/api/recipes/${id}/execute`, {
        method: "POST",
        body: JSON.stringify({ variables: {} }),
      });
      if (res.data?.templateId) onOpenTemplate?.(res.data.templateId);
    } catch {
      onToast?.("Failed to create from Key Visual", "error");
    }
    setKvBusyId(null);
  }, [onToast, onOpenTemplate]);

  const handleDeleteKeyVisual = useCallback(async (id: string) => {
    try {
      await apiFetch(`/api/recipes/${id}`, { method: "DELETE" });
      setKeyVisuals(prev => prev.filter(k => k.id !== id));
    } catch {
      onToast?.("Failed to delete Key Visual", "error");
    }
  }, [onToast]);

  // ── Toggle lock ──
  const toggleLock = useCallback(async (style: BrandStyle, currentlyLocked: boolean) => {
    const availableTemplateIds = new Set(workspaceTemplates.map(template => template.id));
    if (!isUsableStyle(style, availableTemplateIds)) {
      setCardErrors(previous => ({ ...previous, [style.id]: "Este estilo está incompleto y no puede usarse hasta que tenga artifacts y un diseño fuente." }));
      return;
    }
    try {
      setBusyStyleId(style.id);
      setCardErrors(previous => ({ ...previous, [style.id]: "" }));
      await callStyleMcp("set_style_lock", { workspaceId, brandId: style.id, locked: !currentlyLocked });
      setLockedIds(prev => {
        const next = new Set(prev);
        if (currentlyLocked) next.delete(style.id);
        else next.add(style.id);
        return next;
      });
      onToast?.(
        currentlyLocked ? "Style unlocked" : "Style locked — AI will use this style",
        currentlyLocked ? "info" : "success"
      );
    } catch (error) {
      const message = errorMessage(error, "No se pudo cambiar el bloqueo del estilo.");
      setCardErrors(previous => ({ ...previous, [style.id]: message }));
      onToast?.(message, "error");
    } finally {
      setBusyStyleId(null);
    }
  }, [workspaceId, workspaceTemplates, onToast]);

  // ── Download template ──
  const downloadTemplate = useCallback(async () => {
    try {
      const data = await callStyleMcp<{ content?: string; filename?: string }>("download_style_template", {});
      if (data?.content) {
        const blob = new Blob([data.content], { type: "application/json" });
        downloadBlob(blob, data.filename || "tokens-template.json");
        onToast?.("tokens-template.json downloaded! Fill it with Gemini and upload back.", "success");
      }
    } catch {
      onToast?.("Failed to download template", "error");
    }
  }, [onToast]);

  const validateDraft = useCallback((draft: StyleDraft, currentId?: string): DraftErrors => {
    const errors: DraftErrors = {};
    const normalizedName = normalizeStyleName(draft.name);
    if (!normalizedName) {
      errors.name = "Escribe un nombre para el estilo.";
    } else if (styles.some(style => style.id !== currentId && normalizeStyleName(style.name) === normalizedName)) {
      errors.name = "Ya existe un estilo con ese nombre en este workspace.";
    }
    if (draft.sourceTemplateIds.length === 0) {
      errors.sourceTemplateIds = "Selecciona al menos un diseño fuente.";
    }
    if (!hasStyleArtifacts(draft)) {
      errors.form = "Agrega al menos una referencia: tokens JSON, DESIGN.md o CSS compartido.";
    }
    if (draft.tokensJson.trim()) {
      try {
        JSON.parse(draft.tokensJson);
      } catch {
        errors.tokensJson = "El JSON de tokens no es válido.";
      }
    }
    return errors;
  }, [styles]);

  // ── Upload style ──
  const handleUpload = useCallback(async () => {
    const errors = validateDraft(uploadData);
    setUploadErrors(errors);
    if (Object.keys(errors).length > 0) return;
    try {
      setUploading(true);
      setStatusMessage("");
      const data = await callStyleMcp<{ id?: string; brand?: BrandStyle }>("create_brand_guideline", {
        workspaceId,
        name: uploadData.name.trim(),
        description: uploadData.description.trim() || undefined,
        tokensJson: uploadData.tokensJson.trim() || undefined,
        designMd: uploadData.designMd.trim() || undefined,
        sharedCss: uploadData.sharedCss.trim() || undefined,
        sourceTemplateIds: uploadData.sourceTemplateIds,
      });
      if (data?.id || data?.brand?.id) {
        const message = `Estilo "${uploadData.name.trim()}" creado.`;
        onToast?.(message, "success");
        setStatusMessage(message);
        setUploadData(emptyDraft());
        setUploadErrors({});
        setShowUpload(false);
        await loadStyles();
      }
    } catch (error) {
      const message = errorMessage(error, "No se pudo crear el estilo.");
      setUploadErrors({ form: message });
      onToast?.(message, "error");
    } finally {
      setUploading(false);
    }
  }, [workspaceId, uploadData, onToast, loadStyles, validateDraft]);

  // ── Handle file upload (tokens.json or .md) ──
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (file.name.endsWith(".json")) {
        try {
          JSON.parse(content); // validate
          setUploadData(prev => ({ ...prev, tokensJson: content }));
          const baseName = file.name.replace(/\.json$/i, "");
          if (!uploadData.name) setUploadData(prev => ({ ...prev, name: baseName }));
          onToast?.(`Loaded ${file.name}`, "success");
        } catch {
          onToast?.("Invalid JSON file", "error");
        }
      } else if (file.name.endsWith(".md") || file.name.endsWith(".css")) {
        if (file.name.endsWith(".md")) {
          setUploadData(prev => ({ ...prev, designMd: content }));
        } else {
          setUploadData(prev => ({ ...prev, sharedCss: content }));
        }
        const baseName = file.name.replace(/\.(md|css)$/i, "");
        if (!uploadData.name) setUploadData(prev => ({ ...prev, name: baseName }));
        onToast?.(`Loaded ${file.name}`, "success");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset
  }, [uploadData.name, onToast]);

  const beginEdit = useCallback((style: BrandStyle) => {
    setEditingId(style.id);
    setEditData({
      name: style.name || "",
      description: style.description || "",
      tokensJson: style.tokensJson || "",
      designMd: style.designMd || "",
      sharedCss: style.sharedCss || "",
      sourceTemplateIds: Array.isArray(style.sourceTemplateIds) ? [...style.sourceTemplateIds] : [],
    });
    setEditErrors({});
    setCardErrors(previous => ({ ...previous, [style.id]: "" }));
    window.setTimeout(() => editNameRef.current?.focus(), 0);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    const errors = validateDraft(editData, editingId);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setBusyStyleId(editingId);
    try {
      await callStyleMcp("update_brand_guideline", {
        workspaceId,
        brandId: editingId,
        name: editData.name.trim(),
        description: editData.description.trim(),
        tokensJson: editData.tokensJson.trim(),
        designMd: editData.designMd.trim(),
        sharedCss: editData.sharedCss.trim(),
        sourceTemplateIds: editData.sourceTemplateIds,
      });
      const message = `Estilo "${editData.name.trim()}" actualizado.`;
      setStatusMessage(message);
      onToast?.(message, "success");
      setEditingId(null);
      setEditData(emptyDraft());
      await loadStyles();
    } catch (error) {
      const message = errorMessage(error, "No se pudo actualizar el estilo.");
      setEditErrors({ form: message });
      onToast?.(message, "error");
    } finally {
      setBusyStyleId(null);
    }
  }, [editingId, editData, loadStyles, onToast, validateDraft, workspaceId]);

  const deleteStyle = useCallback(async (style: BrandStyle) => {
    const confirmed = window.confirm(`¿Eliminar el estilo "${style.name}"? Los diseños existentes conservarán su última copia del estilo.`);
    if (!confirmed) return;
    setBusyStyleId(style.id);
    setCardErrors(previous => ({ ...previous, [style.id]: "" }));
    try {
      await callStyleMcp("delete_brand_guideline", { workspaceId, brandId: style.id });
      if (editingId === style.id) {
        setEditingId(null);
        setEditData(emptyDraft());
      }
      const message = `Estilo "${style.name}" eliminado.`;
      setStatusMessage(message);
      onToast?.(message, "success");
      await loadStyles();
    } catch (error) {
      const message = errorMessage(error, "No se pudo eliminar el estilo.");
      setCardErrors(previous => ({ ...previous, [style.id]: message }));
      onToast?.(message, "error");
    } finally {
      setBusyStyleId(null);
    }
  }, [editingId, loadStyles, onToast, workspaceId]);

  const publishCapturedStyle = useCallback(async () => {
    const name = captureName.trim();
    if (!name) {
      setCaptureError("Escribe un nombre para el estilo.");
      return;
    }
    const matches = styles.filter(style => normalizeStyleName(style.name) === normalizeStyleName(name));
    if (matches.length > 1) {
      setCaptureError("Hay más de un estilo con ese nombre. Consolídalos antes de recapturar.");
      return;
    }
    setCaptureError("");
    const ok = await onPublish!(name);
    if (ok) {
      setStatusMessage(matches.length === 1
        ? `Estilo "${matches[0].name}" recapturado y actualizado.`
        : `Estilo "${name}" capturado.`);
      setCapturingName(false);
      setCaptureName("");
      await loadStyles();
    }
  }, [captureName, loadStyles, onPublish, styles]);

  // ── Find duplicates ──
  const findDuplicates = useCallback(async () => {
    setDupLoading(true);
    try {
      const data = await callStyleMcp<{ groups?: any[] }>("find_duplicate_styles", { workspaceId });
      setDupGroups(data?.groups || []);
      if ((data?.groups || []).length === 0) {
        onToast?.("No duplicate styles found — all unique!", "success");
      }
    } catch {
      onToast?.("Failed to find duplicates", "error");
    }
    setDupLoading(false);
  }, [workspaceId, onToast]);

  // ── Merge duplicates ──
  const handleMerge = useCallback(async (targetId: string, sourceIds: string[]) => {
    if (!window.confirm(`¿Fusionar ${sourceIds.length} estilo(s) en el seleccionado? Los registros de origen se eliminarán.`)) return;
    try {
      await callStyleMcp("merge_brand_guidelines", {
        workspaceId,
        targetBrandId: targetId,
        sourceBrandIds: sourceIds,
      });
      onToast?.(`Merged ${sourceIds.length} styles into one`, "success");
      loadStyles();
      findDuplicates();
    } catch {
      onToast?.("Merge failed", "error");
    }
  }, [workspaceId, onToast, loadStyles, findDuplicates]);

  // ── Extract colors from tokens for preview (v1 + v2 compat) ──
  const extractColors = useCallback((tokensJson?: string): string[] => {
    if (!tokensJson) return [];
    try {
      const parsed = JSON.parse(tokensJson);
      const colors: string[] = [];
      if (parsed.color) {
        Object.values(parsed.color).forEach((v: any) => {
          const hex = v?.$value || v;
          if (typeof hex === "string" && hex.startsWith("#")) colors.push(hex);
        });
      }
      return colors.slice(0, 6);
    } catch { return []; }
  }, []);

  // ── Extract fonts from tokens for preview (v1 + v2 compat) ──
  const extractFonts = useCallback((tokensJson?: string): string[] => {
    if (!tokensJson) return [];
    try {
      const parsed = JSON.parse(tokensJson);
      const fonts: string[] = [];
      if (parsed.typography) {
        if (Array.isArray(parsed.typography.families)) {
          parsed.typography.families.forEach((f: any) => {
            if (f?.name && !fonts.includes(f.name)) fonts.push(f.name);
          });
        }
        if (parsed.typography.fontFamily) {
          Object.values(parsed.typography.fontFamily).forEach((v: any) => {
            const name = v?.$value || v;
            if (typeof name === "string" && !fonts.includes(name)) fonts.push(name);
          });
        }
      }
      return fonts.slice(0, 4);
    } catch { return []; }
  }, []);

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    ...btnStyle,
    background: active ? "rgba(200,184,152,0.2)" : "transparent",
    borderBottom: active ? "2px solid #c8b898" : "2px solid transparent",
    borderRadius: 0, border: "none", flex: 1,
  });
  const availableTemplateIds = new Set(workspaceTemplates.map(template => template.id));

  return (
    <div style={panelStyle}>
      {lockedIds.size > 0 && (
        <div style={{ padding: "8px 12px 0" }}>
          <span style={{
            background: "rgba(200,184,152,0.2)", color: "#dcd0b5",
            border: "1px solid rgba(200,184,152,0.3)",
            borderRadius: 12, padding: "2px 10px", fontSize: 10, fontWeight: 600,
          }}>
            {lockedIds.size} LOCKED
          </span>
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" aria-label="Biblioteca" style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <button type="button" role="tab" id="style-library-tab" aria-selected={tab === "library"} aria-controls="style-library-panel" style={tabBtnStyle(tab === "library")} onClick={() => setTab("library")} title="Brand Guidelines extraídas de tus diseños">
          🎨 Estilos
        </button>
        <button type="button" role="tab" id="style-keyvisuals-tab" aria-selected={tab === "keyvisuals"} aria-controls="style-keyvisuals-panel" style={tabBtnStyle(tab === "keyvisuals")} onClick={() => setTab("keyvisuals")} title="Key Visuals — diseños completos reutilizables">
          🖼 Plantillas
        </button>
        <button type="button" role="tab" id="style-assets-tab" aria-selected={tab === "assets"} aria-controls="style-assets-panel" style={tabBtnStyle(tab === "assets")} onClick={() => setTab("assets")} title="Assets de marca: logos, patrones, fondos">
          📦 Recursos
        </button>
      </div>

      {/* Content */}
      <div id={`style-${tab}-panel`} role="tabpanel" aria-labelledby={`style-${tab}-tab`} aria-busy={tab === "library" && loading} style={tab === "assets" ? { flex: 1, overflow: "hidden", display: "flex" } : { flex: 1, overflow: "auto", padding: 12 }}>
        {tab === "library" ? (
          /* ── Estilos Tab ── */
          loading ? (
            <div role="status" aria-live="polite" style={{ textAlign: "center", padding: 40, color: "#888" }}>Cargando estilos…</div>
          ) : (
          <div>
            <div aria-live="polite" role="status" style={{ minHeight: statusMessage ? 24 : 0, color: "#86efac", fontSize: 11, marginBottom: statusMessage ? 8 : 0 }}>
              {statusMessage}
            </div>
            {stylesError && <div role="alert" style={{ color: "#fca5a5", fontSize: 11, marginBottom: 10 }}>{stylesError}</div>}
            <div style={{ marginBottom: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {onPublish && !capturingName && (
                <button
                  type="button"
                  onClick={() => { setCapturingName(true); setCaptureError(""); }}
                  disabled={publishing || selectedFrameCount === 0}
                  title={selectedFrameCount === 0 ? "Selecciona uno o varios frames en el lienzo primero" : undefined}
                  style={{ ...btnStyle, opacity: publishing || selectedFrameCount === 0 ? 0.5 : 1, cursor: selectedFrameCount === 0 ? "not-allowed" : "pointer" }}
                >
                  {publishing ? "⏳ Capturando..." : `📸 Capturar estilo${selectedFrameCount > 0 ? ` (${selectedFrameCount} frame${selectedFrameCount > 1 ? "s" : ""})` : ""}`}
                </button>
              )}
              <button type="button" onClick={downloadTemplate} style={btnStyle}>
                📄 tokens-template.json
              </button>
              <button type="button" aria-expanded={showUpload} aria-controls="style-manual-upload" onClick={() => { setShowUpload(v => !v); setUploadErrors({}); }} style={btnStyle}>
                ⬆ {showUpload ? "Cancelar subida" : "Subir estilo manual"}
              </button>
              {styles.length > 1 && (
                <button
                  type="button"
                  onClick={() => { const next = !showDuplicates; setShowDuplicates(next); if (next) findDuplicates(); }}
                  style={btnStyle}
                >
                  🔀 {showDuplicates ? "Ocultar duplicados" : "Buscar duplicados"}
                </button>
              )}
            </div>

            {onPublish && capturingName && (
              <div style={{
                marginBottom: 12, padding: 10, borderRadius: 8,
                background: "rgba(200,184,152,0.06)", border: "1px solid rgba(200,184,152,0.2)",
              }}>
                <div style={{ fontSize: 11, color: "#999", marginBottom: 6 }}>
                  Nombre del estilo — usa <code>Marca_Propósito</code>. Los nombres se comparan sin distinguir
                  mayúsculas ni espacios externos. Si ya existe, recapturar actualiza explícitamente ese registro.
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <label htmlFor="style-capture-name" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>Nombre del estilo</label>
                  <input
                    id="style-capture-name"
                    autoFocus
                    value={captureName}
                    onChange={e => { setCaptureName(e.target.value); setCaptureError(""); }}
                    onKeyDown={e => { if (e.key === "Enter") publishCapturedStyle(); if (e.key === "Escape") { setCapturingName(false); setCaptureName(""); setCaptureError(""); } }}
                    aria-invalid={Boolean(captureError)}
                    aria-describedby={captureError ? "style-capture-error" : undefined}
                    placeholder="Marca_Propósito"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    id="style-capture-confirm"
                    type="button"
                    disabled={!captureName.trim() || publishing}
                    onClick={publishCapturedStyle}
                    style={{ ...btnStyle, background: "rgba(200,184,152,0.2)", borderColor: "rgba(200,184,152,0.3)", opacity: !captureName.trim() || publishing ? 0.5 : 1 }}
                  >
                    {publishing ? "…" : "Guardar"}
                  </button>
                  <button type="button" onClick={() => { setCapturingName(false); setCaptureName(""); setCaptureError(""); }} style={btnStyle}>
                    Cancelar
                  </button>
                </div>
                {captureError && <div id="style-capture-error" role="alert" style={{ color: "#fca5a5", fontSize: 11, marginTop: 6 }}>{captureError}</div>}
              </div>
            )}
            {onPublish && !capturingName && (
              <div style={{ fontSize: 10, color: "#666", marginBottom: 12, lineHeight: 1.5 }}>
                Extrae colores, tipografía y CSS de <strong>los frames que tengas seleccionados en el lienzo</strong> y
                los guarda con el nombre que elijas — un nombre nuevo crea una entrada nueva; un nombre que ya existe
                actualiza esa misma entrada.
              </div>
            )}

            {showUpload && (
              <div id="style-manual-upload" style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12 }}>💡 Cómo funciona</div>
                <div style={{ fontSize: 11, color: "#999", lineHeight: 1.5, marginBottom: 8 }}>
                  1. Descarga <code>tokens-template.json</code> arriba<br/>
                  2. Pégalo en Gemini/ChatGPT junto con imágenes de tu diseño<br/>
                  3. Pide que complete cada campo <code>$value</code> según las imágenes<br/>
                  4. Guarda el resultado como <code>.json</code> y súbelo aquí
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-describedby="style-upload-file-help"
                  style={{
                    width: "100%", minHeight: 72, background: "transparent", color: "inherit",
                    border: "2px dashed rgba(255,255,255,0.15)", borderRadius: 8,
                    padding: 20, textAlign: "center", cursor: "pointer", marginBottom: 12,
                    fontFamily: "inherit",
                  }}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "#c8b898"; }}
                  onDragLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
                  onDrop={e => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
                    const file = e.dataTransfer.files[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const content = ev.target?.result as string;
                        if (file.name.endsWith(".json")) {
                          setUploadData(prev => ({ ...prev, tokensJson: content, name: prev.name || file.name.replace(/\.json$/i, "") }));
                        } else if (file.name.endsWith(".md")) {
                          setUploadData(prev => ({ ...prev, designMd: content, name: prev.name || file.name.replace(/\.md$/i, "") }));
                        } else if (file.name.endsWith(".css")) {
                          setUploadData(prev => ({ ...prev, sharedCss: content, name: prev.name || file.name.replace(/\.css$/i, "") }));
                        }
                        onToast?.(`Loaded ${file.name}`, "success");
                      };
                      reader.readAsText(file);
                    }
                  }}
                >
                  <div style={{ fontSize: 22, marginBottom: 4 }}>📁</div>
                  <div id="style-upload-file-help" style={{ fontSize: 12, color: "#aaa" }}>
                    Suelta archivos aquí o haz clic para buscar<br/>
                    <span style={{ fontSize: 10 }}>Soporta: .json (tokens), .md (design ref), .css (variables)</span>
                  </div>
                </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.md,.css"
                    onChange={handleFileUpload}
                    style={{ display: "none" }}
                  />

                <StyleFormFields
                  idPrefix="style-upload"
                  draft={uploadData}
                  errors={uploadErrors}
                  templates={workspaceTemplates}
                  onChange={next => { setUploadData(next); setUploadErrors({}); }}
                />

                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={uploading}
                  style={{
                    ...btnStyle,
                    opacity: uploading ? 0.5 : 1,
                    background: "rgba(200,184,152,0.2)",
                    borderColor: "rgba(200,184,152,0.3)",
                    width: "100%", fontWeight: 600,
                  }}
                >
                  {uploading ? "Guardando…" : "Crear estilo"}
                </button>
              </div>
            )}

            {styles.length === 0 && !showUpload ? (
              <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎨</div>
                <div>No styles yet. Capture one from the current design, or upload one.</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  Usa "📸 Capturar estilo" arriba, o "⬆ Subir estilo manual".
                </div>
              </div>
            ) : styles.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {styles.map(style => {
                  const isLocked = lockedIds.has(style.id);
                  const usable = isUsableStyle(style, availableTemplateIds);
                  const colors = extractColors(style.tokensJson);
                  const fonts = extractFonts(style.tokensJson);
                  const isBusy = busyStyleId === style.id;
                  const isEditing = editingId === style.id;
                  return (
                    <section
                      key={style.id}
                      aria-labelledby={`style-name-${style.id}`}
                      style={{
                        ...cardStyle,
                        borderColor: !usable ? "rgba(248,113,113,0.45)" : isLocked ? "rgba(200,184,152,0.5)" : "rgba(255,255,255,0.08)",
                        background: !usable ? "rgba(248,113,113,0.04)" : isLocked ? "rgba(200,184,152,0.05)" : "rgba(255,255,255,0.04)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <div id={`style-name-${style.id}`} style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                          {style.name}
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleLock(style, isLocked)}
                          disabled={!usable || isBusy}
                          aria-pressed={isLocked}
                          style={{
                            background: isLocked ? "rgba(200,184,152,0.3)" : "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 4, padding: "6px 10px", minHeight: 40,
                            fontSize: 11, cursor: !usable || isBusy ? "not-allowed" : "pointer", color: isLocked ? "#dcd0b5" : "#aaa",
                            opacity: !usable || isBusy ? 0.5 : 1,
                            fontFamily: "inherit", whiteSpace: "nowrap",
                          }}
                          title={!usable ? "Completa el estilo antes de bloquearlo" : isLocked ? "Desbloquear estilo" : "Bloquear: la IA deberá usar este estilo"}
                        >
                          {isLocked ? "🔒 Bloqueado" : "🔓 Bloquear"}
                        </button>
                      </div>

                      {!usable && <div role="alert" style={{ color: "#fca5a5", fontSize: 11, marginBottom: 8 }}>Estilo inválido: necesita artifacts y al menos un diseño fuente. No se enviará a la IA.</div>}
                      {style.description && <p style={{ color: "#aaa", fontSize: 11, lineHeight: 1.5, margin: "0 0 8px", overflowWrap: "anywhere" }}>{style.description}</p>}

                      {colors.length > 0 && (
                        <div aria-label="Colores del estilo" style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                          {colors.map((hex, i) => (
                            <div key={`${hex}-${i}`} role="img" aria-label={`Color ${hex}`} style={{
                              width: 24, height: 24, borderRadius: 4,
                              background: hex,
                              border: "1px solid rgba(255,255,255,0.15)",
                            }} />
                          ))}
                        </div>
                      )}

                      {fonts.length > 0 && (
                        <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>
                          {fonts.join(" · ")}
                        </div>
                      )}

                      <div style={{ fontSize: 10, color: "#888", lineHeight: 1.5 }}>
                        {(style.sourceTemplateIds || []).length} diseño(s) fuente
                        {style.styleFingerprint && (
                          <span> · FP: {style.styleFingerprint.substring(0, 8)}...</span>
                        )}
                        {style.updatedAt && <span> · Actualizado {new Date(style.updatedAt).toLocaleDateString()}</span>}
                      </div>

                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button type="button" onClick={() => isEditing ? setEditingId(null) : beginEdit(style)} disabled={isBusy} aria-expanded={isEditing} aria-controls={`style-edit-${style.id}`} style={{ ...btnStyle, flex: 1 }}>
                          {isEditing ? "Cerrar edición" : "Editar"}
                        </button>
                        <button type="button" onClick={() => deleteStyle(style)} disabled={isBusy} style={{ ...btnStyle, flex: 1, color: "#fca5a5", borderColor: "rgba(248,113,113,0.3)" }}>
                          {isBusy ? "Procesando…" : "Eliminar"}
                        </button>
                      </div>

                      {cardErrors[style.id] && <div role="alert" style={{ color: "#fca5a5", fontSize: 11, marginTop: 8 }}>{cardErrors[style.id]}</div>}

                      {isEditing && (
                        <div id={`style-edit-${style.id}`} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                          <StyleFormFields idPrefix={`style-edit-${style.id}`} draft={editData} errors={editErrors} templates={workspaceTemplates} onChange={next => { setEditData(next); setEditErrors({}); }} nameRef={editNameRef} />
                          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                            <button type="button" onClick={saveEdit} disabled={isBusy} style={{ ...btnStyle, flex: 1, background: "rgba(200,184,152,0.2)" }}>{isBusy ? "Guardando…" : "Guardar cambios"}</button>
                            <button type="button" onClick={() => { setEditingId(null); setEditData(emptyDraft()); setEditErrors({}); }} disabled={isBusy} style={{ ...btnStyle, flex: 1 }}>Cancelar</button>
                          </div>
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}

            {/* ── Duplicates (inline, toggled) ── */}
            {showDuplicates && (
              <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
                <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 12, color: "#888" }}>
                    {dupGroups.length > 0
                      ? `${dupGroups.length} group(s) of duplicate styles found`
                      : dupLoading ? "Checking for duplicates..." : "No duplicates found."}
                  </div>
                  <button onClick={findDuplicates} style={{ ...btnStyle, fontSize: 11 }}>
                    ↻ Refresh
                  </button>
                </div>

                {dupGroups.map((group, gi) => (
                  <div key={gi} style={{
                    ...cardStyle, cursor: "default",
                    marginBottom: 12,
                    borderColor: "rgba(251,191,36,0.2)",
                    background: "rgba(251,191,36,0.03)",
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, color: "#fbbf24" }}>
                      Group {gi + 1}: {group.count} duplicate styles
                    </div>
                    <div style={{ fontSize: 10, color: "#666", marginBottom: 8 }}>
                      Fingerprint: {group.fingerprint.substring(0, 16)}...
                    </div>
                    {group.brands.map((b: any, bi: number) => (
                      <div key={b.id} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 8px", marginBottom: 4,
                        background: "rgba(255,255,255,0.03)", borderRadius: 4,
                      }}>
                        <input
                          type="radio"
                          name={`group-${gi}`}
                          defaultChecked={bi === 0}
                          id={`brand-${b.id}`}
                          style={{ accentColor: "#c8b898" }}
                        />
                        <label htmlFor={`brand-${b.id}`} style={{ fontSize: 12, flex: 1, cursor: "pointer" }}>
                          {b.name} <span style={{ color: "#666", fontSize: 10 }}>
                            ({(b.sourceTemplateIds || []).length} templates)
                          </span>
                        </label>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const radios = document.querySelectorAll(`input[name="group-${gi}"]`);
                        let targetId = group.brands[0].id;
                        radios.forEach((r, ri) => {
                          if ((r as HTMLInputElement).checked) targetId = group.brands[ri].id;
                        });
                        const sourceIds = group.brands
                          .map((b: any) => b.id)
                          .filter((id: string) => id !== targetId);
                        handleMerge(targetId, sourceIds);
                      }}
                      style={{
                        ...btnStyle,
                        marginTop: 8, fontSize: 11, width: "auto",
                        background: "rgba(251,191,36,0.1)",
                        borderColor: "rgba(251,191,36,0.2)",
                      }}
                    >
                      🔀 Merge into selected
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          )
        ) : tab === "keyvisuals" ? (
          /* ── Key Visuals Tab ── */
          <div>
            <button
              onClick={handleAddKeyVisual}
              disabled={selectedFrameCount === 0}
              style={{
                ...btnStyle, width: "100%", fontWeight: 600, marginBottom: 4,
                background: selectedFrameCount > 0 ? "rgba(200,184,152,0.2)" : "rgba(255,255,255,0.04)",
                borderColor: selectedFrameCount > 0 ? "rgba(200,184,152,0.3)" : "rgba(255,255,255,0.08)",
                color: selectedFrameCount > 0 ? "#e0e0e0" : "#666",
                cursor: selectedFrameCount > 0 ? "pointer" : "not-allowed",
              }}
            >
              ➕ Agregar como Key Visual{selectedFrameCount > 1 ? ` (${selectedFrameCount} frames)` : ""}
            </button>
            <div style={{ fontSize: 10, color: "#666", marginBottom: 12, lineHeight: 1.5 }}>
              {selectedFrameCount === 0
                ? "Selecciona uno o varios frames en el lienzo para guardarlos como Key Visual."
                : `Se guardará${selectedFrameCount > 1 ? "n" : ""} ${selectedFrameCount} frame(s) seleccionado(s), diseño completo (HTML+CSS), como plantilla reusable.`}
            </div>
            {saveRecipeMsg && (
              <div style={{ fontSize: 11, marginBottom: 12, color: saveRecipeMsg.startsWith("✓") ? "#4ade80" : "#f87171" }}>
                {saveRecipeMsg}
              </div>
            )}

            {kvLoading ? (
              <div style={{ textAlign: "center", padding: 40, color: "#666" }}>Loading...</div>
            ) : keyVisuals.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#666" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎬</div>
                <div>No Key Visuals yet.</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {keyVisuals.map(kv => {
                  const frameCount = kv.structure?.frames?.length || 1;
                  return (
                    <div key={kv.id} style={{ ...cardStyle, cursor: "default" }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{kv.name}</div>
                      <div style={{ fontSize: 10, color: "#666", marginBottom: 8 }}>
                        {frameCount} frame(s)
                        {kv.created_at && <span> · {new Date(kv.created_at).toLocaleDateString()}</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => handleUseKeyVisual(kv.id)}
                          disabled={kvBusyId === kv.id}
                          style={{ ...btnStyle, fontSize: 11, flex: 1, background: "rgba(200,184,152,0.15)", borderColor: "rgba(200,184,152,0.25)" }}
                        >
                          {kvBusyId === kv.id ? "…" : "▶ Usar"}
                        </button>
                        <button
                          onClick={() => handleDeleteKeyVisual(kv.id)}
                          style={{ ...btnStyle, fontSize: 11, color: "#f87171", borderColor: "rgba(239,68,68,0.2)" }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* ── Recursos Tab (Assets de marca: logos, patrones, fondos) ── */
          <AssetsPanel
            workspaceId={workspaceId}
            onAssetUploaded={onAssetUploaded}
            onManageStorage={onManageStorage}
            selectedImageSrc={selectedImageSrc}
          />
        )}
      </div>
    </div>
  );
}
