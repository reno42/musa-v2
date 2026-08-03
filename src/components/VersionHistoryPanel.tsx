import { useState, useCallback, useEffect } from "react";
import { getApiHeaders } from "../lib/apiKey";

interface Props {
  templateId: string;
  onRestore: () => void;
}

interface Version {
  id: string;
  kind: "auto" | "marked";
  label: string | null;
  author: string;
  frameCount: number;
  sizeBytes: number;
  createdAt: string;
}

/** "human:uuid" / "agent:lara" → something a person can read at a glance. */
function describeAuthor(author: string): { icon: string; name: string; color: string } {
  const [role, ...rest] = (author || "unknown").split(":");
  const who = rest.join(":");
  if (role === "human") {
    return { icon: "👤", name: who && who !== "local" ? `Humano (${who.slice(0, 12)})` : "Humano", color: "#7dd3fc" };
  }
  if (role === "agent") {
    return { icon: "🤖", name: who ? who.replace(/-/g, " ") : "Agente", color: "#dcd0b5" };
  }
  return { icon: "•", name: author || "desconocido", color: "#9ca3af" };
}

function fmtSize(bytes: number): string {
  if (!bytes) return "";
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;
}

function fmtWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "hace un momento";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(iso).toLocaleDateString();
}

export function VersionHistoryPanel({ templateId, onRestore }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${templateId}/versions`, { headers: getApiHeaders() });
      const json = await res.json();
      if (json.success) setVersions(json.data || []);
      else setError(json.error || "No se pudo cargar el historial");
    } catch {
      setError("No se pudo cargar el historial");
    }
    setLoading(false);
  }, [templateId]);

  useEffect(() => { load(); }, [load]);

  // Any explicit save adds a version — refresh so the panel is never stale.
  useEffect(() => {
    const onSaved = () => load();
    window.addEventListener("futuraria-version-saved", onSaved);
    return () => window.removeEventListener("futuraria-version-saved", onSaved);
  }, [load]);

  const saveNow = useCallback(async () => {
    setBusyId("new");
    try {
      await fetch(`/api/templates/${templateId}/versions`, {
        method: "POST",
        headers: { ...getApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "marked", label: "Versión guardada" }),
      });
      await load();
    } catch { setError("No se pudo guardar la versión"); }
    setBusyId(null);
  }, [templateId, load]);

  const restore = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/templates/${templateId}/versions/${id}/restore`, {
        method: "POST",
        headers: { ...getApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success) { onRestore(); await load(); }
      else setError(json.error || "No se pudo restaurar");
    } catch { setError("No se pudo restaurar"); }
    setBusyId(null);
  }, [templateId, onRestore, load]);

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Historial</span>
        <button type="button" onClick={saveNow} disabled={busyId !== null} style={saveBtnStyle}>
          {busyId === "new" ? "Guardando…" : "Guardar versión"}
        </button>
      </div>

      <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 10, lineHeight: 1.5 }}>
        Ctrl/⌘+S guarda una versión permanente. Las automáticas se rotan (últimas 10).
      </div>

      {error && <div style={{ color: "#f87171", fontSize: 11, marginBottom: 8 }}>{error}</div>}
      {loading && <div style={{ color: "#666", fontSize: 11 }}>Cargando…</div>}
      {!loading && versions.length === 0 && !error && (
        <div style={{ color: "#666", fontSize: 11 }}>
          Todavía no hay versiones. Pulsa Ctrl/⌘+S para guardar la primera.
        </div>
      )}

      {versions.map(v => {
        const who = describeAuthor(v.author);
        const isMarked = v.kind === "marked";
        return (
          <div key={v.id} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
            padding: "7px 8px", marginBottom: 4, borderRadius: 6,
            background: isMarked ? "rgba(200,184,152,0.10)" : "rgba(255,255,255,0.03)",
            border: isMarked ? "1px solid rgba(200,184,152,0.25)" : "1px solid transparent",
          }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span title={isMarked ? "Versión marcada — no se borra" : "Guardado automático"}>
                  {isMarked ? "🔖" : "🕘"}
                </span>
                <span style={{ color: who.color, fontSize: 11, fontWeight: 500 }}>
                  {who.icon} {who.name}
                </span>
              </div>
              <div style={{ color: "#6b7280", fontSize: 10, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {fmtWhen(v.createdAt)} · {v.frameCount} frame{v.frameCount === 1 ? "" : "s"}
                {v.sizeBytes ? ` · ${fmtSize(v.sizeBytes)}` : ""}
                {v.label ? ` · ${v.label}` : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={() => restore(v.id)}
              disabled={busyId !== null}
              style={{ ...btnStyle, width: "auto", padding: "4px 10px", fontSize: 10, opacity: busyId === v.id ? 0.5 : 1 }}
            >
              {busyId === v.id ? "…" : "Restaurar"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: "transparent", padding: "10px 12px",
  color: "#e0e0e0", fontSize: 12, overflow: "auto", flex: 1, minHeight: 0,
};

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)", color: "#ccc",
  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4,
  padding: "6px 10px", fontSize: 11, cursor: "pointer",
  fontFamily: "inherit", width: "100%", textAlign: "left",
};

const saveBtnStyle: React.CSSProperties = {
  background: "rgba(200,184,152,0.2)", color: "#dcd0b5",
  border: "1px solid rgba(200,184,152,0.4)", borderRadius: 100,
  padding: "4px 12px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
  fontWeight: 600, whiteSpace: "nowrap",
};
