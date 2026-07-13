function encodeFamily(family: string): string {
  return encodeURIComponent(family.trim()).replace(/%20/g, "+");
}

function numericVariants(variants: string[]): string[] {
  return [...new Set(variants.filter(variant => /^\d{3}$/.test(variant)))];
}

export function googleFontHref(family: string, variants: string[] = []): string {
  const weights = numericVariants(variants);
  const axis = weights.length ? `:wght@${weights.join(";")}` : "";
  return `https://fonts.googleapis.com/css2?family=${encodeFamily(family)}${axis}&display=swap`;
}

export function ensureGoogleFontImport(css: string, family: string): string {
  const encoded = encodeFamily(family);
  if (css.includes(`family=${encoded}`)) return css;
  return `@import url('${googleFontHref(family)}');\n${css}`;
}

export function loadGoogleFontInDocument(family: string, variants: string[] = []): void {
  const id = `gf-${family.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = googleFontHref(family, variants);
  document.head.appendChild(link);
}

export function injectGoogleFontIntoFrames(family: string): void {
  const href = googleFontHref(family);
  for (const frame of document.querySelectorAll("[data-frame-id]")) {
    const host = [...frame.querySelectorAll("*")].find(element => (element as HTMLElement).shadowRoot) as HTMLElement | undefined;
    const shadow = host?.shadowRoot;
    if (!shadow || [...shadow.querySelectorAll("link")].some(link => (link as HTMLLinkElement).href === href)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    shadow.insertBefore(link, shadow.firstChild);
  }
}
