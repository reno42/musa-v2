/**
 * Trigger a browser file download reliably.
 *
 * The common `document.createElement("a"); a.download = …; a.click()` pattern
 * clicks an element that was never attached to the document. Chrome and
 * Firefox tolerate that, but Safari and many embedded/sandboxed webviews do
 * not honor `download` on a detached anchor — the click falls through to a
 * plain navigation instead, so the browser opens the blob as its own page
 * (a raw image, or — for an HTML export page — that page's own UI) instead
 * of saving a file. Appending the anchor to the document before clicking,
 * then removing it right after, is what makes the download attribute apply
 * consistently across browsers.
 */
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Convenience wrapper: download a Blob and revoke its object URL afterward. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
}
