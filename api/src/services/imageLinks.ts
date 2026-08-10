/**
 * What a pasted image link means, before anything is fetched.
 *
 * Pure on purpose — no imports — so QA/remote-image.test.mjs can load it
 * without dragging in the Supabase client, the same split brandFiling.ts has
 * from brandGraph.ts.
 */

/**
 * Rewrites the share links people actually copy into something that returns
 * bytes. A Drive "view" link is an HTML page; the uc?export form is the file.
 * Only works for files shared as "anyone with the link" — anything stricter
 * answers with a sign-in page, which the fetcher reports as "not an image".
 */
export function normalizeImageUrl(rawUrl: string): string {
  const url = rawUrl.trim();

  const drive = url.match(/^https?:\/\/drive\.google\.com\/file\/d\/([^/]+)/i)
    || url.match(/^https?:\/\/drive\.google\.com\/open\?id=([^&]+)/i);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;

  // Dropbox serves a preview page unless asked for the raw file.
  if (/^https?:\/\/(www\.)?dropbox\.com\//i.test(url)) {
    if (/[?&]dl=0/.test(url)) return url.replace(/([?&])dl=0/, "$1raw=1");
    if (/[?&]raw=1/.test(url)) return url;
    return `${url}${url.includes("?") ? "&" : "?"}raw=1`;
  }

  return url;
}

/**
 * Asks the source for a smaller copy instead of downloading the original.
 *
 * The server has no image library and no business growing one, but the CDNs a
 * copywriter actually pastes from all resize on request — so the cheapest
 * compression available is to never receive the big file. An Unsplash original
 * is 15-25MB; the same URL with w=2000&q=75 is a few hundred KB, resized on
 * their machines, for free.
 *
 * Untouched for anything unrecognised: a query string invented for a host that
 * does not understand it is at best ignored and at worst a 404.
 */
export function requestSmallerVariant(rawUrl: string, maxEdge = 2000, quality = 75): string {
  let url: URL;
  try { url = new URL(rawUrl.trim()); } catch { return rawUrl; }
  const host = url.hostname.toLowerCase();

  if (host === "images.unsplash.com") {
    url.searchParams.set("w", String(maxEdge));
    url.searchParams.set("q", String(quality));
    url.searchParams.set("fit", "max");   // never upscale, keep aspect
    url.searchParams.set("fm", "jpg");
    return url.toString();
  }

  if (host === "images.pexels.com") {
    url.searchParams.set("auto", "compress");
    url.searchParams.set("cs", "tinysrgb");
    url.searchParams.set("w", String(maxEdge));
    return url.toString();
  }

  if (host === "cdn.pixabay.com" || host.endsWith(".shopify.com")) {
    // Both encode size in the path rather than the query; leave them be.
    return rawUrl;
  }

  return rawUrl;
}

/**
 * A reason, in Spanish, for the links that cannot work at all — either because
 * they are behind a login the server has no way through, or because they point
 * at a gallery page rather than the picture on it. Returning the reason up
 * front beats a download that fails with something inscrutable.
 */
export function unsupportedLinkReason(rawUrl: string): string | null {
  const url = rawUrl.trim().toLowerCase();
  if (/sharepoint\.com|teams\.microsoft\.com|onedrive\.live\.com|1drv\.ms/.test(url)) {
    return "Los enlaces de Teams, SharePoint y OneDrive exigen iniciar sesión, así que el servidor no puede descargar la imagen. Descárgala y súbela como Asset, o usa un enlace público.";
  }
  if (/^https?:\/\/(www\.)?unsplash\.com\/photos\//.test(url)) {
    return "Ese es el enlace de la página de Unsplash, no de la imagen. Abre la foto, click derecho sobre ella y copia la dirección de la imagen (images.unsplash.com/...).";
  }
  if (/^https?:\/\/(www\.)?pexels\.com\/(photo|es-es)\//.test(url)) {
    return "Ese es el enlace de la página de Pexels, no de la imagen. Usa 'copiar dirección de la imagen' (images.pexels.com/...).";
  }
  return null;
}
