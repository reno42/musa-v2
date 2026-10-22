/**
 * MobileSheet — bottom sheet del inspector en móvil (VID12, ≤768px): el
 * panel derecho pasa abajo con tres tabs — Props (InspectorPanel), Efectos
 * (EffectPicker) y Estilo (editor de estilo del texto, vía material.patch:
 * el payload del material viaja en el diff del autosave — NO es server-first).
 */
import type { VideoApplyMeta, VideoProjectDoc } from "../../lib/videoProjectStore";
import { EffectPicker } from "./EffectPicker";
import { InspectorPanel } from "./InspectorPanel";
import { findSegment, materialMap } from "./videoDocOps";

export type MobileSheetTab = "props" | "effects" | "style";

interface MobileSheetProps {
  open: boolean;
  tab: MobileSheetTab;
  doc: VideoProjectDoc;
  selectedSegmentId: string | null;
  onTabChange: (tab: MobileSheetTab) => void;
  onClose: () => void;
  onDocChange: (next: VideoProjectDoc, meta: VideoApplyMeta) => void;
  onServerDocChange: (next: VideoProjectDoc, meta: VideoApplyMeta) => void;
  onDelete: (segmentId: string) => void;
}

const TABS: Array<{ id: MobileSheetTab; label: string }> = [
  { id: "props", label: "Props" },
  { id: "effects", label: "Efectos" },
  { id: "style", label: "Estilo" },
];

/** Estilo del texto = payload.style del material (color/size/weight). Viaja
 *  como material.patch del autosave — undoable por snapshot como el resto. */
function TextStyleEditor({ doc, segmentId, onDocChange }: {
  doc: VideoProjectDoc;
  segmentId: string | null;
  onDocChange: (next: VideoProjectDoc, meta: VideoApplyMeta) => void;
}) {
  const seg = findSegment(doc, segmentId);
  const material = seg ? materialMap(doc).get(seg.material_id) ?? null : null;
  if (!seg || !material || material.kind !== "text") {
    return <p className="vp-hint">Elegí un clip de texto para editar su estilo.</p>;
  }
  const payload = material.payload as { text?: unknown; style?: Record<string, unknown> };
  const style = payload.style ?? {};
  const commit = (patch: Record<string, unknown>) => {
    const next: VideoProjectDoc = {
      ...doc,
      materials: doc.materials.map((m) => (m.id === material.id
        ? { ...m, payload: { ...m.payload, style: { ...style, ...patch } } }
        : m)),
    };
    onDocChange(next, { label: "estilo de texto", coalesceKey: `style:${material.id}` });
  };
  const fontSize = typeof style.fontSize === "number" ? style.fontSize : 0.12;
  const weight = typeof style.fontWeight === "number" ? style.fontWeight : 700;
  const color = typeof style.color === "string" ? style.color : "#ffffff";
  return (
    <div className="vp-style-editor">
      <label className="vp-field">
        <span>Color</span>
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#ffffff"} onChange={(e) => commit({ color: e.target.value })} aria-label="Color del texto" />
      </label>
      <label className="vp-field">
        <span>Tamaño ({Math.round(fontSize * 100)}%)</span>
        <input
          type="range"
          min={0.04}
          max={0.28}
          step={0.01}
          value={fontSize}
          onChange={(e) => commit({ fontSize: Number(e.target.value) })}
          aria-label="Tamaño del texto"
        />
      </label>
      <label className="vp-field">
        <span>Peso ({weight})</span>
        <input
          type="range"
          min={100}
          max={900}
          step={100}
          value={weight}
          onChange={(e) => commit({ fontWeight: Number(e.target.value) })}
          aria-label="Peso del texto"
        />
      </label>
      <p className="vp-hint">El estilo vive en el payload del material (rangos por caracteres vía MCP conservan el resto).</p>
    </div>
  );
}

export function MobileSheet({ open, tab, doc, selectedSegmentId, onTabChange, onClose, onDocChange, onServerDocChange, onDelete }: MobileSheetProps) {
  if (!open) return null;
  return (
    <div className="vp-sheet" role="dialog" aria-label="Propiedades del clip">
      <div className="vp-sheet-grab" aria-hidden="true" />
      <div className="vp-sheet-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "vp-sheet-tab vp-sheet-tab-active" : "vp-sheet-tab"}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button type="button" className="vp-sheet-close" onClick={onClose} aria-label="Cerrar panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
        </button>
      </div>
      <div className="vp-sheet-body">
        {tab === "props" && (
          <InspectorPanel
            doc={doc}
            segmentId={selectedSegmentId}
            onDocChange={onDocChange}
            onDelete={onDelete}
          />
        )}
        {tab === "effects" && (
          <EffectPicker
            doc={doc}
            selectedSegmentId={selectedSegmentId}
            onServerDocChange={onServerDocChange}
            onError={(msg) => console.error("[MobileSheet]", msg)}
          />
        )}
        {tab === "style" && (
          <TextStyleEditor doc={doc} segmentId={selectedSegmentId} onDocChange={onDocChange} />
        )}
      </div>
    </div>
  );
}
