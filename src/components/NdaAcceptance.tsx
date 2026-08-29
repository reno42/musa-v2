// ============================================================
// NdaAcceptance.tsx — NDA Wall: aceptación del Acuerdo de Acceso
// Alfa en el primer login (o en cuentas previas a la feature).
//
// App.tsx lo renderiza mientras el perfil no tenga nda_accepted_at.
// Sin salida intermedia: aceptar o cerrar sesión. La aceptación se
// registra con POST /api/account/nda-acceptance (una sola llamada
// autenticada; la API captura IP y user agent reales).
// ============================================================

import { useCallback, useState, type CSSProperties } from "react";
import { apiFetch } from "../lib/supabase";
import {
  NDA_VERSION,
  planOptions,
  planBullets,
  ndaSections,
  type PlanId,
} from "../lib/ndaContent";

export interface NdaAcceptanceProps {
  /** Nombre completo, prefilled desde la cuenta. */
  fullName: string;
  /** Email de la cuenta, solo informativo. */
  email: string;
  /** Se dispara SOLO tras registrar la aceptación con éxito. */
  onAccepted: (record: { plan: PlanId; acceptedAt: string }) => void;
  /** Única salida sin aceptar: cerrar sesión. */
  onSignOut: () => void;
}

type Status = "idle" | "loading" | "error";

const c: Record<string, CSSProperties> = {
  screen: {
    minHeight: "100vh", background: "#0a0a0c", padding: "28px 20px",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  },
  brand: { display: "flex", alignItems: "center", gap: 8, marginBottom: 18, color: "#f2f3ee" } as CSSProperties,
  brandMark: {
    width: 26, height: 26, borderRadius: 8, background: "#d2ff02", color: "#0a0a0c",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 14, fontWeight: 800, letterSpacing: "-0.02em",
  },
  wrap: { color: "#f2f3ee", background: "#121216", border: "1px solid #26262f", borderRadius: 16, padding: 28, maxWidth: 680, width: "100%" },
  h2: { margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" },
  sub: { color: "#9a9aa6", fontSize: 13.5, margin: "6px 0 22px" },
  label: { display: "block", fontSize: 12, fontWeight: 700, color: "#f2f3ee", margin: "18px 0 8px" },
  planRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  planTitle: { fontWeight: 800, fontSize: 14, color: "#f2f3ee", display: "flex", gap: 8, alignItems: "center" },
  planDetail: { fontSize: 12, color: "#9a9aa6", marginTop: 3 },
  bullets: { margin: "8px 0 0 18px", padding: 0, fontSize: 12.5, color: "#c9c9d2", lineHeight: 1.6 },
  doc: { marginTop: 22, maxHeight: 320, overflowY: "auto", border: "1px solid #26262f", borderRadius: 12, padding: "16px 18px", background: "#0a0a0c", fontSize: 12.5, color: "#c9c9d2" },
  secTitle: { color: "#f2f3ee", fontWeight: 700, fontSize: 12.5, margin: "14px 0 5px" },
  secBody: { margin: "0 0 6px", lineHeight: 1.6 },
  secBullets: { margin: "0 0 6px 16px", padding: 0 },
  check: { display: "flex", gap: 10, alignItems: "flex-start", margin: "18px 0 20px", cursor: "pointer" },
  checkInput: { width: 17, height: 17, marginTop: 2, accentColor: "#d2ff02", cursor: "pointer" },
  checkText: { fontSize: 12.5, color: "#9a9aa6", lineHeight: 1.5 },
  cancel: { width: "100%", marginTop: 10, padding: 10, background: "transparent", border: "none", color: "#9a9aa6", cursor: "pointer", fontSize: 13 },
  error: { marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.35)", color: "#ff7a7a", fontSize: 13 },
};

const planCard = (active: boolean): CSSProperties => ({
  flex: 1, minWidth: 220, padding: "12px 14px", borderRadius: 10, cursor: "pointer",
  border: active ? "1px solid #d2ff02" : "1px solid #26262f",
  color: active ? "#f2f3ee" : "#9a9aa6", background: active ? "rgba(210,255,2,0.06)" : "transparent",
});

const btn = (disabled: boolean): CSSProperties => ({
  width: "100%", padding: 14, borderRadius: 11, border: "none", cursor: disabled ? "not-allowed" : "pointer",
  background: disabled ? "#3a3a42" : "#d2ff02", color: "#0a0a0c", fontWeight: 800, fontSize: 15,
});

export function NdaAcceptance({ fullName, email, onAccepted, onSignOut }: NdaAcceptanceProps) {
  const [plan, setPlan] = useState<PlanId>("friends_family");
  const [accepted, setAccepted] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const submit = useCallback(async () => {
    if (!accepted) {
      setError("Debes marcar la casilla de aceptación para continuar.");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const result = await apiFetch<{ data?: { acceptedAt?: string } }>("/api/account/nda-acceptance", {
        method: "POST",
        body: JSON.stringify({ plan }),
      });
      onAccepted({ plan, acceptedAt: result?.data?.acceptedAt || new Date().toISOString() });
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "No se pudo registrar tu aceptación. Intenta de nuevo.");
    }
  }, [accepted, plan, onAccepted]);

  return (
    <div style={c.screen}>
      <div style={c.brand} aria-hidden="true">
        <span style={c.brandMark}>M</span>
        <span style={{ fontWeight: 700, fontSize: 15 }}>Musa <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.55, fontWeight: 500 }}>by Futuraria</span></span>
      </div>
      <div style={c.wrap}>
        <h2 style={c.h2}>Acuerdo de Acceso Alfa</h2>
        <p style={c.sub}>
          Confidencial · Futuraria · v{NDA_VERSION}. Léelo y confirma para entrar a tu workspace.
        </p>

        <span style={c.label}>Plan de acceso</span>
        <div style={c.planRow}>
          {planOptions.map((opt) => (
            <div key={opt.value} style={planCard(plan === opt.value)} onClick={() => setPlan(opt.value)}>
              <div style={c.planTitle}>
                <input
                  type="radio"
                  name="nda-plan"
                  checked={plan === opt.value}
                  onChange={() => setPlan(opt.value)}
                  style={{ accentColor: "#d2ff02" }}
                />
                {opt.label}
              </div>
              <div style={c.planDetail}>{opt.detail}</div>
            </div>
          ))}
        </div>
        <ul style={c.bullets}>
          {planBullets[plan].map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>

        <div style={c.doc}>
          {ndaSections.map((s) => (
            <div key={s.title}>
              <div style={c.secTitle}>{s.title}</div>
              {s.body && <p style={c.secBody}>{s.body}</p>}
              {s.bullets && (
                <ul style={c.secBullets}>
                  {s.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <label style={c.check}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            style={c.checkInput}
          />
          <span style={c.checkText}>
            He leído el acuerdo y <b style={{ color: "#f2f3ee" }}>acepto</b> sus términos. Entiendo que
            grabar, transcribir, scrapear o clonar la herramienta cancela mi acceso de forma permanente.
          </span>
        </label>

        <button style={btn(status === "loading" || !accepted)} onClick={submit} disabled={status === "loading" || !accepted}>
          {status === "loading" ? "Registrando…" : "Acepto y entro a Futuraria"}
        </button>
        <button style={c.cancel} onClick={onSignOut} disabled={status === "loading"}>
          Cerrar sesión
        </button>
        {error && <div style={c.error}>{error}</div>}
      </div>
      <p style={{ margin: "16px 0 0", fontSize: 11.5, color: "#5c5c66" }}>
        Cuenta: {email || fullName}
      </p>
    </div>
  );
}
