// ============================================================
// referral.ts — códigos de referido (?ref=RENZO420)
//
// El enlace de invitado trae ?ref=; aquí se captura UNA vez al boot (antes
// de que el routing SPA reescriba la URL), sobrevive 30 días en localStorage
// y se canjea solo cuando el bootstrap creó el perfil (lib/auth.tsx).
// El canje manual (cross-device) vive en la tarjeta de Configuración.
// ============================================================

import { apiFetch } from "./supabase";

const KEY = "futuraria:referral-pending";
// 30 días: un clic hoy y signup el finde sigue contando; más que eso el
// código suele ser basura (link reenviado sin contexto).
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** RENZO420: nombre normalizado (2-14 alfanuméricos) + al menos 2 dígitos. */
export const REFERRAL_CODE_RE = /^[A-Z0-9]{2,14}[0-9]{2,}$/;

export function normalizeReferralCode(raw: string): string {
  return (raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidReferralCode(raw: string): boolean {
  return REFERRAL_CODE_RE.test(normalizeReferralCode(raw));
}

export function referralShareUrl(code: string): string {
  return `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
}

type PendingReferral = { code: string; savedAt: number };

/** Lee ?ref=/?referral=/?ref_code= de la URL actual y lo persiste. Se llama
 *  una sola vez desde el module scope de App.tsx: después de eso la SPA ya
 *  reescribió la URL y el parámetro se perdió. */
export function capturePendingReferral(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("ref") || params.get("referral") || params.get("ref_code");
    if (!raw) return null;
    const code = normalizeReferralCode(raw);
    if (!REFERRAL_CODE_RE.test(code)) return null;
    localStorage.setItem(KEY, JSON.stringify({ code, savedAt: Date.now() } satisfies PendingReferral));
    return code;
  } catch {
    return null; // storage bloqueado: la feature muere en silencio, el resto de la app no
  }
}

function readPending(): PendingReferral | null {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || "null") as PendingReferral | null;
    if (!stored || typeof stored.code !== "string" || !REFERRAL_CODE_RE.test(stored.code)) return null;
    if (Date.now() - (stored.savedAt || 0) > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

/** El código pendiente (si sigue vigente) sin consumirlo. */
export function peekPendingReferral(): string | null {
  return readPending()?.code ?? null;
}

/** Guarda/actualiza el pendiente — lo usa el campo opcional del signup. */
export function savePendingReferral(code: string): void {
  const normalized = normalizeReferralCode(code);
  if (!REFERRAL_CODE_RE.test(normalized)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ code: normalized, savedAt: Date.now() } satisfies PendingReferral));
  } catch { /* storage lleno/bloqueado */ }
}

/** Consume el pendiente (éxito, código inválido o ya-referido: dejarlo sería
 *  nagging eterno). Devuelve lo consumido o null. */
export function consumePendingReferral(): string | null {
  const pending = readPending();
  if (pending) {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }
  return pending?.code ?? null;
}

/** Se dispara tras el bootstrap del perfil (lib/auth.tsx). Consume el código
 *  en éxito, 404 CODE_NOT_FOUND y 409 ALREADY_REFERRED; lo conserva en 429
 *  (rate limit) o fallo de red para reintentar en el próximo login. */
export async function redeemPendingReferral(): Promise<boolean> {
  const code = peekPendingReferral();
  if (!code) return false;
  try {
    const res = await apiFetch<{ success?: boolean; error?: string }>("/account/referral/redeem", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    const error = res?.success === false ? res.error : undefined;
    if (error === "TOO_MANY_ATTEMPTS") return false; // transitorio: el pendiente vive
    consumePendingReferral();
    return !error;
  } catch {
    return false; // red caída: el pendiente vive
  }
}
