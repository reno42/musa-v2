import React, { useRef, useEffect, useCallback, useState } from "react";

interface HtmlCanvasProps {
  html: string;
  css: string;
  width: number;
  height: number;
  zoom?: number;
  onSelectElement?: (layerId: string) => void;
}

/** CSP meta tag blocking scripts, allowing inline styles + external fonts */
function buildCspMeta(): string {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; script-src 'none'; img-src 'self' https: data:; font-src 'self' https://fonts.gstatic.com">`;
}

/** Assembles complete HTML document for srcDoc */
export function buildHtmlCanvasSrcDoc(html: string, css: string, width: number, height: number): string {
  return `<!DOCTYPE html>
<html>
<head>${buildCspMeta()}
<style>
  html, body { margin: 0; padding: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
  ${css}
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
