/**
 * URL-safe slug generator (mirrors the PostgreSQL slugify() function).
 * NFD normalize → strip diacritics → em-dash→hyphen → lowercase →
 * collapse hyphens → reserved-word guard.
 *
 * Used at create/update time so new entities get a slug immediately,
 * not just when the backfill migration runs.
 */

const RESERVED = new Set([
  "api","mcp","w","dashboard","assets","covers",
  "exports","storage","settings","graph","login",
  "admin","health","trash","landing","editor",
]);

export function slugify(input: string): string {
  let result = input
    // NFD normalize + strip combining diacritical marks (U+0300–U+036F)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Em dash, en dash, horizontal bar → plain hyphen
    .replace(/[–—―]/g, "-")
    // Lowercase
    .toLowerCase()
    // Any character that is NOT a-z, 0-9, or hyphen → hyphen
    .replace(/[^a-z0-9-]/g, "-")
    // Collapse consecutive hyphens
    .replace(/-+/g, "-")
    // Trim leading / trailing hyphens
    .replace(/^-+|-+$/g, "");

  if (result.length === 0) result = "untitled";
  if (RESERVED.has(result)) result = result + "-1";

  return result;
}
