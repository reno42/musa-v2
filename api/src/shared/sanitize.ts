import DOMPurify from "dompurify";

/** Unified DOMPurify configuration used by both MCP (worker/runtime/functions/mcp.mjs) and REST API */
const ALLOWED_TAGS = [
  "div", "span", "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "img", "a", "br", "svg", "path", "g", "circle", "rect",
  "line", "polygon", "polyline", "text", "tspan",
  "section", "article", "header", "footer", "nav", "main",
  "ul", "ol", "li", "button", "strong", "em", "blockquote",
  "code", "pre", "hr", "table", "tr", "td", "th", "thead", "tbody",
  "input", "textarea", "label", "form", "b", "i", "u",
];

const ALLOWED_ATTR = [
  "class", "id", "src", "alt", "href", "data-layer-id", "style",
  "width", "height", "viewBox", "fill", "d", "stroke", "stroke-width",
  "cx", "cy", "r", "rx", "ry", "x", "y", "transform",
  "type", "placeholder", "value", "for", "name",
];

/**
 * Sanitize HTML string using DOMPurify.
 * Returns sanitized HTML or the original if sanitization fails.
 */
export function sanitizeHtml(html: string): string {
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
    });
  } catch {
    return html; // fallback: return original if sanitization fails
  }
}

export { ALLOWED_TAGS, ALLOWED_ATTR };
