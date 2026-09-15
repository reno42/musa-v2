/**
 * Rewrites `width`/`height` inside `html`/`body` rules of a frame's persisted
 * CSS so a resized frame stops clipping at its birth size.
 *
 * Frames created with the F tool (EditorV2 `handleCreateFrameAt`) embed
 * `body { width: 1080px; height: 1080px; ... }`. `mapBodySelectors` re-emits
 * that rule as `#__df_content {...}` AFTER the live clip rule, so on cascade
 * the stale birth size wins and a grown frame keeps clipping its content.
 * `handleFrameResize` calls this with the new size so the persisted rule and
 * the system rule agree.
 *
 * Only `width`/`height` declarations inside html/body rules change; other
 * declarations are preserved. Rules without width/height are left untouched,
 * nothing is added, and a CSS without html/body rules returns unchanged (the
 * system clip rule alone is sufficient there).
 */
export function resizeFrameBodyCss(css: string, width: number, height: number): string {
  return css.replace(
    /(^|[}\s,])((?:html|body)\b[^{]*\{)([^}]*)(\})/gi,
    (match: string, prefix: string, selector: string, inner: string, close: string) => {
      let next = inner;
      if (/(^|[;\s])width\s*:/i.test(next)) next = next.replace(/((?:^|;)\s*)width\s*:\s*[^;}]+/i, `$1width: ${width}px`);
      if (/(^|[;\s])height\s*:/i.test(next)) next = next.replace(/((?:^|;)\s*)height\s*:\s*[^;}]+/i, `$1height: ${height}px`);
      return `${prefix}${selector}${next}${close}`;
    },
  );
}
