/** The account chip shows the PERSON, not the mailbox. Priority: profile
 *  display_name → first_name → Supabase metadata full_name/name → and only
 *  as a last resort the email local-part. A display_name/metadata value that
 *  merely repeats the email local-part verbatim ("renzo@…" → seed "renzo")
 *  is a bootstrap seed, not a name — it is skipped so a real first_name can
 *  win. The comparison is CASE-SENSITIVE: the seed always copies the
 *  local-part verbatim (lowercase), so a human-typed "Renzo" must survive —
 *  case-insensitive matching used to discard it and the chip fell back to
 *  the raw local-part, rendering "renzo" no matter what the user saved. */
export interface AccountNameParts {
  displayName?: string | null;
  firstName?: string | null;
  metadataName?: string | null;
  email?: string | null;
}

export function resolveAccountName(parts: AccountNameParts): string {
  const email = parts.email?.trim() || "";
  const local = email.split("@")[0] || "";
  const usable = (raw?: string | null): string => {
    const value = raw?.trim() || "";
    if (!value) return "";
    if (local && value === local) return ""; // bootstrap seed (verbatim local-part), not a name
    return value;
  };
  return usable(parts.displayName) || usable(parts.firstName) || usable(parts.metadataName) || email.split("@")[0] || "";
}
