/**
 * Route persistence + deep-link redirect logic.
 *
 * 1. On every navigation, save the current path+search+hash to sessionStorage.
 * 2. On boot, if the user is logged in and there's a saved route, restore it.
 * 3. When auth gate blocks a route, save the intended URL so after login we
 *    redirect back to it instead of the dashboard.
 */

const LAST_ROUTE_KEY = "futuraria-last-route";
const PENDING_REDIRECT_KEY = "futuraria-pending-redirect";

/** Save the current URL so a refresh restores the same view. */
export function saveCurrentRoute(): void {
  try {
    const url = window.location.pathname + window.location.search + window.location.hash;
    // Don't save the root landing page — that's the default
    if (url !== "/" && url !== "/#workspace") {
      sessionStorage.setItem(LAST_ROUTE_KEY, url);
    }
  } catch { /* sessionStorage may be blocked */ }
}

/** Get the last saved route (or null if none). */
export function getLastRoute(): string | null {
  try {
    return sessionStorage.getItem(LAST_ROUTE_KEY);
  } catch {
    return null;
  }
}

/** Save a pending redirect URL (used when auth blocks a deep link). */
export function setPendingRedirect(url: string): void {
  try {
    sessionStorage.setItem(PENDING_REDIRECT_KEY, url);
  } catch { /* ignore */ }
}

/** Consume the pending redirect URL (returns it and clears it). */
export function consumePendingRedirect(): string | null {
  try {
    const url = sessionStorage.getItem(PENDING_REDIRECT_KEY);
    if (url) sessionStorage.removeItem(PENDING_REDIRECT_KEY);
    return url;
  } catch {
    return null;
  }
}

/** Check if there's a pending redirect. */
export function hasPendingRedirect(): boolean {
  try {
    return !!sessionStorage.getItem(PENDING_REDIRECT_KEY);
  } catch {
    return false;
  }
}

/**
 * Determine what URL to navigate to after successful login.
 * Priority: pending redirect > saved route > workspace hash.
 */
export function resolvePostLoginUrl(): string {
  const pending = consumePendingRedirect();
  if (pending) return pending;

  const last = getLastRoute();
  if (last && last !== "/" && last !== "/#workspace") return last;

  return "/#workspace";
}
