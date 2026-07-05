// ═══════════════════════════════════════════════════════════════
// template-profiler.mjs — Deterministic Template Slot Detection Engine
//
// Given a frame's HTML + CSS, this module extracts:
//   - Content slots (text, image, richtext, cta) with CSS selectors
//   - Estimated text capacity (maxChars) per slot
//   - Layout type classification (single-block, multi-block, hero, gallery)
//   - Confidence score for auto-detection
//
// Supports data-slot attribute for explicit slot naming:
//   <h1 class="title" data-slot="headline"> → slot name = "headline"
//   <p class="desc">                     → slot name = "desc" (fallback)
//
// KEY GUARANTEE: Same input → identical output, every time.
// ═══════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import { parseCss } from "./design-extractor.mjs";

// Tag categories for slot classification
var TEXT_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "li", "label"];
var RICHTEXT_TAGS = ["div", "section", "article"];
var CTA_TAGS = ["button", "a"];
var IMAGE_TAGS = ["img"];

// CSS properties that indicate text sizing
var FONT_SIZE_PROPS = ["font-size"];
var WIDTH_PROPS = ["width"];

// ─── Content vs Chrome Filtering ─────────────────────────────────

// Element classes that indicate decorative elements (never content slots)
var DECORATIVE_CLASSES = [
  "bg-grid", "glow-tr", "glow-bl", "glow-tl", "glow-br",
  "star", "accent-line", "bg-pattern", "bg-gradient",
  "grid-line", "noise-overlay", "glass-effect", "blur-bg",
  "gradient-bg",
];

// Element classes that indicate template chrome (logo, page numbers, etc.)
var CHROME_CLASSES = [
  "futuraria-logo", "wordmark", "slide-num", "page-num",
  "footer-bar", "header-bar", "nav-bar", "breadcrumb",
  "pagination",
];

// Tags that are always structural (never content)
var STRUCTURAL_TAGS = [
  "html", "head", "body", "style", "script", "meta", "link",
  "br", "hr", "iframe", "svg",
];

/**
 * Determines whether an element is a content element (should be profiled
 * as a slot) or decorative/chrome (should be ignored).
 *
 * Rules (in order):
 *   1. Structural tags → excluded
 *   2. Decorative classes → excluded
 *   3. Chrome classes → excluded
 *   4. .slide container → excluded (entire frame wrapper)
 *   5. No text AND no src/background-image → excluded (empty decorative)
 *   6. Text < 3 chars and no data-slot and no src → excluded (likely chrome)
 */
function isContentElement($el) {
  var tag = ($el.prop("tagName") || "").toLowerCase();
  var classes = ($el.attr("class") || "").split(/\s+/);
  var text = ($el.text() || "").trim();
  var src = ($el.attr("src") || "").trim();
  var style = ($el.attr("style") || "").trim();
  var hasBgImage = /background-image\s*:\s*url\(/i.test(style);
  var hasSrc = !!src || hasBgImage;

  // Rule 1: structural tags
  if (STRUCTURAL_TAGS.indexOf(tag) !== -1) return false;

  // Rule 2: decorative classes
  for (var i = 0; i < DECORATIVE_CLASSES.length; i++) {
    if (classes.indexOf(DECORATIVE_CLASSES[i]) !== -1) return false;
  }

  // Rule 3: chrome classes
  for (var j = 0; j < CHROME_CLASSES.length; j++) {
    if (classes.indexOf(CHROME_CLASSES[j]) !== -1) return false;
  }

  // Rule 4: .slide container
  if (classes.indexOf("slide") !== -1) return false;

  // Rule 5: no text and no image
  if (!text && !hasSrc) return false;

  // Rule 6: very short text without data-slot or src
  if (text.length < 3 && !$el.attr("data-slot") && !hasSrc) return false;

  return true;
}

// ─── Slot Detection ─────────────────────────────────────────────

/**
 * Determine a slot name from an element.
 * Priority: data-slot attribute > class-based > tag-based > generic
 */
function detectSlotName($el, selector) {
  // Priority 1: Explicit data-slot attribute
  var explicit = ($el.attr("data-slot") || "").trim();
  if (explicit) return explicit;

  // Priority 2: Class-based
  var cls = ($el.attr("class") || "").trim();
  if (cls) {
    var parts = cls.split(/\s+/);
    // Try semantic classes first
    var semanticClasses = ["title", "subtitle", "headline", "body", "desc", "description",
      "hero", "cta", "button", "card", "block", "image", "icon", "avatar", "logo"];
    for (var i = 0; i < parts.length; i++) {
      if (semanticClasses.indexOf(parts[i].toLowerCase()) !== -1) {
        return parts[i].toLowerCase();
      }
    }
    // Fallback: first class
    return parts[0];
  }

  // Priority 3: Tag-based
  var tag = ($el.prop("tagName") || "").toLowerCase();
  if (TEXT_TAGS.indexOf(tag) !== -1) return "text";
  if (IMAGE_TAGS.indexOf(tag) !== -1) return "image";

  // Priority 4: Generic
  return "content";
}

/**
 * Classify slot type based on tag, content, and CSS
 */
function classifySlotType($el, tag) {
  if (IMAGE_TAGS.indexOf(tag) !== -1) return "image";
  if (CTA_TAGS.indexOf(tag) !== -1) {
    var txt = ($el.text() || "").trim().toLowerCase();
    var cls = ($el.attr("class") || "").toLowerCase();
    if (cls.indexOf("cta") !== -1 || cls.indexOf("button") !== -1 || cls.indexOf("action") !== -1 ||
        txt === "leer más" || txt === "ver más" || txt === "comprar" || txt === "suscribirse") {
      return "cta";
    }
    return "text";
  }
  if (TEXT_TAGS.indexOf(tag) !== -1) return "text";
  if (RICHTEXT_TAGS.indexOf(tag) !== -1) return "richtext";
  return "richtext";
}

/**
 * Estimate maximum characters for a text slot based on CSS.
 * Uses font-size and element width. Falls back to conservative defaults.
 */
function estimateMaxChars($el, cssRules, frameWidth) {
  var tag = ($el.prop("tagName") || "").toLowerCase();
  var cls = ($el.attr("class") || "").trim();

  // Find matching CSS rules for font-size and width
  var fontSize = null;
  var elWidth = null;
  var selector = buildSelector($el);

  if (cssRules) {
    for (var i = 0; i < cssRules.length; i++) {
      var r = cssRules[i];
      if (selectorMatches(r.selector, tag, cls, selector)) {
        if (r.property === "font-size" && !fontSize) {
          fontSize = parsePxValue(r.value);
        }
        if (r.property === "width" && !elWidth) {
          elWidth = parsePxValue(r.value);
        }
      }
    }
  }

  // Apply inline styles if present
  var inlineStyle = ($el.attr("style") || "").trim();
  if (inlineStyle) {
    var fsMatch = /font-size:\s*(\d+)/i.exec(inlineStyle);
    if (fsMatch) fontSize = parseInt(fsMatch[1], 10);
    var wMatch = /width:\s*(\d+)/i.exec(inlineStyle);
    if (wMatch) elWidth = parseInt(wMatch[1], 10);
  }

  // Defaults
  if (!fontSize) {
    var defaults = { h1: 32, h2: 24, h3: 20, h4: 18, h5: 16, h6: 14, p: 16, span: 14, a: 14, button: 14, li: 16 };
    fontSize = defaults[tag] || 16;
  }
  if (!elWidth) {
    elWidth = frameWidth || 1080;
  }

  // Formula: chars ≈ (width / (fontSize * 0.55)) * 1.4 (line-height factor)
  var charsPerLine = Math.floor(elWidth / (fontSize * 0.55));
  var lines = tag === "h1" || tag === "h2" ? 3 : tag === "p" || tag === "div" ? 10 : 4;
  return Math.min(charsPerLine * lines, 2000); // cap at 2000 chars
}

/**
 * Simple selector matching (supports class-only and tag+class selectors)
 */
function selectorMatches(ruleSelector, tag, cls, generatedSelector) {
  if (ruleSelector === generatedSelector) return true;
  if (cls && ruleSelector === "." + cls) return true;
  if (cls && ruleSelector === tag + "." + cls) return true;
  if (ruleSelector === tag) return true;
  // Multi-class: .class1.class2
  if (cls && ruleSelector.replace(/\./g, "") === cls.replace(/\s+/g, "")) return true;
  return false;
}

function buildSelector($el) {
  var tag = ($el.prop("tagName") || "").toLowerCase();
  var id = ($el.attr("id") || "").trim();
  var cls = ($el.attr("class") || "").trim();
  if (id) return "#" + id;
  if (cls) return tag + "." + cls.split(/\s+/).join(".");
  return tag;
}

function parsePxValue(value) {
  if (!value) return null;
  var pxMatch = /(\d+(?:\.\d+)?)\s*px/i.exec(value);
  if (pxMatch) return parseFloat(pxMatch[1]);
  var numMatch = /^(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (numMatch) return parseFloat(numMatch[1]);
  return null;
}

// ─── Layout Classification ──────────────────────────────────────

function classifyLayout(slots) {
  var textSlots = slots.filter(function (s) { return s.type === "text" || s.type === "richtext" || s.type === "cta"; });
  var imageSlots = slots.filter(function (s) { return s.type === "image"; });

  if (imageSlots.length >= 3 && textSlots.length <= 2) return "gallery";
  if (imageSlots.length >= 2 && textSlots.length <= 2) {
    // Check if images are large (hero-like)
    var hasLargeImage = imageSlots.length >= 1;
    return hasLargeImage ? "hero" : "gallery";
  }
  if (imageSlots.length === 1 && textSlots.length <= 2) return "hero";
  if (textSlots.length >= 3) return "multi-block";
  if (textSlots.length <= 1) return "single-block";
  if (textSlots.length === 2) return "multi-block";
  return "generic";
}

// ─── Main Profiling Functions ───────────────────────────────────

/**
 * Profile a single frame: detect slots, estimate capacity, classify layout.
 *
 * Two operating modes:
 *   EXPLICIT: If any element has data-slot → ONLY data-slot elements are slots
 *   AUTO: No data-slot found → auto-detect content elements, filter out chrome
 *
 * @param {string} html - Frame HTML content
 * @param {string} css - Frame CSS content
 * @param {Object} frameMeta - { id, name, width, height }
 * @returns {Object} - Frame profile
 */
export function profileFrame(html, css, frameMeta) {
  var $ = cheerio.load(html || "");
  var cssParsed = parseCss(css || "");
  var cssRules = cssParsed.rules || [];
  var frameWidth = frameMeta.width || 1080;
  var frameHeight = frameMeta.height || 1080;

  // ── Pre-scan: check if ANY element has data-slot → EXPLICIT mode ──
  var hasExplicitSlots = false;
  $("*").each(function () {
    if ($(this).attr("data-slot")) {
      hasExplicitSlots = true;
      return false; // break out of cheerio each()
    }
  });

  var slots = [];
  var seenText = {};
  var elementsScanned = 0;
  var elementsFiltered = 0;

  // Walk all elements with content or src
  $("*").each(function () {
    var $el = $(this);
    var tag = ($el.prop("tagName") || "").toLowerCase();
    var text = ($el.text() || "").trim();
    var src = ($el.attr("src") || "").trim();
    var backgroundStyle = ($el.attr("style") || "").trim();

    // Skip utility/structural tags (fast path)
    if (!tag || tag === "html" || tag === "head" || tag === "body" ||
        tag === "script" || tag === "style" || tag === "meta" || tag === "link") {
      return;
    }

    elementsScanned++;

    // ── EXPLICIT mode: only elements with data-slot ──
    if (hasExplicitSlots && !$el.attr("data-slot")) {
      elementsFiltered++;
      return;
    }

    // ── AUTO mode: filter decorative/chrome elements ──
    if (!hasExplicitSlots && !isContentElement($el)) {
      elementsFiltered++;
      return;
    }

    // Detect image slots
    if (IMAGE_TAGS.indexOf(tag) !== -1 || /background-image/i.test(backgroundStyle)) {
      var slotName = detectSlotName($el, buildSelector($el));
      // If name is "image" and there are multiple images, disambiguate
      if (slotName === "image") {
        var imgIdx = slots.filter(function (s) { return s.name === "image" || s.name.indexOf("image_") === 0; }).length;
        slotName = imgIdx > 0 ? "image_" + (imgIdx + 1) : "image";
      }
      slots.push({
        name: slotName,
        selector: buildSelector($el),
        type: "image",
        tag: tag,
        dimensions: ($el.attr("width") || $el.attr("data-width") || "") + "×" + ($el.attr("height") || $el.attr("data-height") || ""),
        sampleSrc: src || null,
        _explicit: hasExplicitSlots,
      });
      return;
    }

    // Detect text/richtext/cta slots
    if (TEXT_TAGS.indexOf(tag) !== -1 || RICHTEXT_TAGS.indexOf(tag) !== -1 || CTA_TAGS.indexOf(tag) !== -1) {
      if (!text || text.length < 3) return; // skip empty elements
      var slotType = classifySlotType($el, tag);
      var sName = detectSlotName($el, buildSelector($el));

      // ── Rich text span detection: if element has <span> children with distinct inline styles ──
      var $spans = $el.find("span");
      var hasStyledSpans = false;
      var spanStyles = [];

      if ($spans.length > 0) {
        $spans.each(function (j) {
          var $span = $el.find("span").eq(j);
          var st = ($span.attr("style") || "").trim();
          var txt = ($span.text() || "").trim();
          if (st && txt.length >= 1) {
            hasStyledSpans = true;
            spanStyles.push({
              name: sName + "_span_" + (spanStyles.length > 0 ? spanStyles.length : 0),
              selector: buildSelector($el) + " span:nth-of-type(" + (j + 1) + ")",
              type: "text",
              tag: "span",
              sampleContent: txt.length > 40 ? txt.substring(0, 37) + "..." : txt,
              style: st,
              maxChars: Math.floor(txt.length * 2),
              _richText: true,
              _explicit: hasExplicitSlots,
            });
          }
        });
      }

      // ── If rich text spans detected, add each as a separate slot ──
      if (hasStyledSpans && spanStyles.length > 0) {
        for (var si = 0; si < spanStyles.length; si++) {
          // Disambiguate names
          var rsName = spanStyles[si].name;
          if (seenText[rsName]) {
            seenText[rsName]++;
            rsName = rsName + "_" + seenText[rsName];
          } else {
            seenText[rsName] = 1;
          }
          spanStyles[si].name = rsName;
          slots.push(spanStyles[si]);
        }
        return; // Don't add the parent as a slot — children are the slots
      }

      // ── Regular text slot (no rich text spans) ──
      // Disambiguate duplicate slot names by appending index
      if (seenText[sName]) {
        seenText[sName]++;
        sName = sName + "_" + seenText[sName];
      } else {
        seenText[sName] = 1;
      }

      var maxChars = estimateMaxChars($el, cssRules, frameWidth);
      slots.push({
        name: sName,
        selector: buildSelector($el),
        type: slotType,
        tag: tag,
        maxChars: maxChars,
        sampleContent: text.length > 80 ? text.substring(0, 77) + "..." : text,
        _explicit: hasExplicitSlots,
      });
    }
  });

  // Sort slots: text/richtext first, then images, then cta
  var typeOrder = { text: 0, richtext: 1, cta: 2, image: 3 };
  slots.sort(function (a, b) {
    return (typeOrder[a.type] || 9) - (typeOrder[b.type] || 9);
  });

  var layoutType = classifyLayout(slots);

  // Confidence: based on ratio of slots detected vs content elements passed filter
  var totalElements = elementsScanned;
  var confidence = totalElements > 0 && slots.length / totalElements > 0.5 ? "high" :
    slots.length > 0 ? "medium" : "low";

  var textSlots = slots.filter(function (s) { return s.type === "text" || s.type === "richtext" || s.type === "cta"; });
  var imageSlots = slots.filter(function (s) { return s.type === "image"; });

  return {
    frameId: frameMeta.id || "",
    name: frameMeta.name || "Unnamed",
    width: frameWidth,
    height: frameHeight,
    layoutType: layoutType,
    confidence: confidence,
    mode: hasExplicitSlots ? "explicit" : "auto",
    slots: slots,
    stats: {
      totalSlots: slots.length,
      textSlots: textSlots.length,
      imageSlots: imageSlots.length,
      ctaSlots: slots.filter(function (s) { return s.type === "cta"; }).length,
      totalMaxChars: textSlots.reduce(function (sum, s) { return sum + (s.maxChars || 0); }, 0),
      explicitSlots: slots.filter(function (s) { return s._explicit; }).length,
      autoSlots: slots.filter(function (s) { return !s._explicit; }).length,
    },
    _debug: {
      elementsScanned: elementsScanned,
      elementsFiltered: elementsFiltered,
      hasExplicitSlots: hasExplicitSlots,
    },
  };
}

/**
 * Profile a pool of frames and compute the union of all CSV columns.
 *
 * Columns with the same name AND type across templates are merged into one.
 * The `presentIn` array tracks which templates each column belongs to.
 *
 * @param {Array} profiles - Output from profileFrame() for each template
 * @returns {Object} - Pool-level profile with csvColumns
 */
export function profileTemplatePool(profiles) {
  // Map of column names from data-slot or auto-detected
  var columnMap = {}; // { columnName: { type, presentIn: [], sampleValues: [] } }

  for (var i = 0; i < profiles.length; i++) {
    var profile = profiles[i];
    var nameKey = profile.name || ("Template " + (i + 1));

    for (var j = 0; j < profile.slots.length; j++) {
      var slot = profile.slots[j];

      // Use slot name as column name
      if (!columnMap[slot.name]) {
        columnMap[slot.name] = {
          name: slot.name,
          type: slot.type,
          presentIn: [],
          sampleSelectors: [],
        };
      }

      // Only add if not already present for this template
      if (columnMap[slot.name].presentIn.indexOf(nameKey) === -1) {
        columnMap[slot.name].presentIn.push(nameKey);
      }
      columnMap[slot.name].sampleSelectors.push(slot.selector);
    }
  }

  // Deduplicate selectors
  Object.keys(columnMap).forEach(function (colName) {
    columnMap[colName].sampleSelectors = columnMap[colName].sampleSelectors.filter(function (s, idx, arr) {
      return arr.indexOf(s) === idx;
    });
  });

  // Sort columns: _template first, then by type (text → image → cta), then alphabetically
  var columns = Object.keys(columnMap).map(function (k) { return columnMap[k]; });
  var typeOrderCol = { text: 0, richtext: 1, image: 2, cta: 3 };

  columns.sort(function (a, b) {
    if (a.name === "_template") return -1;
    if (b.name === "_template") return 1;
    var ta = typeOrderCol[a.type] || 9;
    var tb = typeOrderCol[b.type] || 9;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });

  return {
    profiles: profiles,
    csvColumns: columns,
    _deterministic: true,
    _schemaVersion: "1.0",
  };
}
