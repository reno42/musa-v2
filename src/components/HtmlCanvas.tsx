import React, { useRef, useEffect, useCallback, useState } from "react";
import { extractFontCssLinks } from "../lib/googleFonts";

interface HtmlCanvasProps {
  html: string;
  css: string;
  width: number;
  height: number;
  zoom?: number;
  onSelectElement?: (layerId: string) => void;
}

/** CSP meta tag blocking scripts, allowing inline styles + same-origin fonts.
 *  No Google hosts: font stylesheets and files arrive via /api/fonts/* like
 *  every other render fetch. */
function buildCspMeta(): string {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; img-src 'self' https: data:; font-src 'self' data:">`;
}

/** Assembles complete HTML document for srcDoc */
function buildSrcDoc(html: string, css: string, width: number, height: number): string {
  // Font imports become same-origin <link>s in the head. Inside the <style>
  // below, the @import would sit after the html/body reset rule and the CSS
  // parser drops it silently — the preview lost its fonts with zero noise.
  const fontLinks = extractFontCssLinks(css)
    .map(href => `<link rel="stylesheet" href="${href.replace(/&/g, "&amp;")}">`)
    .join("\n");
  const cssWithoutImports = css.replace(/@import\s+url\(['"]?https?:\/\/[^'"]+['"]?\)[^;]*;/g, "");
  return `<!DOCTYPE html>
<html>
<head>${buildCspMeta()}
${fontLinks}
<style>
  html, body { margin: 0; padding: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
  ${cssWithoutImports}
</style>
</head>
<body>
${html}
<script>
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
</script>
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

  const srcDoc = buildSrcDoc(html, css, width, height);

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
