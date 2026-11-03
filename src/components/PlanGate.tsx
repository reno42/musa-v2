import { useEffect, useState } from "react";
import { browserSupabase } from "../lib/supabaseClient";
import { apiFetch } from "../lib/supabase";

// Pantalla de planes (Creem) cuando el cobro está encendido y la cuenta no tiene acceso.
// Un código de acceso (p. ej. MUSAFREE) da una cuenta gratis; se puede traer del registro o de ?code=.
const PENDING_KEY = "musa:access-code";

export function savePendingAccessCode(code: string) { try { const c = code.trim().toUpperCase(); if (c) localStorage.setItem(PENDING_KEY, c); } catch { /* sin storage */ } }
export function capturePendingAccessCode() { try { const c = new URLSearchParams(location.search).get("code"); if (c) savePendingAccessCode(c); } catch { /* */ } }
function takePending() { try { const c = localStorage.getItem(PENDING_KEY); localStorage.removeItem(PENDING_KEY); return c; } catch { return null; } }

export type AccessStatus = { paywall: boolean; has_access: boolean; is_admin?: boolean };

/** Lee si la cuenta puede entrar. Si la función no existe o falla, deja entrar (el cobro no bloquea por un error nuestro). */
export async function readAccessStatus(): Promise<AccessStatus> {
  if (!browserSupabase) return { paywall: false, has_access: true };
  const { data, error } = await browserSupabase.rpc("v2_access_status");
  if (error || !data) return { paywall: false, has_access: true };
  return data as AccessStatus;
}

async function redeem(code: string): Promise<AccessStatus> {
  if (!browserSupabase) throw new Error("Sin conexión");
  const { data, error } = await browserSupabase.rpc("v2_redeem_access_code", { p_code: code });
  if (error) throw new Error(error.message);
  return data as AccessStatus;
}

/** Canjea en silencio el código guardado en el registro. Devuelve el estado nuevo o null. */
export async function redeemPendingAccessCode(): Promise<AccessStatus | null> {
  const c = takePending(); if (!c) return null;
  try { return await redeem(c); } catch { return null; }
}

const codeError = (m: string) => /NOT_FOUND/.test(m) ? "Ese código no existe" : /EXPIRED/.test(m) ? "Ese código ya venció" : /USED_UP/.test(m) ? "Ese código ya se usó todas las veces posibles" : "No se pudo canjear: " + m;

type Plan = { code: string; name: string; mode: string; segment: string; interval: string; price_usd: number; purchasable: boolean; entitlements?: { features?: string[] } };

export function PlanGate({ onAccess, onSignOut }: { onAccess: () => void; onSignOut: () => void }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [configured, setConfigured] = useState(false);
  const [access, setAccess] = useState(""), [discount, setDiscount] = useState("");
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [picked] = useState(() => { try { return localStorage.getItem("musa:plan") || ""; } catch { return ""; } });

  useEffect(() => {
    apiFetch<{ plans: Plan[]; configured: boolean }>("/api/billing/plans").then((r) => { setPlans(r.plans || []); setConfigured(!!r.configured); }, () => setPlans([]));
  }, []);

  const useCode = async () => {
    if (!access.trim()) return;
    setBusy("code"); setErr("");
    try { const s = await redeem(access); if (s.has_access) onAccess(); else setErr("El código no dio acceso"); }
    catch (e) { setErr(codeError((e as Error).message)); }
    setBusy("");
  };
  const buy = async (code: string) => {
    setBusy(code); setErr("");
    try {
      const r = await apiFetch<{ url?: string; error?: string }>("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planCode: code, discountCode: discount.trim() || undefined }), timeoutMs: 30_000 });
      if (r.url) { try { localStorage.removeItem("musa:plan"); } catch { /* */ } window.location.href = r.url; return; }
      setErr(r.error || "Creem no devolvió el enlace de pago");
    } catch (e) { setErr((e as Error).message); }
    setBusy("");
  };
  const per = (i: string) => (i === "year" ? "año" : i === "once" ? "pago único" : "mes");
  const sale = (plans || []).filter((p) => p.purchasable && configured);

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="plan-title" style={{ maxWidth: sale.length > 1 ? 760 : 460 }}>
        <div className="mv2-logo">MUSA<i>#</i><small>by Futuraria</small></div>
        <h1 id="plan-title" className="auth-title">Elige tu plan</h1>
        <p className="auth-copy">Para entrar a Musa elige un plan. Si tienes un código de acceso, escríbelo abajo.</p>
        {plans === null ? <p className="auth-copy">Cargando planes…</p> : sale.length ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 10, margin: "12px 0" }}>
              {sale.map((p) => (
                <div key={p.code} style={{ border: p.code === picked ? "2px solid #ff5e00" : "1px solid rgba(255,255,255,.18)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
                  <b>{p.name}</b>
                  <span style={{ fontSize: 22, fontWeight: 800 }}>US$ {Number(p.price_usd)} <small style={{ fontSize: 12, opacity: .6 }}>/ {per(p.interval)}</small></span>
                  {p.entitlements?.features && <ul style={{ margin: "2px 0 0 16px", fontSize: 12, opacity: .8 }}>{p.entitlements.features.map((f) => <li key={f}>{f}</li>)}</ul>}
                  <button className="auth-submit" type="button" disabled={!!busy} onClick={() => void buy(p.code)} style={{ marginTop: "auto" }}>{busy === p.code ? "Abriendo pago…" : "Elegir"}</button>
                </div>
              ))}
            </div>
            <label className="auth-field">
              <span>Código de descuento o de referido (opcional)</span>
              <input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="Ej. RENZO420" autoComplete="off" />
            </label>
          </>
        ) : <p className="auth-copy">Los planes se publican pronto.</p>}
        <label className="auth-field" style={{ marginTop: 12 }}>
          <span>Código de acceso</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={access} onChange={(e) => setAccess(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void useCode(); }} placeholder="Ej. MUSAFREE" autoComplete="off" style={{ flex: 1 }} />
            <button className="auth-submit" type="button" disabled={!access.trim() || !!busy} onClick={() => void useCode()} style={{ width: "auto", padding: "0 18px" }}>{busy === "code" ? "…" : "Canjear"}</button>
          </div>
        </label>
        {err && <p className="auth-error" role="alert">{err}</p>}
        <button type="button" className="auth-switch" onClick={onSignOut}>Cerrar sesión</button>
      </section>
    </main>
  );
}
