/**
 * Fetching an image from a link somebody pasted.
 *
 * Two things make this harder than one fetch call.
 *
 * A URL typed by a user is a URL typed by a user: pointed at the server, it
 * will happily resolve to 169.254.169.254 or a private address and read
 * whatever is there. Every hop is checked, not just the first — a public
 * hostname is free to redirect somewhere private.
 *
 * And almost every real image link redirects. Unsplash, Pexels and Drive all
 * bounce through at least one hop, so `redirect: "error"` — safe, and what the
 * asset route used to do — rejected nearly every link a person would actually
 * paste. Redirects are followed here, up to a small limit, revalidating as we
 * go.
 */

import { assertSafeIntegrationEndpoint } from "./workspaceIntegrations.js";
import { normalizeImageUrl, unsupportedLinkReason } from "./imageLinks.js";

export { normalizeImageUrl, unsupportedLinkReason };

const MAX_REDIRECTS = 4;
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export interface RemoteImage {
  buffer: Buffer;
  mimeType: string;
  /** Where it actually came from after redirects — worth recording. */
  finalUrl: string;
}

/** Downloads an image, following redirects, validating every hop. */
export async function fetchRemoteImage(rawUrl: string): Promise<RemoteImage> {
  const blocked = unsupportedLinkReason(rawUrl);
  if (blocked) throw new Error(blocked);

  let target = normalizeImageUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeIntegrationEndpoint(target);
    const response = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "image/*" },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirección sin destino (${response.status})`);
      target = new URL(location, target).toString();
      continue;
    }

    if (!response.ok) throw new Error(`La descarga falló con ${response.status}`);

    const mimeType = (response.headers.get("content-type") || "").split(";")[0].trim();
    if (!mimeType.startsWith("image/")) {
      throw new Error(
        `El enlace no devolvió una imagen sino ${mimeType || "contenido desconocido"}. `
        + "Suele pasar cuando el archivo es privado y responde con una página de inicio de sesión.",
      );
    }

    // Trust the header enough to reject early, then measure what actually came.
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) throw new Error("La imagen supera el límite de 10MB");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error("La imagen supera el límite de 10MB");
    if (buffer.length === 0) throw new Error("El enlace devolvió un archivo vacío");

    return { buffer, mimeType, finalUrl: target };
  }

  throw new Error("Demasiadas redirecciones");
}
