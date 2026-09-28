/**
 * PhotoComposePanel — REQ-PHOTO-FASE4 (F4.2): panel de capas del Modo
 * Composición, estilo Photoshop: stack invertido (arriba = capa más alta),
 * ojo de visibilidad, blend, opacity, reordenar y borrar. La lista vive en
 * el padre (PhotoModeOverlay) — este panel es UI puro.
 */
import { COMPOSITION_BLENDS, type CompositionLayer } from "../../shared/photoComposition";

export interface PhotoComposePanelProps {
  layers: CompositionLayer[];
  activeId: string | null;
  saving: boolean;
  dirty: boolean;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<CompositionLayer>) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onSave: () => void;
}

const panelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", minHeight: 0, height: "100%",
};
const rowStyle = (active: boolean): React.CSSProperties => ({
  border: `1px solid ${active ? "#c8b898" : "rgba(255,255,255,0.08)"}`,
  borderRadius: 5,
  background: active ? "rgba(200,184,152,0.10)" : "rgba(255,255,255,0.02)",
  padding: "5px 7px",
  display: "flex", flexDirection: "column", gap: 4,
  cursor: "pointer",
});
const iconBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  color: "#cfc8bb", borderRadius: 4, fontSize: 10, padding: "2px 5px", cursor: "pointer",
};
const miniInput: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  color: "#e5ddcd", borderRadius: 4, fontSize: 10, padding: "2px 4px",
};

export function PhotoComposePanel(props: PhotoComposePanelProps) {
  // Stack top-first: la capa más alta se dibuja al principio de la lista.
  const ordered = [...props.layers].reverse();

  return (
    <div style={panelStyle} data-testid="photo-compose-panel">
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: "#8a8378", letterSpacing: 1, textTransform: "uppercase" }}>Capas</span>
        <div style={{ flex: 1 }} />
        <button type="button" style={iconBtn} onClick={props.onAdd} title="Nueva capa de pintura">＋ Capa</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {ordered.length === 0 && (
          <div style={{ fontSize: 10, color: "#6d675e", padding: "8px 2px" }}>
            Sin capas. Añade una y pinta sobre la foto con el pincel — la foto base nunca se toca.
          </div>
        )}
        {ordered.map(layer => {
          const active = layer.id === props.activeId;
          return (
            <div key={layer.id} style={rowStyle(active)} onClick={() => props.onSelect(layer.id)}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button
                  type="button" style={{ ...iconBtn, opacity: layer.visible ? 1 : 0.4 }}
                  title={layer.visible ? "Ocultar capa" : "Mostrar capa"}
                  onClick={e => { e.stopPropagation(); props.onPatch(layer.id, { visible: !layer.visible }); }}
                >👁</button>
                <span style={{
                  flex: 1, fontSize: 11, color: active ? "#e5ddcd" : "#b0a996",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  textDecoration: layer.visible ? "none" : "line-through",
                }}>{layer.name}</span>
                <button type="button" style={iconBtn} title="Subir"
                  onClick={e => { e.stopPropagation(); props.onMove(layer.id, 1); }}>▲</button>
                <button type="button" style={iconBtn} title="Bajar"
                  onClick={e => { e.stopPropagation(); props.onMove(layer.id, -1); }}>▼</button>
                <button type="button" style={iconBtn} title="Eliminar capa"
                  onClick={e => { e.stopPropagation(); props.onDelete(layer.id); }}>✕</button>
              </div>
              {active && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "2px 1px" }}
                  onClick={e => e.stopPropagation()}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 9, color: "#8a8378" }}>Blend</span>
                    <select
                      value={layer.blend}
                      onChange={e => props.onPatch(layer.id, { blend: e.target.value as CompositionLayer["blend"] })}
                      style={{ ...miniInput, flex: 1 }}
                    >
                      {COMPOSITION_BLENDS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 9, color: "#8a8378" }}>Opac</span>
                    <input
                      type="range" min={0} max={100} value={Math.round(layer.opacity * 100)}
                      onChange={e => props.onPatch(layer.id, { opacity: Number(e.target.value) / 100 })}
                      style={{ flex: 1, accentColor: "#c8b898" }}
                    />
                    <span style={{ fontSize: 9, color: "#b0a996", width: 26, textAlign: "right", fontFamily: "monospace" }}>
                      {Math.round(layer.opacity * 100)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          style={{
            flex: 1, background: props.dirty ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.05)",
            border: `1px solid ${props.dirty ? "rgba(99,102,241,0.55)" : "rgba(255,255,255,0.1)"}`,
            color: "#e0e7ff", borderRadius: 5, fontSize: 11, padding: "5px 8px",
            cursor: "pointer", fontWeight: props.dirty ? 600 : 400,
          }}
          disabled={props.saving || !props.dirty}
          onClick={props.onSave}
        >{props.saving ? "Guardando…" : "Guardar composición"}</button>
      </div>
      {props.dirty && (
        <div style={{ fontSize: 9, color: "#8a8378", marginTop: 4 }}>
          cambios sin guardar
        </div>
      )}
    </div>
  );
}
