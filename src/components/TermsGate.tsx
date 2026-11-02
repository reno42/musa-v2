import { useState } from "react";
import { browserSupabase } from "../lib/supabaseClient";
import { LegalModal, type LegalDoc } from "./LegalModal";

export const TERMS_VERSION = "2026-11";
const PENDING_KEY = "musa:terms-accepted";

/** La casilla del registro deja la aceptación pendiente aquí hasta que exista la sesión. */
export function markTermsAccepted() { try { localStorage.setItem(PENDING_KEY, TERMS_VERSION); } catch { /* sin storage */ } }

/** Graba la aceptación en el perfil. Devuelve true si quedó grabada. */
export async function recordTermsAcceptance(userId: string): Promise<boolean> {
  if (!browserSupabase) return false;
  const { error } = await browserSupabase.from("user_profiles").update({ terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION }).eq("id", userId);
  if (!error) { try { localStorage.removeItem(PENDING_KEY); } catch { /* */ } }
  return !error;
}
export function hasPendingTermsAcceptance() { try { return !!localStorage.getItem(PENDING_KEY); } catch { return false; } }

export function TermsLabel({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const [doc, setDoc] = useState<LegalDoc | null>(null);
  return (
    <>
      <label className="auth-terms" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.45, color: "var(--auth-muted, #aaa)", textAlign: "left" }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} required style={{ marginTop: 2, accentColor: "#ff5e00" }} />
        <span>Acepto los <a href="#" onClick={(e) => { e.preventDefault(); setDoc("terminos"); }} style={{ color: "inherit", textDecoration: "underline" }}>Términos y Condiciones</a> y la <a href="#" onClick={(e) => { e.preventDefault(); setDoc("privacidad"); }} style={{ color: "inherit", textDecoration: "underline" }}>Política de Privacidad</a> de Musa.</span>
      </label>
      {doc && <LegalModal doc={doc} onNavigate={setDoc} onClose={() => setDoc(null)} />}
    </>
  );
}

export function TermsGate({ userId, onAccepted, onSignOut }: { userId: string; onAccepted: () => void; onSignOut: () => void }) {
  const [ok, setOk] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const accept = async () => {
    setBusy(true); setErr("");
    if (await recordTermsAcceptance(userId)) onAccepted();
    else { setErr("No se pudo guardar. Intenta otra vez."); setBusy(false); }
  };
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="terms-title">
        <div className="mv2-logo">MUSA<i>#</i><small>by Futuraria</small></div>
        <h1 id="terms-title" className="auth-title">Antes de entrar</h1>
        <p className="auth-copy">Para usar Musa necesitamos que aceptes los términos de uso.</p>
        <TermsLabel checked={ok} onChange={setOk} />
        {err && <p className="auth-error" role="alert">{err}</p>}
        <button className="auth-submit" type="button" disabled={!ok || busy} onClick={() => void accept()} style={{ marginTop: 14 }}>{busy ? "Guardando…" : "Entrar a Musa"}</button>
        <button type="button" className="auth-switch" onClick={onSignOut}>Cerrar sesión</button>
      </section>
    </main>
  );
}
