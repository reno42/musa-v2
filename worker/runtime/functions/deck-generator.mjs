/**
 * Deck Generator — deterministic scaffolding for AI-composed decks.
 *
 * Philosophy (see docs/AGENT_BRIDGE.md): everything that is NOT a creative
 * decision is decided by the system so the AI never wastes tokens on it:
 *
 *   DETERMINISTIC (the harness)          FREE (the AI)
 *   ─────────────────────────────        ─────────────────────────
 *   frame size (1920×1080)               composition of each slide
 *   side-by-side placement, no overlap   cover composition (optional)
 *   slide count = spec.slides.length     content html/css per slide
 *   page numbering (NN / TT)
 *   title font / body font
 *   cover on corporate color
 *   font imports + CSS variables
 *
 * The AI sends WHAT each slide contains; the system guarantees WHERE the
 * deck chrome lives and that the whole deck reads as one document.
 */

export const DECK_FRAME_W = 1920;
export const DECK_FRAME_H = 1080;
export const DECK_FRAME_GAP = 160;
export const DECK_MAX_SLIDES = 40;

const CHROME = {
  padX: 96,
  titleTop: 72,
  titleSize: 56,
  contentTop: 200,
  contentHeight: 760,
  // Anchored from the top (1080 − 72) so the chrome lands identically in the
  // editor's shadow DOM and in renders, regardless of the container's height.
  footerTop: DECK_FRAME_H - 72,
  footerSize: 22,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Relative luminance of a #rrggbb color (0 dark … 1 light). */
export function colorLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return 0.5;
  const int = parseInt(m[1], 16);
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel((int >> 16) & 255)
    + 0.7152 * channel((int >> 8) & 255)
    + 0.0722 * channel(int & 255);
}

/** Deterministic readable ink color for a given background. */
export function inkFor(background) {
  return colorLuminance(background) > 0.45 ? "#141414" : "#F5F1E8";
}

function googleFontsImport(families) {
  const unique = [...new Set(families.filter(Boolean))];
  // Bare family=Name is the only always-valid css2 form. The previously
  // hardcoded ital+wght axis (weights 300 through 800, upright and italic)
  // returns HTTP 400 for families that lack those axes — Space Grotesk has
  // no italic and stops at 700 — so the stylesheet never arrived and decks
  // collapsed to serif on every reload.
  const parts = unique.map(name => `family=${name.trim().replace(/\s+/g, "+")}`);
  return `@import url('https://fonts.googleapis.com/css2?${parts.join("&")}&display=swap');`;
}

/** Shared deterministic chrome CSS injected into every frame. */
function chromeCss(brand) {
  const ink = inkFor(brand.background);
  const muted = colorLuminance(brand.background) > 0.45 ? "rgba(20,20,20,0.55)" : "rgba(245,241,232,0.55)";
  return [
    googleFontsImport([brand.titleFont, brand.bodyFont]),
    `:root, body { --deck-brand: ${brand.color}; --deck-bg: ${brand.background}; --deck-ink: ${ink}; --deck-muted: ${muted}; --deck-title-font: '${brand.titleFont}', serif; --deck-body-font: '${brand.bodyFont}', sans-serif; }`,
    `body { margin: 0; width: ${DECK_FRAME_W}px; height: ${DECK_FRAME_H}px; background: ${brand.background}; font-family: var(--deck-body-font); overflow: hidden; }`,
    `[data-deck-chrome="title"] { position: absolute; left: ${CHROME.padX}px; top: ${CHROME.titleTop}px; margin: 0; max-width: ${DECK_FRAME_W - CHROME.padX * 2}px; font-family: var(--deck-title-font); font-weight: 500; font-size: ${CHROME.titleSize}px; line-height: 1.1; color: var(--deck-ink); }`,
    `[data-deck-chrome="title-accent"] { position: absolute; left: ${CHROME.padX}px; top: ${CHROME.titleTop + 84}px; width: 72px; height: 4px; background: var(--deck-brand); border-radius: 2px; }`,
    `[data-deck-chrome="content"] { position: absolute; left: ${CHROME.padX}px; top: ${CHROME.contentTop}px; width: ${DECK_FRAME_W - CHROME.padX * 2}px; height: ${CHROME.contentHeight}px; }`,
    `[data-deck-chrome="page"] { position: absolute; right: ${CHROME.padX}px; top: ${CHROME.footerTop}px; font-family: var(--deck-body-font); font-size: ${CHROME.footerSize}px; letter-spacing: 0.12em; color: var(--deck-muted); }`,
    `[data-deck-chrome="deck-name"] { position: absolute; left: ${CHROME.padX}px; top: ${CHROME.footerTop}px; font-family: var(--deck-body-font); font-size: ${CHROME.footerSize}px; letter-spacing: 0.12em; color: var(--deck-muted); text-transform: uppercase; }`,
  ].join("\n");
}

function defaultCoverHtml(spec) {
  return [
    `<div data-layer-id="cover-brand" data-layer-name="Marca" class="fd-cover-brand">${escapeHtml(spec.brand.name)}</div>`,
    `<h1 data-layer-id="cover-title" data-layer-name="Título" class="fd-cover-title">${escapeHtml(spec.name)}</h1>`,
    `<div data-layer-id="cover-rule" data-layer-name="Regla" class="fd-cover-rule"></div>`,
    `<div data-layer-id="cover-count" data-layer-name="Índice" class="fd-cover-count">${pad2(spec.slides.length)} secciones</div>`,
  ].join("\n");
}

function defaultCoverCss(ink) {
  // The rule sits ABOVE the title so it never collides with it no matter
  // how many lines the deck name wraps into.
  return [
    `.fd-cover-brand { position: absolute; left: ${CHROME.padX}px; top: ${CHROME.titleTop}px; font-family: var(--deck-body-font); font-weight: 600; font-size: 28px; letter-spacing: 0.4em; text-transform: uppercase; color: ${ink}; }`,
    `.fd-cover-rule { position: absolute; left: ${CHROME.padX}px; top: 330px; width: 120px; height: 5px; background: ${ink}; opacity: 0.85; border-radius: 3px; }`,
    `.fd-cover-title { position: absolute; left: ${CHROME.padX}px; top: 380px; margin: 0; max-width: 1600px; font-family: var(--deck-title-font); font-weight: 450; font-size: 128px; line-height: 1.08; color: ${ink}; }`,
    `.fd-cover-count { position: absolute; left: ${CHROME.padX}px; top: ${CHROME.footerTop}px; font-family: var(--deck-body-font); font-size: ${CHROME.footerSize}px; letter-spacing: 0.14em; color: ${ink}; opacity: 0.7; }`,
  ].join("\n");
}

/**
 * Build deterministic deck frames from an AI/human spec.
 *
 * spec = {
 *   name: "Design System — Acme",
 *   brand: { name, color, titleFont?, bodyFont?, background? },
 *   cover?: { html, css },            // free composition; bg/fonts stay deterministic
 *   slides: [{ title, html?, css? }]  // free composition inside the content zone
 * }
 */
export function buildDeckFrames(spec) {
  if (!spec || typeof spec !== "object") throw new Error("deck spec is required");
  if (!spec.name) throw new Error("deck spec.name is required");
  if (!spec.brand?.color) throw new Error("deck spec.brand.color is required");
  if (!Array.isArray(spec.slides) || spec.slides.length === 0) throw new Error("deck spec.slides must be a non-empty array");
  if (spec.slides.length > DECK_MAX_SLIDES) throw new Error(`deck supports up to ${DECK_MAX_SLIDES} slides`);

  const brand = {
    name: spec.brand.name || spec.name,
    color: spec.brand.color,
    titleFont: spec.brand.titleFont || "Fraunces",
    bodyFont: spec.brand.bodyFont || "Inter",
    background: spec.brand.background || "#FFFFFF",
  };
  const total = spec.slides.length;
  const frames = [];
  const stride = DECK_FRAME_W + DECK_FRAME_GAP;

  // ── Cover: corporate color, free composition on top ──
  const coverInk = inkFor(brand.color);
  const coverBrand = { ...brand, background: brand.color };
  frames.push({
    id: "frame_deck_cover",
    name: "00 — Portada",
    x: 0, y: 0,
    width: DECK_FRAME_W, height: DECK_FRAME_H,
    background: brand.color,
    html: spec.cover?.html || defaultCoverHtml({ ...spec, brand }),
    css: [
      chromeCss(coverBrand),
      spec.cover?.html ? (spec.cover.css || "") : defaultCoverCss(coverInk),
    ].join("\n"),
  });

  // ── Slides: deterministic chrome + free content composition ──
  spec.slides.forEach((slide, index) => {
    const number = index + 1;
    const title = slide.title || `Sección ${pad2(number)}`;
    frames.push({
      id: `frame_deck_${pad2(number)}`,
      name: `${pad2(number)} — ${title}`,
      x: number * stride, y: 0,
      width: DECK_FRAME_W, height: DECK_FRAME_H,
      background: brand.background,
      html: [
        `<h2 data-deck-chrome="title" data-layer-id="s${pad2(number)}-title" data-layer-name="Título">${escapeHtml(title)}</h2>`,
        `<div data-deck-chrome="title-accent" data-layer-id="s${pad2(number)}-accent" data-layer-name="Acento"></div>`,
        `<div data-deck-chrome="content" data-layer-id="s${pad2(number)}-content" data-layer-name="Contenido">`,
        slide.html || `<p style="font-family:var(--deck-body-font);color:var(--deck-muted);font-size:28px">Pendiente de contenido.</p>`,
        `</div>`,
        `<div data-deck-chrome="deck-name" data-layer-id="s${pad2(number)}-deck" data-layer-name="Deck">${escapeHtml(brand.name)}</div>`,
        `<div data-deck-chrome="page" data-layer-id="s${pad2(number)}-page" data-layer-name="Página">${pad2(number)} / ${pad2(total)}</div>`,
      ].join("\n"),
      css: [chromeCss(brand), slide.css || ""].join("\n"),
    });
  });

  return { frames, brand, total: frames.length };
}
