// Anti-spam para los formularios públicos (/f/:token, /e/:slug/register,
// /w/:slug/_form/:token). Tres capas baratas, sin dependencias:
//   1. Rate-limit por IP en la cache del isolate (ventana fija 60s).
//    Free plan de CF no expone rate limiting API; el isolate vive ~minutos,
//    suficiente para frenar ráfagas del mismo bot desde una IP.
//   2. Trampa de tiempo: un humano tarda >2s en rellenar; los bots que
//    autollenan POSTean en <1s. Se marca la llegada (t0) en el HTML via
//    cookie musa_ft (ephemeral); si no hay cookie o el delta es <2000ms → 429.
//    Nota: exige cookies; si un usuario real las bloquea, verá el 429 y puede
//    reintentar (el POST no se pierde, solo se le pide reintento).
//   3. Honeypot `website` ya existente en los tres formularios.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;       // submits por IP por minuto
const MIN_HUMAN_MS = 2_000;     // tiempo mínimo de relleno

const hits = new Map(); // ip -> [timestamps]
let lastSweep = 0;

function sweep(now) {
  if (now - lastSweep < 120_000) return;
  lastSweep = now;
  for (const [ip, arr] of hits) {
    const alive = arr.filter((t) => now - t < WINDOW_MS);
    if (alive.length === 0) hits.delete(ip); else hits.set(ip, alive);
  }
}

export function ipOf(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
}

/** 429 si esta IP excede el cupo. Llamar ANTES de procesar el submit. */
export function rateLimited(request) {
  const now = Date.now();
  sweep(now);
  const ip = ipOf(request);
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) return true;
  arr.push(now);
  hits.set(ip, arr);
  return false;
}

/** true = sospechoso (demasiado rápido o sin marca de tiempo). */
export function tooFast(request, body) {
  if (body && body.__qr) return false; // los QR escaneados en local pueden recargar rápido
  const raw = request.headers.get("cookie") || "";
  const m = raw.match(/(?:^|;\s*)musa_ft=(\d+)/);
  if (!m) return true;
  const elapsed = Date.now() - Number(m[1]);
  return elapsed >= 0 && elapsed < MIN_HUMAN_MS;
}

/** Cookie de marca de tiempo para setear en el GET del formulario. */
export function formTimingCookie() {
  return `musa_ft=${Date.now()}; Max-Age=1800; Path=/; Secure; SameSite=Lax`;
}
