import { useEffect, useState } from "react";
import { getApiHeaders } from "../lib/apiKey";

interface Usage {
  count: number;
  bytes: number;
  limits: { maxCount: number; maxBytes: number };
  plan: string;
}

const fmtBytes = (b: number) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`;

function Track({ label, valueText, maxText, fraction, color }: {
  label: string; valueText: string; maxText: string; fraction: number; color: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
        <span style={{ color: "rgba(255,255,255,0.65)" }}>{label}</span>
        <span style={{ color: "rgba(255,255,255,0.4)" }}>{valueText} / {maxText}</span>
      </div>
      <div style={{ height: 6, borderRadius: 100, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${Math.min(100, Math.max(fraction > 0 ? 2 : 0, fraction * 100))}%`,
          background: color, borderRadius: 100,
        }} />
      </div>
    </div>
  );
}

/**
 * "Fuentes personalizadas" card for Configuración → General: two tracks —
 * how many fonts and how much storage the account has spent against its
 * plan — fed by /api/fonts/custom/usage. Pure divs, same treatment as the
 * StorageTab bar. A card whose endpoint is missing (migration not applied
 * yet) renders nothing: absent beats broken.
 */
export function FontsUsageCard() {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/fonts/custom/usage", { headers: getApiHeaders() })
      .then(r => r.json())
      .then(json => { if (!cancelled && json?.success && json.data?.limits) setUsage(json.data); })
      .catch(() => { /* stays null → the card renders nothing */ });
    return () => { cancelled = true; };
  }, []);
  if (!usage) return null;
  const planLabel = usage.plan === "corporate" ? "corporate" : "friends & family";
  return (
    <div className="bento-card bento-5">
      <div className="bento-title">🔤 Fuentes personalizadas</div>
      <div className="bento-sub">
        Las fuentes que has subido y su espacio, contra los límites del plan {planLabel}.
        Se suben desde el editor (picker → Tus fuentes) o pidiéndoselo a tu IA por MCP.
      </div>
      <Track
        label="Fuentes"
        valueText={String(usage.count)}
        maxText={String(usage.limits.maxCount)}
        fraction={usage.limits.maxCount > 0 ? usage.count / usage.limits.maxCount : 0}
        color="#818cf8"
      />
      <Track
        label="Almacenamiento"
        valueText={fmtBytes(usage.bytes)}
        maxText={fmtBytes(usage.limits.maxBytes)}
        fraction={usage.limits.maxBytes > 0 ? usage.bytes / usage.limits.maxBytes : 0}
        color="#a855f7"
      />
    </div>
  );
}
