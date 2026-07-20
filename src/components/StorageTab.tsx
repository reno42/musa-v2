import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getApiHeaders } from "../lib/apiKey";
import { useToast } from "./Toast";
import { playTrashSound, playRestoreSound, playEmptyTrashSound } from "../lib/uiSounds";

// ── Types ──

interface StorageFile {
  bucket: string; path: string; name: string;
  sizeBytes: number; mimeType: string; updatedAt: string | null; url: string;
}

interface DesignFile {
  id: string; name: string; thumbnail?: string | null;
  workspaceId: string; updatedAt?: string;
}

interface TrashTemplate {
  id: string; name: string; workspaceId?: string;
  createdAt: string; deletedAt: string;
}

interface TrashAsset {
  id: string; name: string; url: string; sizeBytes: number; deletedAt: string;
}

interface StorageSummary {
  totalBytes: number; totalFiles: number;
  buckets: Array<{ name: string; label: string; icon: string; assetCount: number; sizeBytes: number }>;
  trash: { templates: number; assets: number; total: number };
}

/** Anything the user can pick up and drop on the trash can. */
interface DragItem {
  kind: "template" | "bucketfile";
  id: string;            // template id, or `${bucket}:${path}`
  name: string;
  thumb: string | null;
  bucket?: string;
  path?: string;
}

// ── Helpers ──

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function daysLeft(deletedAt: string): number {
  const expires = new Date(deletedAt).getTime() + 30 * 86400000;
  return Math.max(0, Math.ceil((expires - Date.now()) / 86400000));
}

function daysLeftColor(days: number): string {
  if (days > 20) return "#4ade80";
  if (days > 10) return "#facc15";
  return "#f87171";
}

const BUCKET_LABELS: Record<string, string> = {
  "design-assets": "Imágenes",
  "design-covers": "Covers y thumbnails",
  "design-exports": "Exports",
};

// ── Component ──

export function StorageTab() {
  const { addToast } = useToast();

  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [bucketFiles, setBucketFiles] = useState<StorageFile[]>([]);
  const [designFiles, setDesignFiles] = useState<DesignFile[]>([]);
  const [trashTemplates, setTrashTemplates] = useState<TrashTemplate[]>([]);
  const [trashAssets, setTrashAssets] = useState<TrashAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeBucket, setActiveBucket] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string; size?: number } | null>(null);
  const [purging, setPurging] = useState(false);

  // ── Drag-to-trash state ──
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [overTrash, setOverTrash] = useState(false);
  const [flying, setFlying] = useState(false); // ghost animating into the can
  const dragRef = useRef<{ item: DragItem; startX: number; startY: number; started: boolean } | null>(null);
  const trashRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);

  // ── Data fetching ──

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const headers = getApiHeaders();
    try {
      const [sumRes, filesRes, tplRes, trashTplRes, trashAssetRes] = await Promise.all([
        fetch("/api/storage/summary", { headers }).then(r => r.json()).catch(() => null),
        fetch("/api/storage/files", { headers }).then(r => r.json()).catch(() => null),
        fetch("/api/templates?limit=100", { headers }).then(r => r.json()).catch(() => null),
        fetch("/api/templates/trash?limit=100", { headers }).then(r => r.json()).catch(() => null),
        fetch("/api/assets/trash?limit=100", { headers }).then(r => r.json()).catch(() => null),
      ]);
      if (sumRes?.success) setSummary(sumRes.data);
      if (filesRes?.success) setBucketFiles(filesRes.data.files || []);
      if (tplRes?.success) {
        setDesignFiles((tplRes.data || []).map((t: any) => ({
          id: t.id, name: t.name, thumbnail: t.thumbnail || null,
          workspaceId: t.workspaceId, updatedAt: t.metadata?.updatedAt,
        })));
      }
      if (trashTplRes?.success) setTrashTemplates(trashTplRes.data || []);
      if (trashAssetRes?.success) setTrashAssets(trashAssetRes.data || []);
    } catch {
      addToast("No se pudo cargar Storage.", "error");
    }
    setLoading(false);
  }, [addToast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Delete / restore actions ──

  const deleteDragged = useCallback(async (item: DragItem) => {
    try {
      if (item.kind === "template") {
        const res = await fetch(`/api/templates/${item.id}`, { method: "DELETE", headers: getApiHeaders() });
        if (!res.ok) throw new Error();
        setDesignFiles(prev => prev.filter(d => d.id !== item.id));
        addToast(`"${item.name}" movido a la papelera.`, "success");
      } else {
        const res = await fetch("/api/storage/file", {
          method: "DELETE",
          headers: { ...getApiHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ bucket: item.bucket, path: item.path }),
        });
        if (!res.ok) throw new Error();
        setBucketFiles(prev => prev.filter(f => `${f.bucket}:${f.path}` !== item.id));
        addToast(`"${item.name}" eliminado (los archivos generados se regeneran solos).`, "success");
      }
      fetchAll();
    } catch {
      addToast("No se pudo eliminar. Intenta de nuevo.", "error");
      fetchAll();
    }
  }, [addToast, fetchAll]);

  const handleRestoreTemplate = async (id: string) => {
    playRestoreSound();
    try {
      await fetch(`/api/templates/${id}/restore`, { method: "PUT", headers: getApiHeaders() });
      addToast("Diseño restaurado.", "success");
      fetchAll();
    } catch { addToast("No se pudo restaurar.", "error"); }
  };

  const handleRestoreAsset = async (id: string) => {
    playRestoreSound();
    try {
      await fetch(`/api/assets/${id}/restore`, { method: "PUT", headers: getApiHeaders() });
      addToast("Archivo restaurado.", "success");
      fetchAll();
    } catch { addToast("No se pudo restaurar.", "error"); }
  };

  const handlePermanentDelete = async (type: "asset" | "template", id: string) => {
    playEmptyTrashSound();
    const endpoint = type === "asset" ? `/api/assets/${id}/permanent` : `/api/templates/${id}/permanent`;
    try {
      await fetch(endpoint, { method: "DELETE", headers: getApiHeaders() });
      addToast("Eliminado permanentemente.", "success");
      fetchAll();
    } catch { addToast("No se pudo eliminar.", "error"); }
  };

  const handlePurgeExpired = async () => {
    setPurging(true);
    playEmptyTrashSound();
    try {
      await Promise.all([
        fetch("/api/assets/trash/purge-expired", { method: "POST", headers: getApiHeaders() }),
        fetch("/api/templates/trash/purge-expired", { method: "POST", headers: getApiHeaders() }),
      ]);
      addToast("Papelera purgada (elementos expirados).", "success");
      fetchAll();
    } catch { addToast("La purga falló.", "error"); }
    setPurging(false);
  };

  // ── Pointer-based drag: pick up a card, carry a ghost, drop on the can ──

  const beginDrag = (item: DragItem, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { item, startX: e.clientX, startY: e.clientY, started: false };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.started) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 8) return;
        d.started = true;
        suppressClickRef.current = true;
        setDragItem(d.item);
      }
      setDragPos({ x: e.clientX, y: e.clientY });
      const can = trashRef.current?.getBoundingClientRect();
      if (can) {
        const cx = can.left + can.width / 2;
        const cy = can.top + can.height / 2;
        setOverTrash(Math.hypot(e.clientX - cx, e.clientY - cy) < 90);
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setTimeout(() => { suppressClickRef.current = false; }, 100);
      if (!d?.started) return;
      setOverTrash(prev => {
        if (prev && d) {
          // Drop on the can: fly-in animation + sound, then delete
          setFlying(true);
          playTrashSound();
          setTimeout(() => {
            setFlying(false);
            setDragItem(null);
            deleteDragged(d.item);
          }, 320);
        } else {
          setDragItem(null);
        }
        return false;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [deleteDragged]);

  // ── Derived ──

  const shownFiles = activeBucket ? bucketFiles.filter(f => f.bucket === activeBucket) : bucketFiles;
  const allTrash = [
    ...trashTemplates.map(t => ({ ...t, _type: "template" as const })),
    ...trashAssets.map(a => ({ ...a, _type: "asset" as const })),
  ].sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());

  const trashCanRect = trashRef.current?.getBoundingClientRect();

  // ── Render ──

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 2, repeat: Infinity }}
          style={{ color: "rgba(255,255,255,0.3)", fontSize: 14 }}>
          Cargando storage…
        </motion.div>
      </div>
    );
  }

  const sectionTitle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.3)",
    textTransform: "uppercase", letterSpacing: "0.05em", margin: 0,
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px 120px", maxWidth: 1080, margin: "0 auto", width: "100%" }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          Storage
        </h2>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
          {summary ? `${fmtBytes(summary.totalBytes)} · ${summary.totalFiles} archivos` : ""}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.3)", marginBottom: 20 }}>
        Arrastra cualquier archivo al tacho 🗑️ para eliminarlo — como en el Finder.
      </div>

      {/* ── Storage bar ── */}
      {summary && summary.totalBytes > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", height: 6, borderRadius: 100, overflow: "hidden", background: "rgba(255,255,255,0.05)", marginBottom: 8 }}>
            {summary.buckets.map((b, i) => {
              const pct = (b.sizeBytes / summary.totalBytes) * 100;
              if (pct < 1) return null;
              const colors = ["rgba(99,102,241,0.6)", "rgba(168,85,247,0.6)", "rgba(34,197,94,0.6)"];
              return <div key={b.name} style={{ width: `${pct}%`, height: "100%", background: colors[i] || colors[0], transition: "width 0.5s ease" }} />;
            })}
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
            {summary.buckets.map((b, i) => {
              const colors = ["#818cf8", "#a855f7", "#4ade80"];
              return (
                <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: colors[i] }} />
                  {b.label} {fmtBytes(b.sizeBytes)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Buckets ── */}
      <h3 style={{ ...sectionTitle, marginBottom: 10 }}>Buckets</h3>
      <div style={{ display: "flex", gap: 10, marginBottom: 28, overflowX: "auto", paddingBottom: 4 }}>
        {(summary?.buckets || []).map(bucket => (
          <motion.div
            key={bucket.name}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setActiveBucket(activeBucket === bucket.name ? null : bucket.name)}
            className="liquid-glass"
            style={{
              flex: "0 0 auto", minWidth: 160, padding: "14px 16px", borderRadius: 14,
              cursor: "pointer",
              border: activeBucket === bucket.name ? "1px solid rgba(129,140,248,0.4)" : "1px solid rgba(255,255,255,0.05)",
              transition: "all 0.2s ease",
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 6 }}>{bucket.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>{bucket.label}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
              {bucket.assetCount} archivos · {fmtBytes(bucket.sizeBytes)}
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── Design Files (templates) ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={sectionTitle}>📄 Archivos de diseño · {designFiles.length}</h3>
      </div>
      {designFiles.length === 0 ? (
        <div style={{ textAlign: "center", padding: 24, marginBottom: 28, color: "rgba(255,255,255,0.25)", fontSize: 12 }}>
          No hay diseños aún.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10, marginBottom: 32 }}>
          {designFiles.map(d => (
            <motion.div
              key={d.id}
              layout
              whileHover={{ scale: 1.04, y: -2 }}
              onPointerDown={(e) => beginDrag({ kind: "template", id: d.id, name: d.name, thumb: d.thumbnail || null }, e)}
              onClick={() => {
                if (suppressClickRef.current) return;
                if (d.thumbnail) setPreview({ url: d.thumbnail, name: d.name });
              }}
              style={{
                position: "relative", aspectRatio: "4/3", borderRadius: 12, overflow: "hidden",
                cursor: "grab", background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                opacity: dragItem?.kind === "template" && dragItem.id === d.id ? 0.25 : 1,
                touchAction: "none", userSelect: "none",
              }}
            >
              {d.thumbnail ? (
                <img src={d.thumbnail} alt={d.name} loading="lazy" draggable={false}
                  style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, opacity: 0.25 }}>📄</div>
              )}
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                padding: "4px 8px", background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
                fontSize: 10, color: "rgba(255,255,255,0.8)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {d.name}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* ── Bucket Files ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={sectionTitle}>
          🖼️ Archivos en Storage · {shownFiles.length}
          {activeBucket ? ` — ${BUCKET_LABELS[activeBucket] || activeBucket}` : ""}
        </h3>
        {activeBucket && (
          <button type="button" onClick={() => setActiveBucket(null)}
            style={{ borderRadius: 100, padding: "4px 12px", fontSize: 11, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)" }}>
            Ver todos
          </button>
        )}
      </div>
      {shownFiles.length === 0 ? (
        <div style={{ textAlign: "center", padding: 24, marginBottom: 28, color: "rgba(255,255,255,0.25)", fontSize: 12 }}>
          No hay archivos en {activeBucket ? "este bucket" : "los buckets"} aún.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8, marginBottom: 32 }}>
          {shownFiles.map(f => {
            const fid = `${f.bucket}:${f.path}`;
            const isImage = f.mimeType.startsWith("image/");
            return (
              <motion.div
                key={fid}
                layout
                whileHover={{ scale: 1.05, y: -2 }}
                onPointerDown={(e) => beginDrag({ kind: "bucketfile", id: fid, name: f.name, thumb: isImage ? f.url : null, bucket: f.bucket, path: f.path }, e)}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  if (isImage) setPreview({ url: f.url, name: f.name, size: f.sizeBytes });
                }}
                style={{
                  position: "relative", aspectRatio: "1", borderRadius: 12, overflow: "hidden",
                  cursor: "grab", background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  opacity: dragItem?.id === fid ? 0.25 : 1,
                  touchAction: "none", userSelect: "none",
                }}
              >
                {isImage ? (
                  <img src={f.url} alt={f.name} loading="lazy" draggable={false}
                    style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, opacity: 0.3 }}>📦</div>
                )}
                <div style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  padding: "4px 8px", background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
                  fontSize: 9.5, color: "rgba(255,255,255,0.7)",
                }}>
                  {fmtBytes(f.sizeBytes)}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Trash ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={sectionTitle}>🗑️ Papelera · {allTrash.length}</h3>
        {allTrash.length > 0 && (
          <button type="button" onClick={handlePurgeExpired} disabled={purging}
            style={{ borderRadius: 100, padding: "5px 14px", fontSize: 11, fontWeight: 500, border: "none", cursor: purging ? "wait" : "pointer", background: "rgba(220,38,38,0.08)", color: "#f87171" }}>
            {purging ? "Purgando…" : "Purgar expirados"}
          </button>
        )}
      </div>
      {allTrash.length === 0 ? (
        <div style={{ textAlign: "center", padding: 24, marginBottom: 32 }}>
          <div style={{ fontSize: 28, marginBottom: 4, opacity: 0.3 }}>🗑️</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>La papelera está vacía.</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.12)", marginTop: 2 }}>
            Lo que elimines vive aquí 30 días antes de borrarse para siempre.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 32 }}>
          <AnimatePresence>
            {allTrash.map(item => {
              const isTemplate = item._type === "template";
              const days = daysLeft(item.deletedAt);
              return (
                <motion.div
                  key={`${item._type}-${item.id}`}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 60, transition: { duration: 0.2 } }}
                  className="liquid-glass"
                  style={{
                    padding: "12px 16px", borderRadius: 12,
                    display: "flex", alignItems: "center", gap: 12,
                    border: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                    background: isTemplate ? "rgba(99,102,241,0.1)" : "rgba(168,85,247,0.1)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
                    overflow: "hidden",
                  }}>
                    {!isTemplate && (item as TrashAsset).url
                      ? <img src={(item as TrashAsset).url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      : (isTemplate ? "📄" : "🖼️")}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.75)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                      {isTemplate ? "Diseño" : "Imagen"} · eliminado {new Date(item.deletedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: "right", marginRight: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: daysLeftColor(days) }}>{days}d</div>
                    <div style={{ width: 40, height: 3, borderRadius: 100, marginTop: 3, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                      <div style={{ width: `${Math.round((days / 30) * 100)}%`, height: "100%", borderRadius: 100, background: daysLeftColor(days) }} />
                    </div>
                  </div>
                  <button type="button"
                    onClick={() => isTemplate ? handleRestoreTemplate(item.id) : handleRestoreAsset(item.id)}
                    style={{ borderRadius: 100, padding: "6px 14px", fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer", background: "rgba(34,197,94,0.12)", color: "#4ade80", whiteSpace: "nowrap" }}>
                    ↩ Restaurar
                  </button>
                  <button type="button"
                    onClick={() => handlePermanentDelete(isTemplate ? "template" : "asset", item.id)}
                    style={{ borderRadius: 100, padding: "6px 12px", fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer", background: "rgba(220,38,38,0.12)", color: "#f87171", whiteSpace: "nowrap" }}>
                    ✕
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ── The Trash Can (always docked bottom-center, comes alive on drag) ── */}
      <motion.div
        ref={trashRef}
        animate={{
          scale: overTrash ? 1.25 : dragItem ? 1.08 : 1,
          y: dragItem ? -8 : 0,
          rotate: overTrash ? [0, -6, 6, -4, 4, 0] : 0,
        }}
        transition={{ rotate: { duration: 0.45 }, scale: { type: "spring", stiffness: 400, damping: 20 } }}
        style={{
          position: "fixed", bottom: 26, left: "50%", marginLeft: -34,
          width: 68, height: 68, borderRadius: "50%", zIndex: 250,
          background: overTrash ? "rgba(220,38,38,0.25)" : "rgba(20,18,38,0.85)",
          backdropFilter: "blur(14px)",
          border: overTrash ? "1.5px solid rgba(248,113,113,0.8)" : "1px solid rgba(255,255,255,0.12)",
          boxShadow: overTrash ? "0 0 30px rgba(220,38,38,0.4)" : "0 8px 24px rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28, pointerEvents: "none",
          transition: "background 0.2s ease, border 0.2s ease, box-shadow 0.2s ease",
        }}
      >
        <motion.span animate={{ rotate: overTrash ? -20 : 0, y: overTrash ? -3 : 0 }} style={{ display: "inline-block" }}>
          🗑️
        </motion.span>
        {allTrash.length > 0 && !dragItem && (
          <div style={{
            position: "absolute", top: -2, right: -2, minWidth: 18, height: 18,
            borderRadius: 100, background: "#dc2626", color: "#fff",
            fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0 5px",
          }}>
            {allTrash.length}
          </div>
        )}
      </motion.div>

      {/* ── Drag ghost ── */}
      <AnimatePresence>
        {dragItem && (
          <motion.div
            key="ghost"
            initial={{ scale: 1, opacity: 0.9 }}
            animate={flying && trashCanRect ? {
              x: trashCanRect.left + trashCanRect.width / 2 - dragPos.x,
              y: trashCanRect.top + trashCanRect.height / 2 - dragPos.y,
              scale: 0.05, opacity: 0.4, rotate: 25,
            } : { scale: 1, opacity: 0.9, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={flying ? { duration: 0.3, ease: "easeIn" } : { duration: 0 }}
            style={{
              position: "fixed", zIndex: 300, pointerEvents: "none",
              left: dragPos.x - 44, top: dragPos.y - 34,
              width: 88, height: 68, borderRadius: 10, overflow: "hidden",
              border: "1.5px solid rgba(129,140,248,0.7)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.6)",
              background: "rgba(20,18,38,0.9)",
              transform: "rotate(3deg)",
            }}
          >
            {dragItem.thumb ? (
              <img src={dragItem.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                {dragItem.kind === "template" ? "📄" : "📦"}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Preview Modal ── */}
      <AnimatePresence>
        {preview && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setPreview(null)}
            style={{
              position: "fixed", inset: 0, zIndex: 300,
              background: "rgba(0,0,0,0.85)", backdropFilter: "blur(16px)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40,
            }}
          >
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              src={preview.url} alt={preview.name}
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: "90vw", maxHeight: "75vh", objectFit: "contain", borderRadius: 12 }}
            />
            <div style={{ marginTop: 14, fontSize: 12, color: "rgba(255,255,255,0.5)", display: "flex", gap: 14 }}>
              <span>{preview.name}</span>
              {preview.size !== undefined && <span>{fmtBytes(preview.size)}</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
