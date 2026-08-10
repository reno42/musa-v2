/**
 * File metadata changed here — anyone showing that file should re-read it.
 *
 * The editor's Information panel and the brand table are two views of one row
 * in design_file_meta. They already write the same columns, but each cached
 * its own copy, so whichever was already open kept showing the old value until
 * it happened to remount. This is the nudge that closes that gap.
 *
 * Same tab only, deliberately: a second tab re-reads on focus anyway, and a
 * storage-event broadcast would have every open tab refetching the whole graph
 * on every keystroke-sized save.
 */

const EVENT = "futuraria:file-meta-changed";

/** Announce that this template's metadata was just written. */
export function notifyMetaChanged(templateId: string): void {
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: templateId }));
  } catch { /* non-browser context */ }
}

/**
 * Run `handler` whenever any file's metadata is written elsewhere in the app.
 * Returns the unsubscribe function, so it drops straight into a useEffect.
 */
export function onMetaChanged(handler: (templateId: string) => void): () => void {
  const listener = (event: Event) => {
    const id = (event as CustomEvent<string>).detail;
    if (typeof id === "string") handler(id);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
