import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getApiHeaders } from "../lib/apiKey";
import { useToast } from "./Toast";

// ── Types ──

interface Asset {
  id: string; name: string; filename: string; mimeType: string;
  sizeBytes: number; url: string; width?: number; height?: number;
  tags?: string[]; workspaceId?: string; createdAt: string;
}

interface TrashAsset extends Asset {
  deletedAt: string;
}

interface TrashTemplate {
  id: string; name: string; workspaceId?: string;
  createdAt: string; deletedAt: string;
}

interface StorageSummary {
  totalBytes: number; totalFiles: number;
  buckets: Array<{ name: string; label: string; icon: string; assetCount: number; sizeBytes: number }>;
  counts: { templates: number; assets: number; recipes: number; workspaces: number };
  trash: { templates: number; assets: number; total: number };
}

// ── Helpers ──

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function daysLeft(deletedAt: string): number {
  const dt = new Date(deletedAt).getTime();
  const expires = dt + 30 * 86400000;
  return Math.max(0, Math.ceil((expires - Date.now()) / 86400000));
}

function daysLeftColor(days: number): string {
  if (days > 20) return "#4ade80";
  if (days > 10) return "#facc15";
  return "#f87171";
}

// ── Component ──

export function StorageTab() {
  const { addToast } = useToast();

  // State
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [trashAssets, setTrashAssets] = useState<TrashAsset[]>([]);
  const [trashTemplates, setTrashTemplates] = useState<TrashTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedBucket, setExpandedBucket] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);

  // Swipe tracking
  const touchStartX = useRef(0);
  const touchCurrentX = useRef(0);

  // ── Data fetching ──

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const headers = getApiHeaders();

    try {
      // Fetch summary, assets, trash in parallel
      const [sumRes, assetsRes, trashAssetsRes, trashTplRes] = await Promise.all([
        fetch("/api/storage/summary", { headers }).then(r => r.json()),
        fetch("/api/assets?limit=200", { headers }).then(r => r.json()),
        fetch("/api/assets/trash?limit=100", { headers }).then(r => r.json()),
        fetch("/api/templates/trash?limit=100", { headers }).then(r => r.json()),
      ]);

      if (sumRes.success) setSummary(sumRes.data);
      if (assetsRes.success) setAssets(assetsRes.assets || []);
      if (trashAssetsRes.success) setTrashAssets(trashAssetsRes.data || []);
      if (trashTplRes.success) setTrashTemplates(trashTplRes.data || []);
    } catch {
      addToast("Could not load storage data.", "error");
    }
    setLoading(false);
  }, [addToast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Actions ──

  const handleDeleteAsset = async (id: string) => {
    try {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE", headers: getApiHeaders() });
      if (!res.ok) throw new Error("Failed");
      setAssets(prev => prev.filter(a => a.id !== id));
      setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
      addToast("Asset moved to Trash.", "success");
      fetchAll(); // refresh counts
    } catch { addToast("Could not delete asset.", "error"); }
  };

  const handleDeleteSelected = async () => {
    for (const id of selectedIds) {
      await fetch(`/api/assets/${id}`, { method: "DELETE", headers: getApiHeaders() });
    }
    setAssets(prev => prev.filter(a => !selectedIds.has(a.id)));
    setSelectedIds(new Set());
    addToast(`${selectedIds.size} assets moved to Trash.`, "success");
    fetchAll();
  };

  const handleRestoreAsset = async (id: string) => {
    try {
      await fetch(`/api/assets/${id}/restore`, { method: "PUT", headers: getApiHeaders() });
      addToast("Asset restored.", "success");
      fetchAll();
    } catch { addToast("Could not restore asset.", "error"); }
  };

  const handleRestoreTemplate = async (id: string) => {
    try {
      await fetch(`/api/templates/${id}/restore`, { method: "PUT", headers: getApiHeaders() });
      addToast("Template restored.", "success");
      fetchAll();
    } catch { addToast("Could not restore template.", "error"); }
  };

  const handlePermanentDelete = async (type: "asset" | "template", id: string) => {
    const endpoint = type === "asset"
      ? `/api/assets/${id}/permanent`
      : `/api/templates/${id}/permanent`;
    try {
      await fetch(endpoint, { method: "DELETE", headers: getApiHeaders() });
      addToast("Permanently deleted.", "success");
      fetchAll();
    } catch { addToast("Could not delete permanently.", "error"); }
  };

  const handlePurgeExpired = async () => {
    setPurging(true);
    try {
      await Promise.all([
        fetch("/api/assets/trash/purge-expired", { method: "POST", headers: getApiHeaders() }),
        fetch("/api/templates/trash/purge-expired", { method: "POST", headers: getApiHeaders() }),
      ]);
      addToast("Expired items purged.", "success");
      fetchAll();
    } catch { addToast("Purge failed.", "error"); }
    setPurging(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Swipe handlers ──

  const handleTouchStart = (id: string, e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchCurrentX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (id: string, e: React.TouchEvent) => {
    touchCurrentX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (id: string) => {
    const dx = touchStartX.current - touchCurrentX.current;
    if (dx > 60) {
      setSwipedId(id); // swipe left → reveal actions
    } else if (dx < -60) {
      setSwipedId(null); // swipe right → hide actions
    }
  };

  // ── Bucket details ──

  const bucketAssets = expandedBucket
    ? assets.filter(a => {
        if (expandedBucket === "design-assets") return true;
        if (expandedBucket === "design-covers") return a.url.includes("/design-covers/");
        if (expandedBucket === "design-exports") return a.url.includes("/design-exports/");
        return false;
      })
    : [];

  const allTrash = [
    ...trashTemplates.map(t => ({ ...t, _type: "template" as const })),
    ...trashAssets.map(a => ({ ...a, _type: "asset" as const })),
  ].sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());

  // ── Render helpers ──

  const renderAssetThumb = (asset: Asset, showCheck?: boolean) => (
    <div
      key={asset.id}
      onClick={() => showCheck ? toggleSelect(asset.id) : setPreviewAsset(asset)}
      style={{
        position: "relative", aspectRatio: "1", borderRadius: 12, overflow: "hidden",
        cursor: "pointer", background: "rgba(255,255,255,0.03)",
        border: selectedIds.has(asset.id) ? "2px solid #818cf8" : "1px solid rgba(255,255,255,0.06)",
        transition: "all 0.2s ease",
      }}
    >
      <img
        src={asset.url}
        alt={asset.name}
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
      {showCheck && (
        <div style={{
          position: "absolute", top: 6, right: 6,
          width: 20, height: 20, borderRadius: "50%",
          background: selectedIds.has(asset.id) ? "#818cf8" : "rgba(0,0,0,0.4)",
          border: "2px solid rgba(255,255,255,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, color: "#fff",
        }}>
          {selectedIds.has(asset.id) ? "✓" : ""}
        </div>
      )}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        padding: "4px 8px", background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
        fontSize: 10, color: "rgba(255,255,255,0.7)",
      }}>
        {fmtBytes(asset.sizeBytes)}
      </div>
    </div>
  );

  // ── Loading ──

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
          style={{ color: "rgba(255,255,255,0.3)", fontSize: 14 }}
        >
          Loading storage…
        </motion.div>
      </div>
    );
  }

  // ── Main render ──

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px", maxWidth: 960, margin: "0 auto", width: "100%" }}>
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
          {summary ? `${fmtBytes(summary.totalBytes)} · ${summary.totalFiles} files` : ""}
        </span>
      </div>

      {/* ── Storage bar (iPhone-style) ── */}
      {summary && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", height: 6, borderRadius: 100, overflow: "hidden", background: "rgba(255,255,255,0.05)", marginBottom: 8 }}>
            {summary.buckets.map((b, i) => {
              const pct = summary.totalBytes > 0 ? (b.sizeBytes / summary.totalBytes) * 100 : 0;
              if (pct < 1) return null;
              const colors = ["rgba(99,102,241,0.6)", "rgba(168,85,247,0.6)", "rgba(34,197,94,0.6)"];
              return (
                <div key={b.name} style={{
                  width: `${pct}%`, height: "100%",
                  background: colors[i] || colors[0],
                  transition: "width 0.5s ease",
                }} />
              );
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
      <h3 style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
        Buckets
      </h3>
      <div style={{ display: "flex", gap: 10, marginBottom: 24, overflowX: "auto", paddingBottom: 4 }}>
        {(summary?.buckets || []).map(bucket => (
          <motion.div
            key={bucket.name}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setExpandedBucket(expandedBucket === bucket.name ? null : bucket.name)}
            className="liquid-glass"
            style={{
              flex: "0 0 auto", minWidth: 160, padding: "14px 16px", borderRadius: 14,
              cursor: "pointer", border: expandedBucket === bucket.name ? "1px solid rgba(129,140,248,0.3)" : "1px solid rgba(255,255,255,0.05)",
              transition: "all 0.2s ease",
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 6 }}>{bucket.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)" }}>{bucket.label}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
              {bucket.assetCount} files · {fmtBytes(bucket.sizeBytes)}
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── Expanded Bucket Detail ── */}
      <AnimatePresence>
        {expandedBucket && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: "hidden", marginBottom: 24 }}
          >
            <div className="liquid-glass" style={{ padding: "14px 18px", borderRadius: 14, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>
                  {summary?.buckets.find(b => b.name === expandedBucket)?.icon}{" "}
                  {summary?.buckets.find(b => b.name === expandedBucket)?.label} — {bucketAssets.length} files
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedBucket(null)}
                  style={{
                    borderRadius: 100, padding: "4px 12px", fontSize: 11,
                    border: "none", cursor: "pointer",
                    background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            {bucketAssets.length === 0 ? (
              <div style={{ textAlign: "center", padding: 24, color: "rgba(255,255,255,0.25)", fontSize: 12 }}>
                No files in this bucket yet.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
                {bucketAssets.map(a => renderAssetThumb(a))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── All Files ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
          All Files · {assets.length}
        </h3>
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={handleDeleteSelected}
            style={{
              borderRadius: 100, padding: "5px 14px", fontSize: 11, fontWeight: 500,
              border: "none", cursor: "pointer",
              background: "rgba(220,38,38,0.12)", color: "#f87171",
            }}
          >
            Delete {selectedIds.size} selected
          </button>
        )}
      </div>

      {assets.length === 0 ? (
        <div style={{ textAlign: "center", padding: 32, marginBottom: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 8, opacity: 0.3 }}>📁</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>No files yet.</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.15)", marginTop: 4 }}>
            Upload images from the editor to see them here.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8, marginBottom: 32 }}>
          {assets.map(asset => (
            <div
              key={asset.id}
              onClick={() => selectedIds.size > 0 ? toggleSelect(asset.id) : setPreviewAsset(asset)}
              style={{
                position: "relative", aspectRatio: "1", borderRadius: 12, overflow: "hidden",
                cursor: "pointer", background: "rgba(255,255,255,0.03)",
                border: selectedIds.has(asset.id) ? "2px solid #818cf8" : "1px solid rgba(255,255,255,0.06)",
                transition: "all 0.2s ease",
              }}
            >
              <img
                src={asset.url}
                alt={asset.name}
                loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                  const parent = (e.target as HTMLImageElement).parentElement;
                  if (parent) {
                    const icon = document.createElement("span");
                    icon.textContent = "🖼️";
                    icon.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:24px;opacity:0.3";
                    parent.appendChild(icon);
                  }
                }}
              />
              <div style={{
                position: "absolute", top: 6, right: 6,
                width: 20, height: 20, borderRadius: "50%",
                background: selectedIds.has(asset.id) ? "#818cf8" : "rgba(0,0,0,0.4)",
                border: "2px solid rgba(255,255,255,0.3)",
                display: selectedIds.size > 0 ? "flex" : "none",
                alignItems: "center", justifyContent: "center",
                fontSize: 10, color: "#fff",
              }}>
                {selectedIds.has(asset.id) ? "✓" : ""}
              </div>
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                padding: "4px 8px", background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
                fontSize: 10, color: "rgba(255,255,255,0.7)",
              }}>
                {asset.name.length > 14 ? asset.name.slice(0, 12) + "…" : asset.name}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Trash ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
          🗑️ Trash · {allTrash.length}
        </h3>
        {allTrash.length > 0 && (
          <button
            type="button"
            onClick={handlePurgeExpired}
            disabled={purging}
            style={{
              borderRadius: 100, padding: "5px 14px", fontSize: 11, fontWeight: 500,
              border: "none", cursor: purging ? "wait" : "pointer",
              background: "rgba(220,38,38,0.08)", color: "#f87171",
            }}
          >
            {purging ? "Purging…" : "Purge Expired"}
          </button>
        )}
      </div>

      {allTrash.length === 0 ? (
        <div style={{ textAlign: "center", padding: 24, marginBottom: 32 }}>
          <div style={{ fontSize: 28, marginBottom: 4, opacity: 0.3 }}>🗑️</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>Trash is empty.</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.12)", marginTop: 2 }}>
            Deleted items appear here for 30 days before permanent removal.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 32 }}>
          {allTrash.map(item => {
            const isTemplate = item._type === "template";
            const days = daysLeft(item.deletedAt);
            const isSwiped = swipedId === item.id;

            return (
              <div
                key={item.id}
                style={{ position: "relative", overflow: "hidden", borderRadius: 12 }}
                onTouchStart={(e) => handleTouchStart(item.id, e)}
                onTouchMove={(e) => handleTouchMove(item.id, e)}
                onTouchEnd={() => handleTouchEnd(item.id)}
              >
                {/* Swipe-revealed action buttons */}
                <div style={{
                  position: "absolute", right: 0, top: 0, bottom: 0,
                  display: "flex", gap: 4, padding: "6px 10px",
                  background: "rgba(220,38,38,0.15)",
                  borderRadius: "0 12px 12px 0",
                }}>
                  <button
                    type="button"
                    onClick={() => isTemplate ? handleRestoreTemplate(item.id) : handleRestoreAsset(item.id)}
                    style={{
                      borderRadius: 100, padding: "6px 14px", fontSize: 11, fontWeight: 500,
                      border: "none", cursor: "pointer",
                      background: "rgba(34,197,94,0.15)", color: "#4ade80",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ↩ Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePermanentDelete(isTemplate ? "template" : "asset", item.id)}
                    style={{
                      borderRadius: 100, padding: "6px 14px", fontSize: 11, fontWeight: 500,
                      border: "none", cursor: "pointer",
                      background: "rgba(220,38,38,0.2)", color: "#f87171",
                      whiteSpace: "nowrap",
                    }}
                  >
                    💀 Delete
                  </button>
                </div>

                {/* Main card (slides left on swipe) */}
                <motion.div
                  animate={{ x: isSwiped ? -170 : 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="liquid-glass"
                  onClick={() => setSwipedId(isSwiped ? null : item.id)}
                  style={{
                    padding: "12px 16px", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 12,
                    border: "1px solid rgba(255,255,255,0.04)",
                    position: "relative", zIndex: 1,
                  }}
                >
                  {/* Icon */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: isTemplate ? "rgba(99,102,241,0.1)" : "rgba(168,85,247,0.1)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, flexShrink: 0,
                  }}>
                    {isTemplate ? "📄" : "🖼️"}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.75)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                      {isTemplate ? "Template" : "Asset"} · deleted {new Date(item.deletedAt).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Days left bar */}
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: daysLeftColor(days) }}>
                      {days}d
                    </div>
                    <div style={{
                      width: 40, height: 3, borderRadius: 100, marginTop: 3,
                      background: "rgba(255,255,255,0.05)", overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${Math.round((days / 30) * 100)}%`, height: "100%",
                        borderRadius: 100, background: daysLeftColor(days),
                        transition: "width 0.3s ease",
                      }} />
                    </div>
                  </div>
                </motion.div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Preview Modal ── */}
      <AnimatePresence>
        {previewAsset && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewAsset(null)}
            style={{
              position: "fixed", inset: 0, zIndex: 300,
              background: "rgba(0,0,0,0.85)", backdropFilter: "blur(16px)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              padding: 40,
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: "90vw", maxHeight: "80vh", borderRadius: 16, overflow: "hidden" }}
            >
              <img
                src={previewAsset.url}
                alt={previewAsset.name}
                style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: 12 }}
              />
            </motion.div>

            {/* Info bar */}
            <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
              <span>{previewAsset.name}</span>
              <span>{previewAsset.mimeType}</span>
              <span>{fmtBytes(previewAsset.sizeBytes)}</span>
              {previewAsset.width && <span>{previewAsset.width}×{previewAsset.height}</span>}
            </div>

            {/* Actions */}
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => { handleDeleteAsset(previewAsset.id); setPreviewAsset(null); }}
                style={{
                  borderRadius: 100, padding: "8px 20px", fontSize: 12, fontWeight: 500,
                  border: "none", cursor: "pointer",
                  background: "rgba(220,38,38,0.12)", color: "#f87171",
                }}
              >
                Move to Trash
              </button>
              <button
                type="button"
                onClick={() => setPreviewAsset(null)}
                style={{
                  borderRadius: 100, padding: "8px 20px", fontSize: 12, fontWeight: 500,
                  border: "none", cursor: "pointer",
                  background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)",
                }}
              >
                Close
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
