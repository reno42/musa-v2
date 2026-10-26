/**
 * Research — el intake del flujo editorial (REQ-051).
 *
 * Fuentes RSS/Nitter que el cron del Worker barre cada 5 min; cada noticia
 * llega como tarjeta. El botón «Generar contenido» NO llama a un LLM: crea un
 * encargo (research_requests) cuyo briefing la IA del usuario —conectada al
 * harness MCP— descubre con research_ai_tasks y entrega con
 * research_ai_complete. Mismo contrato D1 de REQ-042: la IA trabaja con SU
 * suscripción; aquí solo se encarga y se muestra el estado.
 *
 * Mismas filas que las tools research_* (doble puerta, como copy_recipes) y
 * el mismo kit de vidrio del resto de Copywriting (v55): controles redondeados,
 * separadores suaves, PeekPanel para el detalle del encargo.
 */

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { PeekHead, PeekPanel } from "./PeekPanel";
import { RESEARCH_FORMATS, RESEARCH_NETWORKS } from "../../shared/researchNetworks";

interface ResearchSourceRow {
  id: string;
  name: string;
  url: string;
  type: "rss" | "nitter";
  include_keywords: string[];
  refresh_minutes: number;
  active: boolean;
  last_fetched_at: string | null;
  last_status: "ok" | "error" | null;
  last_error: string | null;
}

interface ResearchItemRow {
  id: string;
  source_id: string;
  title: string;
  summary: string | null;
  link: string;
  image_url: string | null;
  source_name: string | null;
  published_at: string | null;
  status: "new" | "used" | "dismissed";
  created_at: string;
}

interface ResearchRequestRow {
  id: string;
  item_id: string;
  status: "pending" | "done" | "error";
  briefing: string;
  networks: string[];
  formats: string[];
  include_design: boolean;
  result: { entries?: Array<{ entryId?: string; network?: string; format?: string }>; notes?: string } | null;
  error: string | null;
  created_at: string;
}

const btn: React.CSSProperties = {
  padding: "8px 14px", fontSize: 12.5, fontFamily: "inherit",
  color: "#d4d4d8", background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 100, cursor: "pointer",
};

const control: React.CSSProperties = {
  padding: "6px 10px", fontSize: 12, fontFamily: "inherit",
  color: "#e4e4e7", background: "#18181b",
  border: "1px solid #3f3f46", borderRadius: 8, cursor: "pointer",
};

const field: React.CSSProperties = {
  width: "100%", background: "transparent", color: "#fff",
  border: "1px solid transparent", borderRadius: 6,
  padding: "3px 4px", fontSize: 12.5, fontFamily: "inherit", outline: "none",
};

const chip = (bg: string, fg: string): React.CSSProperties => ({
  fontSize: 10, padding: "2px 8px", borderRadius: 100, background: bg, color: fg,
  whiteSpace: "nowrap",
});

const STATUS_CHIP: Record<string, React.CSSProperties> = {
  new: chip("rgba(210,255,2,0.12)", "rgba(210,255,2,0.85)"),
  used: chip("rgba(255,255,255,0.06)", "rgba(255,255,255,0.55)"),
  dismissed: chip("rgba(255,255,255,0.04)", "rgba(255,255,255,0.35)"),
  pending: chip("rgba(245,176,46,0.12)", "rgba(245,176,46,0.9)"),
  done: chip("rgba(210,255,2,0.12)", "rgba(210,255,2,0.85)"),
  error: chip("rgba(255,120,120,0.12)", "rgba(255,150,150,0.9)"),
};
const STATUS_LABEL: Record<string, string> = {
  new: "Nueva", used: "Usada", dismissed: "Descartada",
  pending: "Encargado", done: "Listo", error: "Error",
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es", { day: "2-digit", month: "short" });
};

/** Latest request per item — the card shows ITS state (Encargado/Listo/Error). */
function latestRequestByItem(requests: ResearchRequestRow[]): Record<string, ResearchRequestRow> {
  const byItem: Record<string, ResearchRequestRow> = {};
  for (const r of requests) {
    if (!byItem[r.item_id]) byItem[r.item_id] = r; // list comes newest-first
  }
  return byItem;
}

export function ResearchTab({ workspaceId, actions }: { workspaceId: string | null; actions?: React.ReactNode }) {
  const [sources, setSources] = useState<ResearchSourceRow[]>([]);
  const [items, setItems] = useState<ResearchItemRow[]>([]);
  const [requests, setRequests] = useState<ResearchRequestRow[]>([]);
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Alta de fuente: URL + nombre (+ keywords opcional). Enter crea.
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newKeywords, setNewKeywords] = useState("");

  // Modal de generación: qué producir de ESTA tarjeta.
  const [genItem, setGenItem] = useState<ResearchItemRow | null>(null);
  const [genNetworks, setGenNetworks] = useState<string[]>([]);
  const [genFormats, setGenFormats] = useState<string[]>([]);
  const [genDesign, setGenDesign] = useState(false);
  const [genBrandId, setGenBrandId] = useState("");
  const [genNotes, setGenNotes] = useState("");
  const [genBusy, setGenBusy] = useState(false);

  // Detalle del encargo (briefing completo, copiable como fallback manual).
  const [peekRequestId, setPeekRequestId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError("");
    try {
      const [srcRes, itemRes, reqRes] = await Promise.all([
        apiFetch<{ success?: boolean; data?: ResearchSourceRow[]; error?: string }>(
          `/api/research/sources?workspaceId=${encodeURIComponent(workspaceId)}`),
        apiFetch<{ success?: boolean; data?: ResearchItemRow[]; error?: string }>(
          `/api/research/items?workspaceId=${encodeURIComponent(workspaceId)}&limit=60`),
        apiFetch<{ success?: boolean; data?: ResearchRequestRow[]; error?: string }>(
          `/api/research/requests?workspaceId=${encodeURIComponent(workspaceId)}`),
      ]);
      if (srcRes?.success === false) throw new Error(srcRes.error || "El servidor rechazó la carga");
      if (itemRes?.success === false) throw new Error(itemRes.error || "El servidor rechazó la carga");
      setSources(Array.isArray(srcRes?.data) ? srcRes.data : []);
      setItems(Array.isArray(itemRes?.data) ? itemRes.data : []);
      setRequests(Array.isArray(reqRes?.data) ? reqRes.data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el research");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  // Brands for the encargo modal — the same list the calendar filters by.
  useEffect(() => {
    if (!workspaceId) return;
    void apiFetch<{ data?: Array<{ id: string; name: string }> }>(`/api/workspaces/${workspaceId}/brands`)
      .then(res => setBrands(Array.isArray(res?.data) ? res.data : []))
      .catch(() => { /* the pane still works brandless */ });
  }, [workspaceId]);

  const addSource = useCallback(async () => {
    if (!workspaceId || !newUrl.trim() || !newName.trim()) return;
    setError(""); setNotice("");
    try {
      const res = await apiFetch<{ success?: boolean; data?: ResearchSourceRow; warning?: string; error?: string }>(
        "/api/research/sources",
        { method: "POST", body: JSON.stringify({
          workspaceId,
          name: newName.trim(),
          url: newUrl.trim(),
          type: "rss",
          includeKeywords: newKeywords.split(",").map(k => k.trim().toLowerCase()).filter(Boolean),
        }) },
      );
      if (res?.success === false) throw new Error(res.error || "El servidor rechazó la fuente");
      setNotice(res?.warning || `Fuente agregada: ${newName.trim()}`);
      setNewName(""); setNewUrl(""); setNewKeywords("");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo agregar la fuente");
    }
  }, [workspaceId, newName, newUrl, newKeywords, load]);

  const removeSource = useCallback(async (id: string) => {
    if (!window.confirm("¿Eliminar esta fuente? Sus tarjetas se borran también.")) return;
    const before = sources;
    setSources(cur => cur.filter(s => s.id !== id));
    try {
      await apiFetch(`/api/research/sources/${id}`, { method: "DELETE" });
      void load();
    } catch (e) {
      setSources(before);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sources, load]);

  const refreshAll = useCallback(async () => {
    if (!workspaceId || refreshing) return;
    setRefreshing(true); setError(""); setNotice("");
    try {
      const res = await apiFetch<{ success?: boolean; data?: { refreshed: number; added: number }; error?: string }>(
        "/api/research/sources/refresh",
        { method: "POST", body: JSON.stringify({ workspaceId }) },
      );
      if (res?.success === false) throw new Error(res.error || "El refresh falló");
      setNotice(`Fuentes leídas: ${res?.data?.refreshed ?? 0} — ${res?.data?.added ?? 0} tarjeta(s) nueva(s)`);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo refrescar");
    } finally {
      setRefreshing(false);
    }
  }, [workspaceId, refreshing, load]);

  const setItemStatus = useCallback(async (id: string, status: ResearchItemRow["status"]) => {
    const before = items;
    setItems(cur => cur.map(r => (r.id === id ? { ...r, status } : r)));
    try {
      const res = await apiFetch<{ success?: boolean; error?: string }>(`/api/research/items/${id}`, {
        method: "PATCH", body: JSON.stringify({ status }),
      });
      if (res?.success === false) throw new Error(res.error || "El servidor rechazó el cambio");
    } catch (e) {
      setItems(before);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [items]);

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  };

  const openGenerate = (item: ResearchItemRow) => {
    setGenItem(item);
    setGenNetworks(["linkedin"]);           // un default sensato; el usuario ajusta
    setGenFormats(["post"]);
    setGenDesign(false);
    setGenBrandId("");
    setGenNotes("");
  };

  const createRequest = useCallback(async () => {
    if (!workspaceId || !genItem || !genNetworks.length || !genFormats.length) return;
    setGenBusy(true); setError("");
    try {
      const res = await apiFetch<{ success?: boolean; data?: ResearchRequestRow; error?: string }>(
        "/api/research/requests",
        { method: "POST", body: JSON.stringify({
          workspaceId,
          itemId: genItem.id,
          networks: genNetworks,
          formats: genFormats,
          includeDesign: genDesign,
          brandId: genBrandId || null,
          notes: genNotes.trim() || null,
        }) },
      );
      if (res?.success === false) throw new Error(res.error || "El servidor rechazó el encargo");
      if (res?.data) setRequests(cur => [res.data as ResearchRequestRow, ...cur]);
      setNotice("Encargo creado: tu IA conectada lo tomará de la bandeja (research_ai_tasks).");
      setGenItem(null);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el encargo");
    } finally {
      setGenBusy(false);
    }
  }, [workspaceId, genItem, genNetworks, genFormats, genDesign, genBrandId, genNotes, load]);

  const copyBriefing = useCallback(async (request: ResearchRequestRow) => {
    try {
      await navigator.clipboard.writeText(request.briefing);
      setNotice("Briefing copiado: pégalo en tu IA si prefieres atenderlo a mano.");
    } catch {
      setError("No se pudo copiar el briefing (permisos del navegador)");
    }
  }, []);

  const visible = items.filter(r => !statusFilter || r.status === statusFilter);
  const requestByItem = latestRequestByItem(requests);
  const peekRequest = peekRequestId ? requests.find(r => r.id === peekRequestId) ?? null : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Barra de fuentes: alta por URL y chips con el diagnóstico del sweep. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
      }}>
        <input value={newName} placeholder="Nombre de la fuente (ej. TechCrunch)" className="ct-input"
          style={{ width: 210 }} aria-label="Nombre de la fuente"
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") void addSource(); }} />
        <input value={newUrl} placeholder="URL del feed RSS (https://…)" className="ct-input"
          style={{ width: 300 }} aria-label="URL del feed"
          onChange={e => setNewUrl(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") void addSource(); }} />
        <input value={newKeywords} placeholder="keywords, separadas, por coma (opcional)" className="ct-input"
          style={{ width: 250 }} aria-label="Keywords de filtro"
          onChange={e => setNewKeywords(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") void addSource(); }} />
        <button type="button" className="ct-chip" disabled={!newName.trim() || !newUrl.trim()}
          style={{ opacity: newName.trim() && newUrl.trim() ? 1 : 0.4 }}
          onClick={() => void addSource()}>+ Agregar fuente</button>
        <div style={{ flex: 1 }} />
        <button type="button" className="ct-chip" onClick={() => void refreshAll()} disabled={refreshing}>
          {refreshing ? "Leyendo…" : "Refrescar ahora"}
        </button>
        {actions}
      </div>

      {sources.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
          padding: "6px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
        }}>
          {sources.map(s => (
            <span key={s.id} style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11,
              padding: "3px 9px", borderRadius: 100,
              border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)",
            }}
              title={s.last_status === "error" && s.last_error
                ? `Último error: ${s.last_error}`
                : `Última lectura: ${fmtDate(s.last_fetched_at)} · cada ${s.refresh_minutes || 60} min`}>
              <span aria-hidden="true" style={{
                width: 7, height: 7, borderRadius: 100,
                background: !s.active ? "rgba(255,255,255,0.25)"
                  : s.last_status === "error" ? "#f5b02e" : s.last_status === "ok" ? "#d2ff02" : "rgba(255,255,255,0.25)",
              }} />
              {s.name}
              <button type="button" aria-label={`Eliminar fuente ${s.name}`}
                onClick={() => void removeSource(s.id)}
                style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", padding: 0, fontSize: 12 }}>×</button>
            </span>
          ))}
        </div>
      )}

      <div style={{
        padding: "8px 16px", fontSize: 12, color: "rgba(255,255,255,0.45)",
        borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
      }}>
        Las noticias llegan solas del cron (RSS y X vía Nitter). «Generar contenido» crea un
        encargo para tu IA conectada —vía MCP, sin tokens de proveedores— que redacta el copy
        por red, crea las entradas de calendario y, si quieres, clona la plantilla maestra para
        los diseños. Tú revisas y publicas.
      </div>

      {(error || notice) && (
        <div role={error ? "alert" : undefined} style={{
          padding: "8px 16px", fontSize: 12, color: "#fff",
          background: error ? "rgba(255,120,120,0.10)" : "rgba(210,255,2,0.08)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex", gap: 10, alignItems: "center",
        }}>
          <span style={{ flex: 1 }}>{error || notice}</span>
          <button type="button" onClick={() => { setError(""); setNotice(""); }} style={btn}>Cerrar</button>
        </div>
      )}

      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0,
      }}>
        <select value={statusFilter} className="ct-input" style={{ cursor: "pointer" }} aria-label="Estado"
          onChange={e => setStatusFilter(e.target.value)}>
          <option value="" style={{ background: "#18181b" }}>Todos los estados</option>
          <option value="new" style={{ background: "#18181b" }}>Nuevas</option>
          <option value="used" style={{ background: "#18181b" }}>Usadas</option>
          <option value="dismissed" style={{ background: "#18181b" }}>Descartadas</option>
        </select>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
          {visible.length} de {items.length} tarjetas
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" className="ct-chip" onClick={() => void load()}>Recargar</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "12px 16px 20px" }}>
        {loading ? (
          <div style={{ padding: 24, color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Cargando…</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: 24, color: "rgba(255,255,255,0.4)", fontSize: 13, maxWidth: 560 }}>
            {items.length === 0
              ? "Sin tarjetas todavía. Agrega una fuente RSS arriba (o pídeselo a tu IA con research_add_source) y el cron traerá las noticias en el siguiente barrido."
              : "Nada con este filtro."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 }}>
            {visible.map(item => {
              const request = requestByItem[item.id];
              const reqState = item.status === "dismissed" ? null : request?.status;
              return (
                <div key={item.id} style={{
                  display: "flex", flexDirection: "column", gap: 8,
                  border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12,
                  background: "rgba(255,255,255,0.03)", overflow: "hidden",
                }}>
                  {item.image_url && (
                    <img src={item.image_url} alt="" loading="lazy"
                      style={{ width: "100%", height: 130, objectFit: "cover", display: "block", opacity: 0.9 }}
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px 12px", flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={STATUS_CHIP[item.status]}>{STATUS_LABEL[item.status]}</span>
                      {reqState && request && (
                        <button type="button" title="Ver el detalle del encargo (briefing y entrega)"
                          onClick={() => setPeekRequestId(request.id)}
                          style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
                          <span style={STATUS_CHIP[reqState]}>{STATUS_LABEL[reqState]}</span>
                        </button>
                      )}
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                        {item.source_name || "research"} · {fmtDate(item.published_at || item.created_at)}
                      </span>
                    </div>
                    <a href={item.link} target="_blank" rel="noreferrer noopener"
                      style={{ fontSize: 13, fontWeight: 600, color: "#fff", textDecoration: "none", lineHeight: 1.35 }}>
                      {item.title}
                    </a>
                    {item.summary && (
                      <span style={{
                        fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.45,
                        display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
                      }}>{item.summary}</span>
                    )}
                    {request?.status === "done" && request.result?.entries?.length ? (
                      <span style={{ fontSize: 11, color: "rgba(210,255,2,0.75)" }}>
                        {request.result.entries.length} pieza(s) en el calendario
                      </span>
                    ) : null}
                    <div style={{ display: "flex", gap: 6, marginTop: "auto", flexWrap: "wrap" }}>
                      {item.status !== "dismissed" ? (
                        <>
                          <button type="button" className="ct-chip" onClick={() => openGenerate(item)}>
                            Generar contenido
                          </button>
                          {request && (
                            <button type="button" className="ct-chip" title="Copia el briefing para atenderlo a mano"
                              onClick={() => void copyBriefing(request)}>Copiar briefing</button>
                          )}
                          <button type="button" className="ct-chip" title="No quiero esta noticia"
                            onClick={() => void setItemStatus(item.id, "dismissed")}>Descartar</button>
                        </>
                      ) : (
                        <button type="button" className="ct-chip"
                          onClick={() => void setItemStatus(item.id, "new")}>Restaurar</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de generación: redes × formatos + marca + notas → un encargo. */}
      {genItem && (
        <div role="dialog" aria-modal="true" aria-label="Generar contenido desde la noticia"
          onKeyDown={e => { if (e.key === "Escape") setGenItem(null); }}
          onClick={e => { if (e.target === e.currentTarget) setGenItem(null); }}
          style={{
            position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", padding: 20,
          }}>
          <div style={{
            width: 560, maxWidth: "100%", maxHeight: "86vh", overflow: "auto",
            background: "#111116", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 14, padding: 18,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", lineHeight: 1.35 }}>{genItem.title}</div>
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)", marginTop: 3 }}>
                  {genItem.source_name || "research"} · {fmtDate(genItem.published_at || genItem.created_at)}
                </div>
              </div>
              <button type="button" onClick={() => setGenItem(null)} aria-label="Cerrar"
                style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 18, cursor: "pointer" }}>×</button>
            </div>

            <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "rgba(255,255,255,0.4)" }}>Redes</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {RESEARCH_NETWORKS.map(n => (
                    <button key={n.id} type="button" title={n.note} aria-pressed={genNetworks.includes(n.id)}
                      onClick={() => toggle(genNetworks, setGenNetworks, n.id)}
                      style={{
                        ...btn,
                        ...(genNetworks.includes(n.id)
                          ? { background: "rgba(210,255,2,0.14)", borderColor: "rgba(210,255,2,0.4)", color: "#e8ffa8" }
                          : {}),
                      }}>{n.label}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "rgba(255,255,255,0.4)" }}>Formatos</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {RESEARCH_FORMATS.map(f => (
                    <button key={f.id} type="button" title={`${f.note} (${f.width}x${f.height})`} aria-pressed={genFormats.includes(f.id)}
                      onClick={() => toggle(genFormats, setGenFormats, f.id)}
                      style={{
                        ...btn,
                        ...(genFormats.includes(f.id)
                          ? { background: "rgba(210,255,2,0.14)", borderColor: "rgba(210,255,2,0.4)", color: "#e8ffa8" }
                          : {}),
                      }}>{f.label}</button>
                  ))}
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#e4e4e7", cursor: "pointer" }}>
                <input type="checkbox" checked={genDesign} onChange={e => setGenDesign(e.target.checked)} />
                Incluir diseños (clona la plantilla maestra de cada formato)
              </label>
              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "rgba(255,255,255,0.4)" }}>Marca</span>
                <select value={genBrandId} style={{ ...control, width: "100%" }} aria-label="Marca del encargo"
                  onChange={e => setGenBrandId(e.target.value)}>
                  <option value="" style={{ background: "#18181b" }}>Sin marca (tono general)</option>
                  {brands.map(b => <option key={b.id} value={b.id} style={{ background: "#18181b" }}>{b.name}</option>)}
                </select>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "rgba(255,255,255,0.4)" }}>Notas para la IA</span>
                <textarea value={genNotes} rows={2} placeholder="Ángulo, campaña, tono… (opcional)"
                  aria-label="Notas para la IA"
                  style={{ ...field, border: "1px solid rgba(255,255,255,0.16)", borderRadius: 8, padding: "8px 10px", resize: "vertical" }}
                  onChange={e => setGenNotes(e.target.value)} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" style={btn} onClick={() => setGenItem(null)}>Cancelar</button>
                <button type="button" className="ct-chip" disabled={genBusy || !genNetworks.length || !genFormats.length}
                  style={{ opacity: genNetworks.length && genFormats.length ? 1 : 0.4 }}
                  onClick={() => void createRequest()}>
                  {genBusy ? "Creando…" : "Encargar a mi IA"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detalle del encargo: briefing completo + resultado (fallback manual). */}
      <PeekPanel open={!!peekRequest} onClose={() => setPeekRequestId(null)} label="Detalle del encargo">
        {peekRequest && (() => {
          const item = items.find(i => i.id === peekRequest.item_id);
          return (<>
            <PeekHead label="Encargo de research" onClose={() => setPeekRequestId(null)} />
            <div style={{ padding: "12px 18px 26px", display: "grid", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={STATUS_CHIP[peekRequest.status]}>{STATUS_LABEL[peekRequest.status]}</span>
                {item && <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)" }}>{item.title}</span>}
              </div>
              <div className="peek-prop-row">
                <span className="peek-prop-label">Pedido</span>
                <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>
                  {peekRequest.networks.join(", ")} · {peekRequest.formats.join(", ")}
                  {peekRequest.include_design ? " · con diseños" : ""}
                </span>
              </div>
              {peekRequest.result?.entries?.length ? (
                <div style={{ display: "grid", gap: 4 }}>
                  <span className="peek-prop-label">Entregado</span>
                  {peekRequest.result.entries.map((e, i) => (
                    <span key={i} style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                      {e.network || "?"} / {e.format || "?"} → {e.entryId || "(sin id)"}
                    </span>
                  ))}
                  {peekRequest.result.notes && (
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>{peekRequest.result.notes}</span>
                  )}
                </div>
              ) : null}
              {peekRequest.error && (
                <span style={{ fontSize: 12, color: "rgba(255,150,150,0.85)" }}>{peekRequest.error}</span>
              )}
              <div style={{ display: "grid", gap: 6 }}>
                <span className="peek-prop-label">Briefing</span>
                <pre style={{
                  margin: 0, whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.5,
                  color: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.10)", borderRadius: 8, padding: 12,
                  maxHeight: 320, overflow: "auto",
                }}>{peekRequest.briefing}</pre>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="ct-chip" onClick={() => void copyBriefing(peekRequest)}>
                  Copiar briefing
                </button>
              </div>
            </div>
          </>);
        })()}
      </PeekPanel>
    </div>
  );
}
