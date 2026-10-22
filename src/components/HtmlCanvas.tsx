import React, { useRef, useEffect, useCallback, useState } from "react";
import { ensureDesignFontImports } from "../lib/googleFonts";

interface HtmlCanvasProps {
  html: string;
  css: string;
  width: number;
  height: number;
  zoom?: number;
  onSelectElement?: (layerId: string) => void;
}

/** CSP meta tag blocking scripts, allowing inline styles + public font files. */
function buildCspMeta(): string {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'none'; img-src 'self' https: data:; font-src 'self' https: data:">`;
}

interface HtmlCanvasSrcDocOptions {
  /** Presentation is read-only, so it must not emit the editor's click bridge. */
  includeInteractionBridge?: boolean;
}

/** Google font imports in a srcdoc are less reliable than stylesheet links.
 * Move them into <link>s, where they load before the frame CSS is painted. */
function extractGoogleFontStylesheets(css: string): { css: string; hrefs: string[] } {
  const hrefs: string[] = [];
  const cleaned = css.replace(/@import\s+url\(\s*(['"]?)(https:\/\/fonts\.googleapis\.com\/[^'")\s]+)\1\s*\)\s*;/gi, (_match, _quote, href: string) => {
    if (!hrefs.includes(href)) hrefs.push(href);
    return "";
  });
  return { css: cleaned, hrefs };
}

/** Assembles a complete, font-ready HTML document for an isolated frame. */
export function buildHtmlCanvasSrcDoc(
  html: string,
  css: string,
  width: number,
  height: number,
  { includeInteractionBridge = true }: HtmlCanvasSrcDocOptions = {},
): string {
  // Frames edited by AI can name a webfont without persisting its import.
  // The editor repairs this in its shadow root; presentation must do the
  // same repair because it renders in a separate iframe document.
  const { css: fontReadyCss } = ensureDesignFontImports(css, html);
  const { css: frameCss, hrefs } = extractGoogleFontStylesheets(fontReadyCss);
  const fontLinks = hrefs.map(href => `<link rel="stylesheet" href="${href}">`).join("");
  const interactionBridge = includeInteractionBridge ? `<script>
  // postMessage bridge: click on element sends layerId to parent
  document.body.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.hasAttribute && el.hasAttribute('data-layer-id')) {
        window.parent.postMessage({ type: 'select', layerId: el.getAttribute('data-layer-id') }, '*');
        break;
      }
      el = el.parentElement;
    }
  });
</script>` : "";

  return `<!DOCTYPE html>
<html>
<head>${buildCspMeta()}${fontLinks}
<style>
  html, body { margin: 0; padding: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
  ${frameCss}
</style>
</head>
<body>
${html}
${interactionBridge}
</body>
</html>`;
}

export function HtmlCanvas({ html, css, width, height, zoom = 1, onSelectElement }: HtmlCanvasProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(zoom);

  useEffect(() => {
    setScale(zoom);
  }, [zoom]);

  // Listen for postMessage from iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === "select" && e.data?.layerId) {
        onSelectElement?.(e.data.layerId);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onSelectElement]);

  const srcDoc = buildHtmlCanvasSrcDoc(html, css, width, height);

  const containerStyle: React.CSSProperties = {
    overflow: "auto",
    background: "#1a1a2e",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.06)",
  };

  const iframeStyle: React.CSSProperties = {
    width: width * scale,
    height: height * scale,
    border: "none",
    transformOrigin: "top left",
    display: "block",
  };

  return (
    <div style={containerStyle}>
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin"
        srcDoc={srcDoc}
        style={iframeStyle}
        title="HTML Preview"
      />
    </div>
  );
}
