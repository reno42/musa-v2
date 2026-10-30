/**
 * navPrefs.ts — Personalización del nav por rol (pin/ocultar/drag, REQ-069).
 *
 * Persistencia en localStorage por workspace+rol: `musa-v2/nav/<ws>/<role>`.
 * La lectura valida contra el inventario de MODULES: ids desconocidos se
 * descartan y los faltantes se restauran del default del rol, de modo que un
 * cambio del prototipo nunca rompa el sidebar. (El flag v2_enabled de
 * workspace vive en BD; esto es solo la preferencia de navegación.)
 */
import { MODULES, defaultNavPrefs, type NavPrefs } from "./navConfig";

const ALL_IDS = MODULES.map(m => m.id);

function storageKey(workspaceId: string | null, roleId: string): string {
  return `musa-v2/nav/${workspaceId || "ws"}/${roleId}`;
}

function sanitize(raw: unknown): NavPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<NavPrefs>;
  const pick = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.filter((id): id is string => typeof id === "string" && ALL_IDS.includes(id)) : [];
  const pin = pick(candidate.pin);
  const rest = pick(candidate.rest);
  const hid = pick(candidate.hid);
  // Un id solo puede vivir en una sección; el primero gana.
  const seen = new Set<string>();
  const dedupe = (ids: string[]): string[] =>
    ids.filter(id => (seen.has(id) ? false : (seen.add(id), true)));
  return {
    pin: dedupe(pin),
    rest: dedupe(rest.filter(id => !pin.includes(id))),
    hid: dedupe(hid.filter(id => !pin.includes(id) && !rest.includes(id))),
  };
}

/** Lee las preferencias del nav; completa lo faltante con el default del rol. */
export function loadNavPrefs(workspaceId: string | null, roleId: string): NavPrefs {
  const fallback = defaultNavPrefs(roleId);
  try {
    const raw = localStorage.getItem(storageKey(workspaceId, roleId));
    if (!raw) return fallback;
    const prefs = sanitize(JSON.parse(raw));
    if (!prefs) return fallback;
    const placed = new Set([...prefs.pin, ...prefs.rest, ...prefs.hid]);
    const missing = ALL_IDS.filter(id => !placed.has(id));
    return {
      pin: prefs.pin,
      rest: [...prefs.rest, ...missing.filter(id => !fallback.hid.includes(id))],
      hid: prefs.hid,
    };
  } catch {
    return fallback;
  }
}

export function saveNavPrefs(workspaceId: string | null, roleId: string, prefs: NavPrefs): void {
  try {
    localStorage.setItem(storageKey(workspaceId, roleId), JSON.stringify(prefs));
  } catch {
    // localStorage bloqueado: la personalización vive solo en la sesión.
  }
}

/** Rol activo persistido (los 7 del prototipo). */
export function loadRole(): string {
  try {
    const role = localStorage.getItem("musa-v2/role");
    return role && ["global", "disenador", "motion", "video", "copy", "community", "automatizador"].includes(role)
      ? role
      : "global";
  } catch {
    return "global";
  }
}

export function saveRole(roleId: string): void {
  try {
    localStorage.setItem("musa-v2/role", roleId);
  } catch {
    // noop
  }
}

/** Tema del shell (oscuro por defecto, como el prototipo). */
export function loadTheme(): "dark" | "light" {
  try {
    return localStorage.getItem("musa-v2/theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function saveTheme(theme: "dark" | "light"): void {
  try {
    localStorage.setItem("musa-v2/theme", theme);
  } catch {
    // noop
  }
}

/** Mueve `id` a la posición de `targetId` dentro de su sección (drag). */
export function reorderWithin(prefs: NavPrefs, id: string, targetId: string): NavPrefs {
  const sectionOf = (m: string) => (prefs.pin.includes(m) ? prefs.pin : prefs.rest.includes(m) ? prefs.rest : null);
  const from = sectionOf(id);
  const to = sectionOf(targetId);
  if (!from || !to || from !== to) return prefs;
  const moved = [...from];
  const fromIdx = moved.indexOf(id);
  const toIdx = moved.indexOf(targetId);
  moved.splice(fromIdx, 1);
  moved.splice(toIdx, 0, id);
  return from === prefs.pin ? { ...prefs, pin: moved } : { ...prefs, rest: moved };
}

/** Cambia un módulo de sección (pin/rest/hid) manteniendo las demás intactas. */
export function placeModule(prefs: NavPrefs, id: string, placement: "pin" | "rest" | "hid"): NavPrefs {
  const strip = (ids: string[]) => ids.filter(x => x !== id);
  const next: NavPrefs = { pin: strip(prefs.pin), rest: strip(prefs.rest), hid: strip(prefs.hid) };
  next[placement] = [...next[placement], id];
  return next;
}
