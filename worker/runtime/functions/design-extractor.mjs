// ═══════════════════════════════════════════════════════════════
// design-extractor.mjs — Deterministic Design System Extraction Engine
//
// Given a set of frames (html + css), this module extracts:
//   - Colors (with role classification + frequency)
//   - Typography (families, sizes, weights, leading, tracking)
//   - Spacing scale (padding/margin/gap clustering)
//   - Border radius values
//   - Box shadows
//   - Components (by class-frequency analysis with confidence levels)
//   - Images and assets (img src + background-image)
//   - Constraint facts (detected, not advised)
//
// Then generates three canonical artifacts:
//   - tokens.json (DTCG format)
//   - DESIGN.md (structured markdown)
//   - shared.css (:root variables + component classes)
//
// KEY GUARANTEE: Same input → byte-identical output, every time.
// ═══════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import crypto from "crypto";
import { STYLE_TEMPLATE_V2 } from "./style-template-v2.mjs";

// ─── Helpers ────────────────────────────────────────────────────

/**
 * SHA-256 hash of concatenated html+css from all frames.
 * Used for staleness detection.
 */
export function computeSourceHash(frames) {
  const combined = frames
    .map(function (f) { return (f.html || "") + "||" + (f.css || ""); })
    .join("\n===FRAME===\n");
  return crypto.createHash("sha256").update(combined).digest("hex").substring(0, 32);
}

/**
 * SHA-256 hash of a single frame's html+css.
 * Used for iterative change attribution.
 */
export function computeFrameHash(html, css) {
  return crypto.createHash("sha256")
    .update((html || "") + "||" + (css || ""))
    .digest("hex")
    .substring(0, 16);
}

/**
 * Style Fingerprint — hash of ONLY design tokens (colors, fonts, spacing, radii, shadows).
 * Ignores text content, images, and layout — two templates with the same visual style
 * but different content will produce the SAME fingerprint.
 *
 * This enables auto-merge: detect that 20 posts share one style.
 */
export function computeStyleFingerprint(extraction) {
  // Extract only token-level data, sorted for determinism
  var colors = (extraction.colors || [])
    .filter(function (c) { return c.role; })
    .map(function (c) { return c.value; })
    .sort();

  var fonts = (extraction.typography && extraction.typography.families || [])
    .map(function (f) { return f.name.toLowerCase(); })
    .sort();

  var typeScale = (extraction.typography && extraction.typography.typeScale || [])
    .slice()
    .sort(function (a, b) { return a - b; });

  var weights = (extraction.typography && extraction.typography.weights || [])
    .slice()
    .sort(function (a, b) { return a - b; });

  var spacing = (extraction.spacing || [])
    .slice()
    .sort(function (a, b) { return a - b; });

  var radii = (extraction.radii || [])
    .map(function (r) { return r.value; })
    .sort();

  var shadows = (extraction.shadows || [])
    .map(function (s) { return s.value; })
    .sort();

  // Build canonical string: C=colors|F=fonts|S=sizes|W=weights|P=spacing|R=radii|H=shadows
  var parts = [
    "C=" + colors.join(","),
    "F=" + fonts.join(","),
    "S=" + typeScale.join(","),
    "W=" + weights.join(","),
    "P=" + spacing.join(","),
    "R=" + radii.join(","),
    "H=" + shadows.join(","),
  ];
  var canonical = parts.join("|");

  return crypto.createHash("sha256").update(canonical).digest("hex").substring(0, 16);
}

/**
 * Compute a style fingerprint from a stored tokensJson string.
 * Handles BOTH v1 (flat DTCG) and v2 (rich format with families as array) formats.
 *
 * V1 format: typography.fontFamily.primary.$value, typography.fontSize.*.$value
 * V2 format: typography.families[{name,...}], typography.scale[{size,...}]
 *
 * Returns hex fingerprint or null if parsing fails.
 */
export function computeFingerprintFromTokensJson(tokensJson) {
  try {
    var parsed = JSON.parse(tokensJson);

    // ── Colors: both v1 and v2 use color.NAME.$value ──
    var colors = [];
    if (parsed.color && typeof parsed.color === "object") {
      Object.keys(parsed.color).forEach(function (k) {
        var c = parsed.color[k];
        if (c && c.$value) colors.push({ role: k, value: c.$value });
      });
    }

    // ── Fonts: v1 uses typography.fontFamily.NAME.$value, v2 uses typography.families[{name}] ──
    var families = [];
    var typeScale = [];
    var weights = [];

    if (parsed.typography) {
      // V2 format: families is an array
      if (Array.isArray(parsed.typography.families)) {
        parsed.typography.families.forEach(function (f) {
          if (f && f.name) families.push({ name: f.name.toLowerCase() });
          // Collect weights from each family
          if (f && Array.isArray(f.weights)) {
            f.weights.forEach(function (w) { weights.push(w); });
          }
        });
      }
      // V1 format: fontFamily is an object
      if (parsed.typography.fontFamily && typeof parsed.typography.fontFamily === "object") {
        Object.keys(parsed.typography.fontFamily).forEach(function (k) {
          var f = parsed.typography.fontFamily[k];
          if (f && f.$value) families.push({ name: String(f.$value).toLowerCase() });
        });
      }

      // V2 format: scale is an array of {size, ...}
      if (Array.isArray(parsed.typography.scale)) {
        parsed.typography.scale.forEach(function (s) {
          if (s && s.size) {
            var px = parseFloat(s.size);
            if (!isNaN(px)) typeScale.push(px);
          }
          if (s && s.weight) weights.push(s.weight);
        });
      }
      // V1 format: fontSize is an object
      if (parsed.typography.fontSize && typeof parsed.typography.fontSize === "object") {
        Object.keys(parsed.typography.fontSize).forEach(function (k) {
          var s = parsed.typography.fontSize[k];
          if (s && s.$value) {
            var px = parseFloat(s.$value);
            if (!isNaN(px)) typeScale.push(px);
          }
        });
      }
      // V1 format: fontWeight is an object
      if (parsed.typography.fontWeight && typeof parsed.typography.fontWeight === "object") {
        Object.keys(parsed.typography.fontWeight).forEach(function (k) {
          var w = parsed.typography.fontWeight[k];
          if (w && w.$value) weights.push(w.$value);
        });
      }
    }

    // ── Spacing: v1 uses spacing.NAME.$value, v2 uses spacing.scale.NAME.$value ──
    var spacing = [];
    var spacingSource = (parsed.spacing && parsed.spacing.scale) || parsed.spacing || {};
    if (typeof spacingSource === "object") {
      Object.keys(spacingSource).forEach(function (k) {
        var s = spacingSource[k];
        if (s && s.$value) {
          var px = parseFloat(s.$value);
          if (!isNaN(px)) spacing.push(px);
        }
      });
    }

    // ── Radii: both formats use radius.NAME.$value ──
    var radii = [];
    if (parsed.radius && typeof parsed.radius === "object") {
      Object.keys(parsed.radius).forEach(function (k) {
        var r = parsed.radius[k];
        if (r && r.$value) radii.push({ value: r.$value });
      });
    }

    // ── Shadows: both formats use shadow[s].NAME.$value ──
    var shadows = [];
    var shadowSource = parsed.shadows || parsed.shadow || {};
    if (typeof shadowSource === "object") {
      Object.keys(shadowSource).forEach(function (k) {
        var s = shadowSource[k];
        if (s && s.$value) shadows.push({ value: s.$value });
      });
    }

    return computeStyleFingerprint({
      colors: colors,
      typography: {
        families: families,
        typeScale: typeScale,
        weights: weights,
      },
      spacing: spacing,
      radii: radii,
      shadows: shadows,
    });
  } catch (e) {
    return null;
  }
}

/**
 * Generate the v2 rich style template for external AI tools (Gemini, ChatGPT, etc).
 *
 * V2 format includes: meta, color (with role/description/constraints), typography
 * (families as array + scale as array), spacing (scale + semantic), radius (per-element),
 * shadows (with constraints), surfaces, layout, components (with CSS), decoration,
 * imagery, rules (do/dont), cssCustomProperties, promptExamples, adaptationGuide.
 *
 * This ensures: fingerprint computation works on uploaded styles (backwards-compat
 * with both v1 and v2 formats), the format matches the system's canonical rich output,
 * and LLMs can produce complete, consistent design systems.
 */
export function generateStyleTemplate() {
  return STYLE_TEMPLATE_V2;
}

// ─── Color Utilities ────────────────────────────────────────────

function hexToRgb(hex) {
  var h = hex.replace("#", "");
  if (h.length === 3) {
    h = h.split("").map(function (c) { return c + c; }).join("");
  }
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHsl(r, g, b) {
  r = r / 255; g = g / 255; b = b / 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h = 0, s = 0;
  var l = (max + min) / 2;
  if (max !== min) {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h = h / 6;
  }
  return { h: h * 360, s: s, l: l };
}

/**
 * Extract all color values from a CSS declaration value string.
 * Returns array of hex strings.
 */
function extractColorsFromValue(value) {
  var colors = [];
  var hexMatch = value.match(/#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b/g);
  if (hexMatch) colors.push.apply(colors, hexMatch.map(function (h) { return h.toLowerCase(); }));
  var rgbMatch = value.match(/rgba?\([^)]+\)/g);
  if (rgbMatch) {
    rgbMatch.forEach(function (rgb) {
      var nums = rgb.match(/\d+/g);
      if (nums && nums.length >= 3) {
        var hex = "#" + parseInt(nums[0]).toString(16).padStart(2, "0") +
          parseInt(nums[1]).toString(16).padStart(2, "0") +
          parseInt(nums[2]).toString(16).padStart(2, "0");
        colors.push(hex);
      }
    });
  }
  return colors;
}

function colorToHex(colorStr) {
  colorStr = colorStr.trim();
  if (colorStr.startsWith("#")) return colorStr.toLowerCase();
  var m = colorStr.match(/rgba?\(([^)]+)\)/);
  if (m) {
    var nums = m[1].split(",").map(function (s) { return parseInt(s.trim()); });
    if (nums.length >= 3) {
      return "#" + nums[0].toString(16).padStart(2, "0") +
        nums[1].toString(16).padStart(2, "0") +
        nums[2].toString(16).padStart(2, "0");
    }
  }
  return colorStr;
}

// ─── CSS Parsing ────────────────────────────────────────────────

var COLOR_PROPS = ["background", "background-color", "color", "border", "border-color",
  "border-top", "border-bottom", "border-left", "border-right", "fill", "stroke",
  "box-shadow", "text-shadow", "outline"];

var FONT_FAMILY_PROPS = ["font-family"];
var FONT_SIZE_PROPS = ["font-size"];
var FONT_WEIGHT_PROPS = ["font-weight"];
var LINE_HEIGHT_PROPS = ["line-height"];
var LETTER_SPACING_PROPS = ["letter-spacing"];
var SPACING_PROPS = ["padding", "margin", "gap", "padding-top", "padding-right",
  "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom",
  "margin-left", "row-gap", "column-gap"];
var RADIUS_PROPS = ["border-radius", "border-top-left-radius", "border-top-right-radius",
  "border-bottom-left-radius", "border-bottom-right-radius"];
var SHADOW_PROPS = ["box-shadow"];

/**
 * Parse a CSS string into individual rules.
 * Returns array of { selector, property, value }
 * Handles @import, @keyframes, @media by storing them raw.
 */
export function parseCss(cssText) {
  var rules = [];
  var atRules = []; // @keyframes, @supports, @media — stored raw
  var imports = [];

  // Extract @import
  var importRe = /@import\s+url\(["']?([^"')]+)["']?\)/g;
  var impMatch;
  while ((impMatch = importRe.exec(cssText)) !== null) {
    imports.push(impMatch[1]);
  }

  // Extract @keyframes / @supports / @container — store raw
  var atBlockRe = /@(keyframes|supports|container|layer|media)[^{]+\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g;
  var atMatch;
  while ((atMatch = atBlockRe.exec(cssText)) !== null) {
    atRules.push({ type: atMatch[1].toLowerCase(), raw: atMatch[0] });
  }

  // Remove @import and @block rules from CSS for rule parsing
  var cleanCss = cssText
    .replace(/@import[^;]+;/g, "")
    .replace(atBlockRe, "");

  // Parse simple rules: selector { prop: value; ... }
  var ruleRe = /([^{}]+)\{([^}]*)\}/g;
  var m;
  while ((m = ruleRe.exec(cleanCss)) !== null) {
    var selectorText = m[1].trim();
    var body = m[2];
    // Skip @-rules that leaked through
    if (selectorText.charAt(0) === "@") continue;

    var declarations = body.split(";");
    for (var i = 0; i < declarations.length; i++) {
      var decl = declarations[i].trim();
      if (!decl) continue;
      var colonIdx = decl.indexOf(":");
      if (colonIdx === -1) continue;
      var prop = decl.slice(0, colonIdx).trim().toLowerCase();
      var val = decl.slice(colonIdx + 1).trim();
      if (!prop || !val) continue;

      // Split comma-separated selectors
      var selectors = selectorText.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      for (var si = 0; si < selectors.length; si++) {
        rules.push({ selector: selectors[si], property: prop, value: val });
      }
    }
  }

  return { rules: rules, atRules: atRules, imports: imports };
}

function hasProp(rules, prop) {
  return rules.filter(function (r) { return r.property === prop; });
}

// ─── Deterministic sorting ──────────────────────────────────────

function sortByCountDesc(a, b) {
  if (b.count !== a.count) return b.count - a.count;
  return (a.value || "").localeCompare(b.value || "");
}

function sortNumberDesc(a, b) {
  return b - a;
}

// HSL → RGB conversion (used by fillSemanticGaps for semantic color derivation)
function hslToRgb(h, s, l) {
  h /= 360;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

// ═══════════════════════════════════════════════════════════
// CSS CUSTOM PROPERTY RESOLUTION (REQ-013)
// ═══════════════════════════════════════════════════════════

/**
 * Collect custom property definitions (--name: value) from parsed rules.
 * Pure: same rules in → same map out. Last definition wins, matching the
 * cascade for equal-specificity declarations in a flat per-frame sheet.
 * NOTE: parseCss lowercases property names; lookupProp compensates with a
 * deterministic case-insensitive fallback so --DS-Color still resolves.
 */
function buildCustomProps(rules) {
  var map = {};
  rules.forEach(function (r) {
    if (r.property && r.property.indexOf("--") === 0) {
      map[r.property] = r.value;
    }
  });
  return map;
}

function lookupProp(map, name) {
  if (Object.prototype.hasOwnProperty.call(map, name)) return map[name];
  var lower = name.toLowerCase();
  for (var k in map) {
    if (Object.prototype.hasOwnProperty.call(map, k) && k.toLowerCase() === lower) return map[k];
  }
  return undefined;
}

var VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*?))?\s*\)/g;

/**
 * Resolve var(--x) / var(--x, fallback) references against a custom-props map.
 * Iterative with guards (10 passes) so reference chains and cycles terminate
 * deterministically. Unknown vars keep the fallback when present, otherwise
 * the literal var() text — nothing silently disappears.
 * Known limit (REQ-013): a fallback containing nested var() stops at the
 * first closing paren.
 */
function resolveVarValue(value, map) {
  if (!value || value.indexOf("var(") === -1) return value;
  var out = value;
  var guard = 0;
  while (guard < 10) {
    var changed = false;
    out = out.replace(VAR_RE, function (match, name, fallback) {
      var resolved = lookupProp(map, name);
      if (resolved === undefined) resolved = (fallback !== undefined && fallback !== "") ? fallback : match;
      if (resolved !== match) changed = true;
      return resolved;
    });
    if (!changed) break;
    guard++;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXTRACTION FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Extract a complete design system from an array of frames.
 *
 * @param {Array} frames - [{ name, html, css, width, height, layoutMode, id }]
 * @returns {Object} - Structured design data (deterministic)
 */
export function extractDesignSystem(frames) {
  var allRules = [];
  var allAtRules = [];
  var allImports = [];
  var frameCssMap = {}; // frameId → parsed rules

  // Parse CSS from each frame
  for (var i = 0; i < frames.length; i++) {
    var f = frames[i];
    var parsed = parseCss(f.css || "");
    // REQ-013 — resolve var() references BEFORE extraction, scoped per frame
    // (each frame is an independent document; a global map could cross-wire
    // same-named custom properties between frames). No var() present → the
    // map pass is skipped and rules flow through untouched (fingerprint stable).
    var customProps = buildCustomProps(parsed.rules);
    var frameRules = Object.keys(customProps).length
      ? parsed.rules.map(function (r) {
          return { selector: r.selector, property: r.property, value: resolveVarValue(r.value, customProps) };
        })
      : parsed.rules;
    allRules.push.apply(allRules, frameRules);
    allAtRules.push.apply(allAtRules, parsed.atRules);
    allImports.push.apply(allImports, parsed.imports);
    frameCssMap[f.id || i] = frameRules;
  }

  // ── Step 2: Color Extraction ──
  var colorCounts = {}; // hex → count
  var colorProps = {};   // hex → [{prop, count}]

  allRules.forEach(function (rule) {
    if (COLOR_PROPS.indexOf(rule.property) !== -1) {
      var colors = extractColorsFromValue(rule.value);
      colors.forEach(function (hex) {
        colorCounts[hex] = (colorCounts[hex] || 0) + 1;
        if (!colorProps[hex]) colorProps[hex] = {};
        colorProps[hex][rule.property] = (colorProps[hex][rule.property] || 0) + 1;
      });
    }
  });

  // Classify colors
  var colorEntries = Object.keys(colorCounts).map(function (hex) {
    var rgb = hexToRgb(hex);
    var hsl = rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : { h: 0, s: 0, l: 0 };
    return {
      hex: hex,
      count: colorCounts[hex],
      hsl: hsl,
      saturation: hsl.s,
      lightness: hsl.l,
    };
  }).sort(sortByCountDesc);

  var classified = classifyColors(colorEntries);

  // ── Step 3: Typography Extraction ──
  var fontFamilyCounts = {};
  var fontSizeCounts = {};
  var fontWeightCounts = {};
  var lineHeightCounts = {};
  var letterSpacingCounts = {};

  allRules.forEach(function (rule) {
    if (FONT_FAMILY_PROPS.indexOf(rule.property) !== -1) {
      var family = rule.value.split(",")[0].trim().replace(/['"]/g, "");
      fontFamilyCounts[family] = (fontFamilyCounts[family] || 0) + 1;
    }
    if (FONT_SIZE_PROPS.indexOf(rule.property) !== -1) {
      var size = parseInt(rule.value);
      if (size > 0) fontSizeCounts[size] = (fontSizeCounts[size] || 0) + 1;
    }
    if (FONT_WEIGHT_PROPS.indexOf(rule.property) !== -1) {
      var weight = parseInt(rule.value);
      if (weight > 0) fontWeightCounts[weight] = (fontWeightCounts[weight] || 0) + 1;
    }
    if (LINE_HEIGHT_PROPS.indexOf(rule.property) !== -1) {
      var lh = parseFloat(rule.value);
      if (lh > 0) lineHeightCounts[lh] = (lineHeightCounts[lh] || 0) + 1;
    }
    if (LETTER_SPACING_PROPS.indexOf(rule.property) !== -1) {
      var ls = parseFloat(rule.value);
      if (!isNaN(ls)) letterSpacingCounts[ls] = (letterSpacingCounts[ls] || 0) + 1;
    }
  });

  var families = Object.keys(fontFamilyCounts)
    .map(function (k) { return { name: k, count: fontFamilyCounts[k] }; })
    .sort(function (a, b) { return b.count - a.count || (a.name || "").localeCompare(b.name || ""); });

  // No font-family declared anywhere in the captured CSS — default to Inter
  // rather than shipping a brand guideline with an empty typography section.
  if (families.length === 0) {
    families.push({ name: "Inter", count: 0 });
  }

  var typeScale = Object.keys(fontSizeCounts)
    .map(function (k) { return parseInt(k); })
    .sort(sortNumberDesc);

  var weights = Object.keys(fontWeightCounts)
    .map(function (k) { return parseInt(k); })
    .sort(sortNumberDesc);

  var leading = Object.keys(lineHeightCounts)
    .map(function (k) { return parseFloat(k); })
    .sort(sortNumberDesc);

  var tracking = Object.keys(letterSpacingCounts)
    .map(function (k) { return parseFloat(k); })
    .sort(sortNumberDesc);

  // ── Step 4: Spacing Extraction ──
  var spacingCounts = {};
  allRules.forEach(function (rule) {
    if (SPACING_PROPS.indexOf(rule.property) !== -1) {
      var m = rule.value.match(/(\d+)px/g);
      if (m) {
        m.forEach(function (px) {
          var val = parseInt(px);
          if (val > 0) spacingCounts[val] = (spacingCounts[val] || 0) + 1;
        });
      }
    }
  });
  var spacingScale = Object.keys(spacingCounts)
    .map(function (k) { return parseInt(k); })
    .sort(sortNumberDesc);

  // ── Step 5: Border Radius Extraction ──
  var radiusCounts = {};
  allRules.forEach(function (rule) {
    if (RADIUS_PROPS.indexOf(rule.property) !== -1) {
      var val = rule.value.trim();
      if (val.endsWith("px")) {
        var px = parseInt(val);
        if (px > 0) radiusCounts[px + "px"] = (radiusCounts[px + "px"] || 0) + 1;
      } else if (val === "50%" || val.indexOf("%") !== -1) {
        radiusCounts[val] = (radiusCounts[val] || 0) + 1;
      }
    }
  });
  var radii = Object.keys(radiusCounts)
    .map(function (k) { return { value: k, count: radiusCounts[k] }; })
    .sort(sortByCountDesc);

  // ── Step 6: Shadow Extraction ──
  var shadowCounts = {};
  allRules.forEach(function (rule) {
    if (SHADOW_PROPS.indexOf(rule.property) !== -1) {
      var val = rule.value.trim();
      if (val !== "none" && val !== "0") {
        shadowCounts[val] = (shadowCounts[val] || 0) + 1;
      }
    }
  });
  var shadows = Object.keys(shadowCounts)
    .map(function (k) { return { value: k, count: shadowCounts[k] }; })
    .sort(sortByCountDesc);

  // ── Step 7: Component Detection ──
  var components = detectComponents(frames);

  // ── Step 8: Image/Asset Catalog ──
  var images = catalogImages(frames);

  // ── Step 9: Constraint Detection ──
  var constraints = detectConstraints(colorEntries, families, allAtRules, classified);

  // ── Source hash for staleness ──
  var sourceHash = computeSourceHash(frames);

  // ── Build result ──
  return {
    sourceHash: sourceHash,
    colors: classified,
    typography: {
      families: families,
      typeScale: typeScale,
      weights: weights,
      leading: leading,
      tracking: tracking,
    },
    spacing: spacingScale,
    radii: radii,
    shadows: shadows,
    components: components,
    images: images,
    constraints: constraints,
    cssImports: allImports,
    atRules: allAtRules.map(function (a) { return a.type; }),
    parserLimitations: "CSS parsed with regex. @keyframes, @supports, @container, @layer, nested selectors, and modern CSS features may not be fully analyzed.",
  };
}

// ═══════════════════════════════════════════════════════════════
// COLOR CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyColors(colorEntries) {
  var result = [];

  // Find background colors (lightest, most frequent)
  var backgrounds = colorEntries.filter(function (c) {
    return c.lightness > 0.85;
  }).sort(sortByCountDesc);

  // Find text/ink colors (darkest)
  var inks = colorEntries.filter(function (c) {
    return c.lightness < 0.15;
  }).sort(sortByCountDesc);

  // Find saturated colors (accents)
  var accents = colorEntries.filter(function (c) {
    return c.saturation > 0.3;
  }).sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return b.saturation - a.saturation;
  });

  // Find muted colors
  var muted = colorEntries.filter(function (c) {
    return c.saturation <= 0.3 && c.saturation > 0.05 && c.lightness >= 0.15 && c.lightness <= 0.85;
  }).sort(sortByCountDesc);

  // Assign tokens
  var used = {};

  // Background
  backgrounds.slice(0, 2).forEach(function (c, idx) {
    var name = idx === 0 ? "canvas" : "surface-" + (idx + 1);
    result.push({
      token: "--color-" + name,
      value: c.hex,
      role: "background",
      usageCount: c.count,
      hsl: c.hsl,
    });
    used[c.hex] = true;
  });

  // Ink
  inks.slice(0, 2).forEach(function (c, idx) {
    var name = idx === 0 ? "ink" : "ink-" + (idx + 1);
    result.push({
      token: "--color-" + name,
      value: c.hex,
      role: "text",
      usageCount: c.count,
      hsl: c.hsl,
    });
    used[c.hex] = true;
  });

  // Accents (Lara's feedback: multi-accent with deterministic numbering)
  var accentCount = 0;
  accents.forEach(function (c) {
    if (used[c.hex]) return;
    accentCount++;
    var name = accentCount === 1 ? "accent-1" : "accent-" + accentCount;
    result.push({
      token: "--color-" + name,
      value: c.hex,
      role: "accent",
      usageCount: c.count,
      hsl: c.hsl,
    });
    used[c.hex] = true;
  });

  // Muted
  muted.slice(0, 3).forEach(function (c, idx) {
    if (used[c.hex]) return;
    var name = "muted-" + (idx + 1);
    result.push({
      token: "--color-" + name,
      value: c.hex,
      role: "muted",
      usageCount: c.count,
      hsl: c.hsl,
    });
    used[c.hex] = true;
  });

  // Remaining unclassified colors
  colorEntries.forEach(function (c) {
    if (used[c.hex]) return;
    result.push({
      token: "--color-other-" + (result.filter(function (r) { return r.role === "other"; }).length + 1),
      value: c.hex,
      role: "other",
      usageCount: c.count,
      hsl: c.hsl,
    });
    used[c.hex] = true;
  });

  // Add note if multiple accents
  if (accentCount > 1) {
    result._note = "Multiple saturated colors detected. Human should assign semantic names.";
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT DETECTION
// ═══════════════════════════════════════════════════════════════

function detectComponents(frames) {
  var totalFrames = frames.length;
  if (totalFrames === 0) return [];

  // Map: classCombo → { tag, classes, frameIds:Set, samples:[] }
  var componentMap = {};

  frames.forEach(function (frame) {
    var frameId = frame.id || frame.name;
    try {
      var $ = cheerio.load(frame.html || "");
      $("*").each(function (_, el) {
        var $el = $(el);
        var tag = ($el.prop("tagName") || "").toLowerCase();
        if (!tag) return;
        var cls = $el.attr("class");
        if (!cls) return;

        // Normalize class string
        var classes = cls.trim().split(/\s+/).sort().join(".");
        var key = tag + "." + classes;

        if (!componentMap[key]) {
          componentMap[key] = {
            tag: tag,
            classes: classes,
            classList: cls.trim().split(/\s+/),
            frameIds: {},
            samples: [],
          };
        }
        if (!componentMap[key].frameIds[frameId]) {
          componentMap[key].frameIds[frameId] = true;
          componentMap[key].frameCount = Object.keys(componentMap[key].frameIds).length;
        }
        if (componentMap[key].samples.length < 1) {
          // Capture a small sample of outerHTML
          var sample = $.html($el);
          if (sample.length > 300) sample = sample.substring(0, 300) + "...";
          componentMap[key].samples.push(sample);
        }
      });
    } catch (e) {
      // cheerio parse error — skip this frame
    }
  });

  // Filter to components appearing in 10%+ of frames, assign confidence
  var components = Object.keys(componentMap)
    .map(function (key) {
      var c = componentMap[key];
      var coverage = c.frameCount / totalFrames;
      var confidence;
      if (coverage >= 0.6) confidence = "high";
      else if (coverage >= 0.3) confidence = "medium";
      else if (coverage >= 0.1) confidence = "low";
      else return null;

      return {
        selector: c.tag + "." + (c.classList || []).join("."),
        tag: c.tag,
        classes: c.classList,
        frameCount: c.frameCount,
        totalFrames: totalFrames,
        coverage: Math.round(coverage * 100) / 100,
        confidence: confidence,
        sampleHtml: c.samples[0] || "",
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      if (b.frameCount !== a.frameCount) return b.frameCount - a.frameCount;
      return (a.selector || "").localeCompare(b.selector || "");
    });

  return components;
}

// ═══════════════════════════════════════════════════════════════
// IMAGE / ASSET CATALOG
// ═══════════════════════════════════════════════════════════════

function catalogImages(frames) {
  var images = [];

  frames.forEach(function (frame) {
    var frameId = frame.id || frame.name;
    try {
      var $ = cheerio.load(frame.html || "");

      // <img src="...">
      $("img[src]").each(function (_, el) {
        var $el = $(el);
        var src = $el.attr("src");
        if (!src || src.startsWith("data:")) return;
        var selector = getCheerioSelector($el);
        images.push({
          type: "img",
          url: src,
          frameId: frameId,
          selector: selector,
          alt: $el.attr("alt") || "",
        });
      });

      // Elements with inline background-image
      $("[style]").each(function (_, el) {
        var $el = $(el);
        var style = $el.attr("style") || "";
        var bgMatch = style.match(/background[^:]*:\s*url\(["']?([^"')]+)["']?\)/);
        if (bgMatch) {
          var selector = getCheerioSelector($el);
          images.push({
            type: "background",
            url: bgMatch[1],
            frameId: frameId,
            selector: selector,
          });
        }
      });
    } catch (e) {
      // skip
    }

    // Also scan CSS for background-image: url(...)
    var cssRules = parseCss(frame.css || "").rules;
    cssRules.forEach(function (rule) {
      if (rule.property === "background" || rule.property === "background-image") {
        var bgMatch = rule.value.match(/url\(["']?([^"')]+)["']?\)/);
        if (bgMatch) {
          images.push({
            type: "background",
            url: bgMatch[1],
            frameId: frameId,
            selector: rule.selector,
          });
        }
      }
    });
  });

  // Deduplicate by url+frameId+selector
  var seen = {};
  return images.filter(function (img) {
    var key = img.url + "|" + img.frameId + "|" + img.selector;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function getCheerioSelector($el) {
  var tag = ($el.prop("tagName") || "div").toLowerCase();
  var id = $el.attr("id");
  var cls = $el.attr("class");
  var sel = tag;
  if (id) sel += "#" + id;
  if (cls) {
    var classes = cls.trim().split(/\s+/);
    sel += "." + classes.join(".");
  }
  return sel;
}

// ═══════════════════════════════════════════════════════════════
// CONSTRAINT DETECTION (facts, not advice)
// ═══════════════════════════════════════════════════════════════

function detectConstraints(colorEntries, families, atRules, classified) {
  var facts = [];

  // Accent count
  var accents = classified.filter(function (c) { return c.role === "accent"; });
  if (accents.length === 1) {
    facts.push({ type: "palette", statement: "Palette uses 1 accent color (" + accents[0].value + ")." });
  } else if (accents.length > 1) {
    facts.push({ type: "palette", statement: "Multiple saturated colors detected (" + accents.length + "). Human should assign semantic names." });
  } else {
    facts.push({ type: "palette", statement: "No saturated accent color detected. Palette is monochrome." });
  }

  // Total distinct colors
  facts.push({ type: "palette", statement: "Total distinct colors detected: " + colorEntries.length + "." });

  // Font families
  facts.push({ type: "typography", statement: "Typography uses " + families.length + " font " + (families.length === 1 ? "family" : "families") + "." });
  if (families.length > 0) {
    facts.push({ type: "typography", statement: "Primary font: " + families[0].name + " (" + families[0].count + " uses)." });
  }
  if (families.length > 1) {
    facts.push({ type: "typography", statement: "Secondary font: " + families[1].name + " (" + families[1].count + " uses)." });
  }

  // Animations
  var kfCount = atRules.filter(function (a) { return a.type === "keyframes"; }).length;
  if (kfCount > 0) {
    facts.push({ type: "animation", statement: kfCount + " @keyframes animation(s) detected (not parsed — check raw CSS)." });
  }

  // Parser limitation
  facts.push({ type: "meta", statement: "Constraints derived from regex CSS parsing. Complex selectors may not be fully analyzed." });

  return facts;
}

// ═══════════════════════════════════════════════════════════════
// ARTIFACT GENERATORS
// ═══════════════════════════════════════════════════════════════

/**
 * Generate DTCG-format tokens.json from extraction data.
 */
export function generateTokensJson(extraction, templateName) {
  var tokens = {
    "$schema": "https://design-tokens.org/format",
  };

  // Color tokens
  tokens.color = {};
  var note = extraction.colors._note;
  extraction.colors.forEach(function (c) {
    if (c.role) {
      var name = c.token.replace("--color-", "");
      tokens.color[name] = {
        "$value": c.value,
        "$description": c.role + " color (" + c.usageCount + " uses)",
      };
    }
  });

  // Typography tokens
  tokens.typography = {};
  if (extraction.typography.families.length > 0) {
    tokens.typography.fontFamily = {};
    extraction.typography.families.slice(0, 4).forEach(function (f, i) {
      var label = i === 0 ? "primary" : i === 1 ? "secondary" : "fallback-" + (i - 1);
      tokens.typography.fontFamily[label] = { "$value": f.name };
    });
  }
  if (extraction.typography.typeScale.length > 0) {
    tokens.typography.fontSize = {};
    // Assign scale labels
    var scale = extraction.typography.typeScale;
    var labels = ["caption", "body-sm", "body", "subheading", "heading-sm", "heading", "heading-lg", "display", "display-lg"];
    // Sort ascending for labeling
    var ascending = scale.slice().sort(function (a, b) { return a - b; });
    ascending.forEach(function (size, i) {
      var label = i < labels.length ? labels[i] : "size-" + (i + 1);
      tokens.typography.fontSize[label] = { "$value": size + "px" };
    });
  }
  if (extraction.typography.weights.length > 0) {
    tokens.typography.fontWeight = {};
    extraction.typography.weights.forEach(function (w, i) {
      tokens.typography.fontWeight["weight-" + w] = { "$value": w };
    });
  }

  // Spacing tokens
  if (extraction.spacing.length > 0) {
    tokens.spacing = {};
    extraction.spacing.forEach(function (s) {
      tokens.spacing["space-" + s] = { "$value": s + "px" };
    });
  }

  // Radius tokens
  if (extraction.radii.length > 0) {
    tokens.radius = {};
    extraction.radii.forEach(function (r, i) {
      var label = i === 0 ? "default" : "radius-" + (i + 1);
      tokens.radius[label] = { "$value": r.value };
    });
  }

  // Shadow tokens
  if (extraction.shadows.length > 0) {
    tokens.shadow = {};
    extraction.shadows.forEach(function (s, i) {
      var label = i === 0 ? "default" : "shadow-" + (i + 1);
      tokens.shadow[label] = { "$value": s.value };
    });
  }

  // Components (frame-scoped class-to-token bindings)
  if (extraction.components.length > 0) {
    tokens.components = {};
    extraction.components.forEach(function (c) {
      tokens.components[c.selector] = {
        "$value": c.selector,
        "$description": c.tag + " component, found in " + c.frameCount + "/" + c.totalFrames + " frames (confidence: " + c.confidence + ")",
      };
    });
  }

  if (note) {
    tokens.$note = note;
  }

  return JSON.stringify(tokens, null, 2);
}

/**
 * Generate DESIGN.md from extraction data.
 * Template-driven, not AI-generated.
 */
export function generateDesignMd(extraction, templateMeta) {
  var lines = [];
  var name = templateMeta.name || "Untitled Template";

  lines.push("# " + name + " — Style Reference");
  lines.push("> Deterministically extracted from frame HTML/CSS. Same input → same output.");
  lines.push("");

  // Colors
  lines.push("## Tokens — Colors");
  lines.push("| Name | Value | Token | Role | Usage |");
  lines.push("|------|-------|-------|------|-------|");
  extraction.colors.forEach(function (c) {
    if (c.role) {
      lines.push("| " + c.token.replace("--color-", "") + " | `" + c.value + "` | `" + c.token + "` | " + c.role + " | " + c.usageCount + "x |");
    }
  });
  if (extraction.colors._note) {
    lines.push("");
    lines.push("> **Note:** " + extraction.colors._note);
  }
  lines.push("");

  // Typography
  lines.push("## Tokens — Typography");
  if (extraction.typography.families.length > 0) {
    extraction.typography.families.slice(0, 4).forEach(function (f, i) {
      var role = i === 0 ? "Primary" : i === 1 ? "Secondary" : "Fallback";
      lines.push("### " + f.name + " — " + role + " (" + f.count + " uses)");
      lines.push("");
    });

    lines.push("### Type Scale");
    lines.push("| Role | Size |");
    lines.push("|------|------|");
    var ascending = extraction.typography.typeScale.slice().sort(function (a, b) { return a - b; });
    var scaleLabels = ["caption", "body-sm", "body", "subheading", "heading-sm", "heading", "heading-lg", "display", "display-lg"];
    ascending.forEach(function (size, i) {
      var label = i < scaleLabels.length ? scaleLabels[i] : "size-" + (i + 1);
      lines.push("| " + label + " | " + size + "px |");
    });

    lines.push("");
    lines.push("### Font Weights");
    lines.push((extraction.typography.weights || []).join(", "));
    lines.push("");
  }

  // Spacing
  if (extraction.spacing.length > 0) {
    lines.push("## Tokens — Spacing");
    lines.push("| Name | Value | Token |");
    lines.push("|------|-------|-------|");
    extraction.spacing.forEach(function (s) {
      lines.push("| " + s + " | " + s + "px | `--spacing-" + s + "` |");
    });
    lines.push("");
  }

  // Border Radius
  if (extraction.radii.length > 0) {
    lines.push("## Border Radius");
    lines.push("| Value | Usage | Token |");
    lines.push("|-------|-------|-------|");
    extraction.radii.forEach(function (r, i) {
      lines.push("| " + r.value + " | " + r.count + "x | `--radius-" + (i + 1) + "` |");
    });
    lines.push("");
  }

  // Shadows
  if (extraction.shadows.length > 0) {
    lines.push("## Shadows");
    lines.push("| Value | Usage | Token |");
    lines.push("|-------|-------|-------|");
    extraction.shadows.forEach(function (s, i) {
      lines.push("| `" + s.value + "` | " + s.count + "x | `--shadow-" + (i + 1) + "` |");
    });
    lines.push("");
  }

  // Components
  if (extraction.components.length > 0) {
    lines.push("## Components (detected)");
    extraction.components.forEach(function (c) {
      lines.push("### " + c.selector);
      lines.push("- **Tag:** " + c.tag);
      lines.push("- **Classes:** " + (c.classes || []).join(", "));
      lines.push("- **Found in:** " + c.frameCount + "/" + c.totalFrames + " frames (" + Math.round(c.coverage * 100) + "%)");
      lines.push("- **Confidence:** " + c.confidence);
      if (c.sampleHtml) {
        lines.push("- **Sample:**");
        lines.push("```html");
        lines.push(c.sampleHtml);
        lines.push("```");
      }
      lines.push("");
    });
  }

  // Images
  if (extraction.images.length > 0) {
    lines.push("## Image Assets");
    lines.push("| Type | URL | Frame | Selector |");
    lines.push("|------|-----|-------|----------|");
    extraction.images.forEach(function (img) {
      lines.push("| " + img.type + " | " + img.url.substring(0, 80) + " | " + img.frameId + " | `" + img.selector + "` |");
    });
    lines.push("");
  }

  // Constraints (facts)
  lines.push("## Detected Constraints");
  extraction.constraints.forEach(function (c) {
    lines.push("- " + c.statement);
  });
  lines.push("");
  lines.push("> " + extraction.parserLimitations);
  lines.push("");

  // CSS Custom Properties
  lines.push("## CSS Custom Properties");
  lines.push("```css");
  lines.push(":root {");
  extraction.colors.forEach(function (c) {
    if (c.role) {
      lines.push("  " + c.token + ": " + c.value + ";");
    }
  });
  extraction.spacing.forEach(function (s) {
    lines.push("  --spacing-" + s + ": " + s + "px;");
  });
  extraction.radii.forEach(function (r, i) {
    lines.push("  --radius-" + (i + 1) + ": " + r.value + ";");
  });
  extraction.shadows.forEach(function (s, i) {
    lines.push("  --shadow-" + (i + 1) + ": " + s.value + ";");
  });
  lines.push("}");
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate shared.css with :root variables + detected component classes.
 */
export function generateSharedCss(extraction) {
  var lines = [];
  lines.push("/* ═══ Auto-generated by Futuraria Design Extractor ═══ */");
  lines.push("/* Deterministic output — same frames → identical CSS */");
  lines.push("/* Source hash: " + extraction.sourceHash + " */");
  lines.push("");
  lines.push(":root {");

  // Colors
  extraction.colors.forEach(function (c) {
    if (c.role) {
      lines.push("  " + c.token + ": " + c.value + ";");
    }
  });

  // Typography
  if (extraction.typography.families.length > 0) {
    lines.push("");
    lines.push("  /* Typography — Font Families */");
    extraction.typography.families.slice(0, 4).forEach(function (f, i) {
      var label = i === 0 ? "primary" : i === 1 ? "secondary" : "fallback-" + (i - 1);
      lines.push("  --font-" + label + ": '" + f.name + "', sans-serif;");
    });
  }

  if (extraction.typography.typeScale.length > 0) {
    lines.push("");
    lines.push("  /* Typography — Scale */");
    var ascending = extraction.typography.typeScale.slice().sort(function (a, b) { return a - b; });
    var scaleLabels = ["caption", "body-sm", "body", "subheading", "heading-sm", "heading", "heading-lg", "display", "display-lg"];
    ascending.forEach(function (size, i) {
      var label = i < scaleLabels.length ? scaleLabels[i] : "size-" + (i + 1);
      lines.push("  --text-" + label + ": " + size + "px;");
    });
  }

  // Spacing
  if (extraction.spacing.length > 0) {
    lines.push("");
    lines.push("  /* Spacing */");
    extraction.spacing.forEach(function (s) {
      lines.push("  --spacing-" + s + ": " + s + "px;");
    });
  }

  // Radius
  if (extraction.radii.length > 0) {
    lines.push("");
    lines.push("  /* Border Radius */");
    extraction.radii.forEach(function (r, i) {
      lines.push("  --radius-" + (i + 1) + ": " + r.value + ";");
    });
  }

  // Shadow
  if (extraction.shadows.length > 0) {
    lines.push("");
    lines.push("  /* Shadows */");
    extraction.shadows.forEach(function (s, i) {
      lines.push("  --shadow-" + (i + 1) + ": " + s.value + ";");
    });
  }

  lines.push("}");
  lines.push("");

  // High-confidence component class stubs
  var highConfidence = extraction.components.filter(function (c) { return c.confidence === "high"; });
  if (highConfidence.length > 0) {
    lines.push("/* ═══ High-confidence component classes ═══ */");
    highConfidence.forEach(function (c) {
      lines.push("/* " + c.selector + " — found in " + c.frameCount + "/" + c.totalFrames + " frames */");
      lines.push(c.selector + " {");
      lines.push("  /* Component properties extracted from CSS */");
      lines.push("}");
      lines.push("");
    });
  }

  return lines.join("\n");
}

/**
 * Full pipeline: extract + generate all 3 artifacts.
 */
export function generateAllArtifacts(frames, templateMeta) {
  var extraction = extractDesignSystem(frames);
  // Apply semantic gap-filling and structural component discovery
  extraction = fillSemanticGaps(extraction);
  extraction.components = discoverStructuralComponents(frames, extraction.colors);
  var fingerprint = computeStyleFingerprint(extraction);
  return {
    sourceHash: extraction.sourceHash,
    styleFingerprint: fingerprint,
    tokensJson: generateTokensJson(extraction, templateMeta),
    designMd: generateDesignMd(extraction, templateMeta),
    sharedCss: generateSharedCss(extraction),
    extraction: extraction,
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
// MULTI-TEMPLATE MERGE
// ═══════════════════════════════════════════════════════════════

/**
 * Merge multiple extraction results from different templates into one
 * unified design system. Used by extract_design_system when multiple
 * templateIds are provided.
 *
 * Strategy:
 *   - Colors: merge counts, re-classify after merge
 *   - Fonts: merge counts, keep top 4
 *   - Type scale: union of all sizes
 *   - Spacing/Radii/Shadows: union, sorted
 *   - Components: intersection (found across templates → higher confidence)
 */
export function mergeExtractions(extractions) {
  if (extractions.length === 0) return null;
  if (extractions.length === 1) return extractions[0];

  // ── Merge colors ──
  var mergedColorMap = {}; // hex → {count, hsl}
  extractions.forEach(function (ext) {
    ext.colors.forEach(function (c) {
      if (!c.value) return;
      if (!mergedColorMap[c.value]) {
        mergedColorMap[c.value] = { count: 0, hsl: c.hsl };
      }
      mergedColorMap[c.value].count += c.usageCount || 0;
    });
  });

  var colorEntries = Object.keys(mergedColorMap)
    .map(function (hex) {
      return { hex: hex, count: mergedColorMap[hex].count, hsl: mergedColorMap[hex].hsl,
        saturation: mergedColorMap[hex].hsl ? mergedColorMap[hex].hsl.s : 0,
        lightness: mergedColorMap[hex].hsl ? mergedColorMap[hex].hsl.l : 0 };
    })
    .sort(sortByCountDesc);

  var classified = classifyColors(colorEntries);

  // ── Merge typography ──
  var familyMap = {};
  var sizeSet = {};
  var weightSet = {};
  var leadingSet = {};
  var trackingSet = {};

  extractions.forEach(function (ext) {
    (ext.typography.families || []).forEach(function (f) {
      familyMap[f.name] = (familyMap[f.name] || 0) + (f.count || 1);
    });
    (ext.typography.typeScale || []).forEach(function (s) { sizeSet[s] = true; });
    (ext.typography.weights || []).forEach(function (w) { weightSet[w] = true; });
    (ext.typography.leading || []).forEach(function (l) { leadingSet[l] = true; });
    (ext.typography.tracking || []).forEach(function (t) { trackingSet[t] = true; });
  });

  var families = Object.keys(familyMap)
    .map(function (k) { return { name: k, count: familyMap[k] }; })
    .sort(function (a, b) { return b.count - a.count || (a.name || "").localeCompare(b.name || ""); });
  var typeScale = Object.keys(sizeSet).map(Number).sort(sortNumberDesc);
  var weights = Object.keys(weightSet).map(Number).sort(sortNumberDesc);
  var leading = Object.keys(leadingSet).map(Number).sort(sortNumberDesc);
  var tracking = Object.keys(trackingSet).map(Number).sort(sortNumberDesc);

  // ── Merge spacing/radii/shadows ──
  var spacingSet = {};
  var radiusMap = {};
  var shadowMap = {};

  extractions.forEach(function (ext) {
    (ext.spacing || []).forEach(function (s) { spacingSet[s] = (spacingSet[s] || 0) + 1; });
    (ext.radii || []).forEach(function (r) { radiusMap[r.value] = (radiusMap[r.value] || 0) + (r.count || 1); });
    (ext.shadows || []).forEach(function (s) { shadowMap[s.value] = (shadowMap[s.value] || 0) + (s.count || 1); });
  });

  var spacingScale = Object.keys(spacingSet).map(Number).sort(sortNumberDesc);
  var radii = Object.keys(radiusMap)
    .map(function (k) { return { value: k, count: radiusMap[k] }; })
    .sort(sortByCountDesc);
  var shadows = Object.keys(shadowMap)
    .map(function (k) { return { value: k, count: shadowMap[k] }; })
    .sort(sortByCountDesc);

  // ── Merge components (intersection strategy) ──
  var compMap = {};
  var templateCount = extractions.length;
  extractions.forEach(function (ext) {
    (ext.components || []).forEach(function (c) {
      if (!compMap[c.selector]) {
        compMap[c.selector] = { c: c, templateCount: 0 };
      }
      compMap[c.selector].templateCount++;
    });
  });

  var components = Object.keys(compMap)
    .map(function (key) {
      var mc = compMap[key];
      var coverage = mc.templateCount / templateCount;
      var confidence = coverage >= 0.6 ? "high" : coverage >= 0.3 ? "medium" : "low";
      return {
        selector: mc.c.selector, tag: mc.c.tag, classes: mc.c.classes,
        frameCount: mc.templateCount, totalFrames: templateCount,
        coverage: Math.round(coverage * 100) / 100,
        confidence: confidence, sampleHtml: mc.c.sampleHtml || "",
      };
    })
    .sort(function (a, b) { return b.frameCount - a.frameCount || (a.selector || "").localeCompare(b.selector || ""); });

  // ── Merge images ──
  var imageSeen = {};
  var allImages = [];
  extractions.forEach(function (ext) {
    (ext.images || []).forEach(function (img) {
      var key = img.url + "|" + img.selector;
      if (!imageSeen[key]) { imageSeen[key] = true; allImages.push(img); }
    });
  });

  // ── Merge constraints ──
  var constraintSeen = {};
  var allConstraints = [];
  extractions.forEach(function (ext) {
    (ext.constraints || []).forEach(function (c) {
      if (!constraintSeen[c.statement]) { constraintSeen[c.statement] = true; allConstraints.push(c); }
    });
  });
  // Add multi-template fact
  allConstraints.unshift({ type: "meta", statement: "Merged from " + templateCount + " templates." });

  // ── Source hash (combined) ──
  var combinedHash = crypto.createHash("sha256")
    .update(extractions.map(function (e) { return e.sourceHash; }).join("|"))
    .digest("hex").substring(0, 32);

  var merged = {
    sourceHash: combinedHash,
    colors: classified,
    typography: { families: families, typeScale: typeScale, weights: weights, leading: leading, tracking: tracking },
    spacing: spacingScale,
    radii: radii,
    shadows: shadows,
    components: components,
    images: allImages,
    constraints: allConstraints,
    cssImports: [],
    atRules: [],
    parserLimitations: "Merged from " + templateCount + " template extractions.",
  };

  // Apply gap-filling on merged result
  merged = fillSemanticGaps(merged);

  return merged;
}

// ═══════════════════════════════════════════════════════════════
// SEMANTIC COLOR GAP-FILLING
// ═══════════════════════════════════════════════════════════════

/**
 * Fill missing semantic color roles (success, warning, error, info)
 * by deriving them from the existing palette using color theory.
 *
 * Strategy:
 *   - Find the main accent color (highest count among accents)
 *   - Derive success (green) at absolute hue 120°
 *   - Derive warning (amber) at absolute hue 45°
 *   - Derive error (red) at absolute hue 0°/360°
 *   - Derive info (blue) at absolute hue 210°
 *   - Maintain similar lightness/saturation profile as accent
 */
export function fillSemanticGaps(extraction) {
  var colors = extraction.colors || [];

  // Check what semantic roles already exist (heuristic naming detection)
  var hasSuccess = colors.some(function (c) {
    return /success|green|confirm|valid|positive/.test(c.token || "");
  });
  var hasWarning = colors.some(function (c) {
    return /warning|amber|yellow|caution|alert/.test(c.token || "");
  });
  var hasError = colors.some(function (c) {
    return /error|red|danger|invalid|negative|destructive/.test(c.token || "");
  });
  var hasInfo = colors.some(function (c) {
    return /info|blue|neutral/.test(c.token || "");
  });

  // Find the primary accent color to derive from
  var accents = colors.filter(function (c) { return c.role === "accent"; });
  var primaryAccent = null;
  var mostUsed = 0;
  accents.forEach(function (c) {
    if (c.usageCount > mostUsed) { mostUsed = c.usageCount; primaryAccent = c; }
  });
  // Fallback: use the first accent
  if (!primaryAccent && accents.length > 0) primaryAccent = accents[0];

  if (!primaryAccent) {
    // No accent at all — use a sensible default base
    primaryAccent = { value: "#6C5CE7", hsl: rgbToHsl(108, 92, 231) };
  }

  var baseHsl = primaryAccent.hsl;

  // Derive semantic colors at absolute hue positions (not shifts from accent)
  var derive = function (targetHue, role, token) {
    var h = ((targetHue % 360) + 360) % 360;
    // Make semantic colors more saturated and mid-lightness for visibility
    var s = Math.min(1, Math.max(0.4, baseHsl.s * 1.1));
    var l = Math.min(0.85, Math.max(0.3, baseHsl.l > 0.6 ? 0.45 : baseHsl.l < 0.3 ? 0.5 : baseHsl.l));
    var rgb = hslToRgb(h, s, l);
    return {
      token: "--color-" + token,
      value: "#" + rgb.r.toString(16).padStart(2, "0") + rgb.g.toString(16).padStart(2, "0") + rgb.b.toString(16).padStart(2, "0"),
      role: role,
      usageCount: 0,
      hsl: { h: h, s: s, l: l },
      _derived: true,
    };
  };

  var newColors = colors.slice();

  if (!hasSuccess) {
    newColors.push(derive(120, "success", "success"));
  }
  if (!hasWarning) {
    newColors.push(derive(45, "warning", "warning"));
  }
  if (!hasError) {
    newColors.push(derive(0, "error", "error"));
  }
  if (!hasInfo) {
    newColors.push(derive(210, "info", "info"));
  }

  return Object.assign({}, extraction, { colors: newColors });
}

// ═══════════════════════════════════════════════════════════════
// STRUCTURAL COMPONENT DISCOVERY (80/20)
// ═══════════════════════════════════════════════════════════════

/**
 * Discover component patterns by DOM structure heuristics.
 * Falls back to palette-derived defaults when nothing is found.
 *
 * 80/20 rule: quick heuristics only. No deep edge-case handling.
 * If detection is ambiguous → deliver defaults.
 */
export function discoverStructuralComponents(frames, palette) {
  if (!frames || frames.length === 0) return [];

  var discovered = [];
  var paletteColors = palette || [];
  var accentColor = "#6C5CE7";
  var bgColor = "#FFFFFF";
  var textColor = "#1A1A2E";

  paletteColors.forEach(function (c) {
    if (c.role === "accent" && !accentColor) accentColor = c.value;
    if (c.role === "background" && !bgColor) bgColor = c.value;
    if (c.role === "text" && !textColor) textColor = c.value;
  });

  // Heuristic 1: Rounded rectangle with text → button
  var buttonCandidates = [];
  frames.forEach(function (frame) {
    try {
      var $ = cheerio.load(frame.html || "");
      $("*").each(function (_, el) {
        var $el = $(el);
        var style = ($el.attr("style") || "").toLowerCase();
        var hasBorderRadius = /border-radius\s*:\s*(\d+)px/.test(style);
        var hasBg = /background(-color)?\s*:/.test(style);
        var text = $el.text().trim();
        var hasText = text.length > 0 && text.length < 80;
        var hasChildren = $el.children().length === 0 ||
          ($el.children().length === 1 && $el.children().first().text().trim() === text);

        if (hasBorderRadius && hasBg && hasText && hasChildren) {
          // Extract the border-radius value
          var rxMatch = style.match(/border-radius\s*:\s*(\d+)px/);
          var rx = rxMatch ? parseInt(rxMatch[1]) : 8;
          var elTag = ($el.prop("tagName") || "button").toLowerCase();
          buttonCandidates.push({ tag: elTag, radius: rx, text: text.substring(0, 60) });
        }
      });
    } catch (e) { /* skip */ }
  });

  if (buttonCandidates.length > 0) {
    var avgRadius = Math.round(buttonCandidates.reduce(function (s, b) { return s + b.radius; }, 0) / buttonCandidates.length);
    discovered.push({
      type: "button",
      selector: ".btn",
      tag: "button",
      frameCount: buttonCandidates.length,
      totalFrames: frames.length,
      coverage: Math.min(1, buttonCandidates.length / frames.length),
      confidence: buttonCandidates.length >= 2 ? "high" : "medium",
      sampleHtml: "<button class=\"btn\" style=\"background:" + accentColor + ";color:" + bgColor + ";border-radius:" + avgRadius + "px;padding:12px 24px;border:none;cursor:pointer;\">" + (buttonCandidates[0].text || "Button") + "</button>",
    });
  }

  // Heuristic 2: Container with img + heading + paragraph → card
  var cardCandidates = 0;
  frames.forEach(function (frame) {
    try {
      var $ = cheerio.load(frame.html || "");
      $("div, article, section").each(function (_, el) {
        var $el = $(el);
        var hasImg = $el.find("img").length > 0;
        var hasHeading = $el.find("h1, h2, h3, h4, h5, h6").length > 0;
        var hasP = $el.find("p").length > 0;
        if (hasImg && hasHeading && hasP) {
          cardCandidates++;
          return false; // break each loop
        }
      });
    } catch (e) { /* skip */ }
  });

  if (cardCandidates > 0) {
    var cardRadius = 12;
    // Try to detect radius from first card
    frames.forEach(function (frame) {
      try {
        var $ = cheerio.load(frame.html || "");
        $("div[style*='border-radius']").each(function (_, el) {
          var style = ($(el).attr("style") || "").toLowerCase();
          var rxMatch = style.match(/border-radius\s*:\s*(\d+)px/);
          if (rxMatch) { cardRadius = parseInt(rxMatch[1]); return false; }
        });
      } catch (e) { /* skip */ }
    });

    discovered.push({
      type: "card",
      selector: ".card",
      tag: "div",
      frameCount: cardCandidates,
      totalFrames: frames.length,
      coverage: Math.min(1, cardCandidates / frames.length),
      confidence: cardCandidates >= 2 ? "high" : "medium",
      sampleHtml: "<div class=\"card\" style=\"background:" + bgColor + ";border-radius:" + cardRadius + "px;overflow:hidden;\"><img src=\"\" alt=\"\"/><h3>Card Title</h3><p>Card description</p></div>",
    });
  }

  // Heuristic 3: input/textarea elements → form input
  var inputCount = 0;
  frames.forEach(function (frame) {
    try {
      var $ = cheerio.load(frame.html || "");
      inputCount += $("input, textarea, select").length;
    } catch (e) { /* skip */ }
  });

  if (inputCount > 0) {
    discovered.push({
      type: "input",
      selector: ".input",
      tag: "input",
      frameCount: inputCount,
      totalFrames: frames.length,
      coverage: Math.min(1, inputCount / Math.max(1, frames.length)),
      confidence: "medium",
      sampleHtml: "<input class=\"input\" type=\"text\" placeholder=\"Enter text…\" style=\"background:" + bgColor + ";color:" + textColor + ";border:1px solid rgba(0,0,0,0.1);padding:10px 16px;border-radius:8px;\"/>",
    });
  }

  // ── Default components if nothing detected ──
  if (discovered.length === 0) {
    // Button defaults
    discovered.push({
      type: "button", selector: ".btn", tag: "button",
      frameCount: 1, totalFrames: frames.length, coverage: 1,
      confidence: "low", _default: true,
      sampleHtml: "<button class=\"btn\" style=\"background:" + accentColor + ";color:#fff;border-radius:8px;padding:12px 24px;border:none;cursor:pointer;font-weight:600;\">Button</button>",
    });
    discovered.push({
      type: "button-secondary", selector: ".btn-secondary", tag: "button",
      frameCount: 1, totalFrames: frames.length, coverage: 1,
      confidence: "low", _default: true,
      sampleHtml: "<button class=\"btn-secondary\" style=\"background:transparent;color:" + accentColor + ";border:2px solid " + accentColor + ";border-radius:8px;padding:12px 24px;cursor:pointer;font-weight:600;\">Secondary</button>",
    });
    discovered.push({
      type: "button-ghost", selector: ".btn-ghost", tag: "button",
      frameCount: 1, totalFrames: frames.length, coverage: 1,
      confidence: "low", _default: true,
      sampleHtml: "<button class=\"btn-ghost\" style=\"background:transparent;color:" + accentColor + ";border:none;padding:12px 24px;cursor:pointer;font-weight:600;\">Ghost</button>",
    });

    // Card default
    discovered.push({
      type: "card", selector: ".card", tag: "div",
      frameCount: 1, totalFrames: frames.length, coverage: 1,
      confidence: "low", _default: true,
      sampleHtml: "<div class=\"card\" style=\"background:" + bgColor + ";border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);\"><img src=\"\" alt=\"\" style=\"width:100%;\"/><div style=\"padding:16px;\"><h3>Card Title</h3><p>Card description text goes here.</p></div></div>",
    });

    // Input default
    discovered.push({
      type: "input", selector: ".input", tag: "input",
      frameCount: 1, totalFrames: frames.length, coverage: 1,
      confidence: "low", _default: true,
      sampleHtml: "<input class=\"input\" type=\"text\" placeholder=\"Enter text…\" style=\"background:" + bgColor + ";color:" + textColor + ";border:1px solid rgba(0,0,0,0.1);padding:10px 16px;border-radius:8px;font-size:14px;width:100%;\"/>",
    });
  }

  return discovered;
}

// ═══════════════════════════════════════════════════════════════
// BRAND MANUAL FRAME GENERATOR
// ═══════════════════════════════════════════════════════════════

function escapeHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

/**
 * Generate 1920×1080 frames presenting the design system as a brand manual.
 * Each frame uses colors from the extraction for visual consistency.
 *
 * @param {Object} extraction — result of extractDesignSystem + fillSemanticGaps
 * @param {string} designName
 * @returns {Array<{name: string, html: string, css: string}>}
 */
export function generateManualFrames(extraction, designName) {
  var colors = extraction.colors || [];
  var bg = getRoleColor("background") || "#ffffff";
  var text = getRoleColor("text") || "#111111";
  var accent = getRoleColor("accent") || "#6C5CE7";
  var muted = getRoleColor("other") || "#999999";
  var success = getRoleColor("success") || "#22c55e";
  var error = getRoleColor("error") || "#ef4444";
  var warning = getRoleColor("warning") || "#f59e0b";
  var info = getRoleColor("info") || "#3b82f6";

  function getRoleColor(role) {
    var c = colors.filter(function(c) { return c.role === role; })[0];
    return c ? c.value : null;
  }

  // Derived gradient stop
  var accent2 = colors.filter(function(c) { return c.role === "accent"; })[1];
  var gradColor = accent2 ? accent2.value : accent;

  var frames = [];
  var W = 1920, H = 1080;

  // ── FRAME 1: Cover ──
  frames.push({
    name: "01 — Cover",
    html: [
      '<div class="cover">',
      '  <div class="cover-badge">Design System Manual</div>',
      '  <h1 class="cover-title">' + escapeHtml(designName) + '</h1>',
      '  <p class="cover-sub">Generated by Futuraria Design Harness</p>',
      '  <div class="cover-meta">',
      '    <span>' + colors.filter(function(c) { return c.role; }).length + ' Semantic Colors</span>',
      '    <span>' + (extraction.components || []).length + ' Components</span>',
      '    <span>' + (extraction.typography && extraction.typography.families ? extraction.typography.families.length : 0) + ' Font Families</span>',
      '  </div>',
      '</div>',
    ].join("\n"),
    css: [
      '* { margin: 0; padding: 0; box-sizing: border-box; }',
      'body { background: linear-gradient(135deg, ' + bg + ' 0%, ' + bg + ' 40%, ' + gradColor + '22 100%); font-family: "Inter", system-ui, sans-serif; width: ' + W + 'px; height: ' + H + 'px; display: flex; align-items: center; justify-content: center; overflow: hidden; }',
      '.cover { text-align: center; max-width: 800px; }',
      '.cover-badge { display: inline-block; background: ' + accent + '22; color: ' + accent + '; border: 1px solid ' + accent + '44; border-radius: 40px; padding: 8px 28px; font-size: 14px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 32px; }',
      '.cover-title { font-size: 56px; font-weight: 800; color: ' + text + '; line-height: 1.15; margin-bottom: 16px; letter-spacing: -1px; }',
      '.cover-sub { font-size: 18px; color: ' + muted + '; margin-bottom: 48px; }',
      '.cover-meta { display: flex; gap: 24px; justify-content: center; }',
      '.cover-meta span { background: ' + bg + '; color: ' + text + '; padding: 10px 24px; border-radius: 12px; font-size: 15px; font-weight: 500; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }',
    ].join("\n"),
  });

  // ── FRAME 2: Color Palette ──
  var swatchesHtml = colors.map(function(c, i) {
    var isDerived = c._derived ? ' derived' : '';
    var hex = c.value || '#ccc';
    return '<div class="swatch' + isDerived + '"><div class="swatch-color" style="background:' + hex + '"></div><div class="swatch-info"><strong>' + escapeHtml(hex) + '</strong><span>' + escapeHtml(c.role || 'other') + '</span></div></div>';
  }).join("\n");

  frames.push({
    name: "02 — Colors",
    html: [
      '<div class="colors-page">',
      '  <h2 class="section-title">🎨 Color Palette</h2>',
      '  <p class="section-desc">All semantic colors extracted and derived from the design.</p>',
      '  <div class="swatch-grid">',
      swatchesHtml,
      '  </div>',
      '  <p class="legend">🤖 <em>Derived</em> = auto-filled using color theory. ✅ <em>Extracted</em> = found in the design.</p>',
      '</div>',
    ].join("\n"),
    css: [
      '* { margin: 0; padding: 0; box-sizing: border-box; }',
      'body { background: ' + bg + '; font-family: "Inter", system-ui, sans-serif; width: ' + W + 'px; height: ' + H + 'px; display: flex; align-items: center; justify-content: center; }',
      '.colors-page { width: 900px; }',
      '.section-title { font-size: 36px; font-weight: 700; color: ' + text + '; margin-bottom: 8px; }',
      '.section-desc { font-size: 16px; color: ' + muted + '; margin-bottom: 40px; }',
      '.swatch-grid { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 24px; }',
      '.swatch { background: ' + (bg === '#ffffff' ? '#f8f8f8' : bg) + '; border-radius: 16px; padding: 12px; width: 200px; display: flex; align-items: center; gap: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }',
      '.swatch-color { width: 48px; height: 48px; border-radius: 12px; flex-shrink: 0; border: 1px solid rgba(0,0,0,0.06); }',
      '.swatch-info { display: flex; flex-direction: column; }',
      '.swatch-info strong { font-size: 15px; font-family: "JetBrains Mono", monospace; color: ' + text + '; }',
      '.swatch-info span { font-size: 12px; color: ' + muted + '; text-transform: capitalize; }',
      '.swatch.derived .swatch-color { border: 2px dashed ' + muted + '; }',
      '.legend { font-size: 13px; color: ' + muted + '; }',
    ].join("\n"),
  });

  // ── FRAME 3: Typography ──
  var typo = extraction.typography || {};
  var families = (typo.families || []).map(function(f) { return f.name || f; }).slice(0, 5);
  var scale = (typo.typeScale || []).sort(function(a, b) { return b - a; });
  var weights = (typo.weights || []).sort(function(a, b) { return b - a; });
  var primaryFont = families[0] || "Inter";

  var scaleRows = scale.map(function(s) {
    return '<tr><td class="size-preview" style="font-size:' + s + 'px">Aa</td><td>' + s + 'px</td></tr>';
  }).join("\n");

  var weightRows = weights.map(function(w) {
    return '<tr><td class="weight-preview" style="font-weight:' + w + '">' + primaryFont + '</td><td>' + w + '</td></tr>';
  }).join("\n");

  var foxText = '<p class="fox" style="font-family:\"' + primaryFont + '\", sans-serif">The quick brown fox jumps over the lazy dog.</p>';

  frames.push({
    name: "03 — Typography",
    html: [
      '<div class="typo-page">',
      '  <h2 class="section-title">🔤 Typography</h2>',
      '  <p class="section-desc">Font families, type scale, and weights from the design.</p>',
      '  <div class="typo-grid">',
      '    <div class="typo-col">',
      '      <h3>Font Families</h3>',
      '      <ul class="font-list">' + families.map(function(f) { return '<li>' + escapeHtml(f) + '</li>'; }).join("") + '</ul>',
      '      <div class="fox-preview">' + foxText + '</div>',
      '    </div>',
      '    <div class="typo-col">',
      '      <h3>Type Scale</h3>',
      '      <table class="typo-table"><thead><tr><th>Preview</th><th>Size</th></tr></thead><tbody>' + scaleRows + '</tbody></table>',
      '    </div>',
      '    <div class="typo-col">',
      '      <h3>Font Weights</h3>',
      '      <table class="typo-table"><thead><tr><th>Preview</th><th>Weight</th></tr></thead><tbody>' + weightRows + '</tbody></table>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join("\n"),
    css: [
      '* { margin: 0; padding: 0; box-sizing: border-box; }',
      'body { background: ' + bg + '; font-family: "' + primaryFont + '", system-ui, sans-serif; width: ' + W + 'px; height: ' + H + 'px; display: flex; align-items: center; justify-content: center; }',
      '.typo-page { width: 1100px; }',
      '.section-title { font-size: 36px; font-weight: 700; color: ' + text + '; margin-bottom: 8px; }',
      '.section-desc { font-size: 16px; color: ' + muted + '; margin-bottom: 40px; }',
      '.typo-grid { display: flex; gap: 32px; }',
      '.typo-col { flex: 1; }',
      '.typo-col h3 { font-size: 16px; font-weight: 600; color: ' + accent + '; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }',
      '.font-list { list-style: none; }',
      '.font-list li { padding: 8px 0; font-size: 18px; color: ' + text + '; border-bottom: 1px solid ' + muted + '33; }',
      '.fox-preview { margin-top: 24px; padding: 20px; background: ' + (bg === '#ffffff' ? '#f8f8f8' : bg) + '; border-radius: 12px; }',
      '.fox { font-size: 20px; color: ' + text + '; line-height: 1.6; }',
      '.typo-table { width: 100%; border-collapse: collapse; }',
      '.typo-table th { text-align: left; font-size: 12px; color: ' + muted + '; padding-bottom: 8px; border-bottom: 2px solid ' + accent + '44; }',
      '.typo-table td { padding: 10px 0; font-size: 14px; color: ' + text + '; border-bottom: 1px solid ' + muted + '22; }',
      '.size-preview { font-weight: 600; line-height: 1.2; }',
      '.weight-preview { line-height: 1.4; }',
    ].join("\n"),
  });

  // ── FRAME 4: Components (code snippets, not rendered) ──
  var comps = extraction.components || [];
  var compCards = comps.slice(0, 6).map(function(c, i) {
    var sample = c.sampleHtml || '';
    var escaped = escapeHtml(sample);
    return [
      '<div class="comp-card">',
      '  <div class="comp-header">',
      '    <h3>' + escapeHtml(c.selector || c.type || 'Component ' + (i + 1)) + '</h3>',
      '    <span class="comp-badge ' + (c.confidence || 'low') + '">' + (c.confidence || 'low') + '</span>',
      '  </div>',
      '  <div class="comp-meta">',
      '    <span>Tag: <code>' + escapeHtml(c.tag || 'div') + '</code></span>',
      '    <span>Coverage: ' + Math.round((c.coverage || 0) * 100) + '%</span>',
      '  </div>',
      '  <pre class="comp-code">' + (escaped || '<span class="no-code">(no sample)</span>') + '</pre>',
      '</div>',
    ].join("\n");
  }).join("\n");

  if (!compCards) {
    compCards = '<p class="no-comps">No components detected — the design may use utility classes or inline styles.</p>';
  }

  frames.push({
    name: "04 — Components",
    html: [
      '<div class="comps-page">',
      '  <h2 class="section-title">🧩 Components</h2>',
      '  <p class="section-desc">Component patterns detected from DOM structure. Code snippets show the canonical markup.</p>',
      '  <div class="comps-grid">',
      compCards,
      '  </div>',
      '</div>',
    ].join("\n"),
    css: [
      '* { margin: 0; padding: 0; box-sizing: border-box; }',
      'body { background: ' + bg + '; font-family: "Inter", system-ui, sans-serif; width: ' + W + 'px; height: ' + H + 'px; display: flex; align-items: center; justify-content: center; }',
      '.comps-page { width: 1100px; }',
      '.section-title { font-size: 36px; font-weight: 700; color: ' + text + '; margin-bottom: 8px; }',
      '.section-desc { font-size: 16px; color: ' + muted + '; margin-bottom: 32px; }',
      '.comps-grid { display: flex; flex-wrap: wrap; gap: 20px; }',
      '.comp-card { background: ' + (bg === '#ffffff' ? '#f8f8f8' : bg) + '; border-radius: 16px; padding: 20px; width: 340px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }',
      '.comp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }',
      '.comp-header h3 { font-size: 16px; font-weight: 600; color: ' + text + '; font-family: "JetBrains Mono", monospace; }',
      '.comp-badge { font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 20px; text-transform: uppercase; }',
      '.comp-badge.high { background: ' + success + '22; color: ' + success + '; }',
      '.comp-badge.medium { background: ' + warning + '22; color: ' + warning + '; }',
      '.comp-badge.low { background: ' + muted + '22; color: ' + muted + '; }',
      '.comp-meta { display: flex; gap: 16px; margin-bottom: 12px; font-size: 12px; color: ' + muted + '; }',
      '.comp-meta code { font-size: 12px; background: ' + accent + '11; padding: 2px 6px; border-radius: 4px; }',
      '.comp-code { background: ' + text + '08; padding: 12px; border-radius: 8px; font-family: "JetBrains Mono", monospace; font-size: 11px; color: ' + text + '; overflow-x: auto; white-space: pre-wrap; line-height: 1.6; max-height: 120px; overflow-y: auto; }',
      '.no-code { color: ' + muted + '; font-style: italic; }',
      '.no-comps { font-size: 16px; color: ' + muted + '; }',
    ].join("\n"),
  });

  // ── FRAME 5: Spacing, Radii, Shadows ──
  var spacingRows = (extraction.spacing || []).map(function(s) {
    return '<tr><td><code>--space-' + s + '</code></td><td>' + s + 'px</td></tr>';
  }).join("\n");

  var radiiRows = (extraction.radii || []).map(function(r) {
    return '<tr><td><code>' + escapeHtml(r.value || '') + '</code></td><td>Used ' + (r.count || 0) + '×</td></tr>';
  }).join("\n");

  var shadowRows = (extraction.shadows || []).map(function(s) {
    return '<tr><td style="font-family:monospace;font-size:11px">' + escapeHtml((s.value || '').substring(0, 60)) + '</td><td>' + (s.count || 0) + '×</td></tr>';
  }).join("\n");

  frames.push({
    name: "05 — Tokens",
    html: [
      '<div class="tokens-page">',
      '  <h2 class="section-title">📐 Design Tokens</h2>',
      '  <p class="section-desc">Spacing scale, border radii, and box shadows — as they appear in the design.</p>',
      '  <div class="tokens-grid">',
      '    <div class="token-col">',
      '      <h3>Spacing Scale</h3>',
      '      <table class="token-table"><thead><tr><th>Token</th><th>Value</th></tr></thead><tbody>' + (spacingRows || '<tr><td colspan="2" class="empty">No spacing values detected</td></tr>') + '</tbody></table>',
      '    </div>',
      '    <div class="token-col">',
      '      <h3>Border Radii</h3>',
      '      <table class="token-table"><thead><tr><th>Value</th><th>Frequency</th></tr></thead><tbody>' + (radiiRows || '<tr><td colspan="2" class="empty">No radii detected</td></tr>') + '</tbody></table>',
      '    </div>',
      '    <div class="token-col">',
      '      <h3>Box Shadows</h3>',
      '      <table class="token-table"><thead><tr><th>Value</th><th>Freq</th></tr></thead><tbody>' + (shadowRows || '<tr><td colspan="2" class="empty">No shadows detected</td></tr>') + '</tbody></table>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join("\n"),
    css: [
      '* { margin: 0; padding: 0; box-sizing: border-box; }',
      'body { background: ' + bg + '; font-family: "Inter", system-ui, sans-serif; width: ' + W + 'px; height: ' + H + 'px; display: flex; align-items: center; justify-content: center; }',
      '.tokens-page { width: 1100px; }',
      '.section-title { font-size: 36px; font-weight: 700; color: ' + text + '; margin-bottom: 8px; }',
      '.section-desc { font-size: 16px; color: ' + muted + '; margin-bottom: 32px; }',
      '.tokens-grid { display: flex; gap: 32px; }',
      '.token-col { flex: 1; }',
      '.token-col h3 { font-size: 16px; font-weight: 600; color: ' + accent + '; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }',
      '.token-table { width: 100%; border-collapse: collapse; }',
      '.token-table th { text-align: left; font-size: 12px; color: ' + muted + '; padding-bottom: 8px; border-bottom: 2px solid ' + accent + '44; }',
      '.token-table td { padding: 10px 0; font-size: 14px; color: ' + text + '; border-bottom: 1px solid ' + muted + '22; }',
      '.token-table td code { font-size: 13px; background: ' + accent + '11; padding: 2px 8px; border-radius: 4px; font-family: "JetBrains Mono", monospace; }',
      '.empty { color: ' + muted + '; font-style: italic; text-align: center; }',
    ].join("\n"),
  });

  // ── FRAME 6: Artifacts ──
  var hash = extraction.sourceHash || "N/A";
  frames.push({
    name: "06 — Artifacts",
    html: [
      '<div class="artifacts-page">',
      '  <h2 class="section-title">📦 Generated Artifacts</h2>',
      '  <p class="section-desc">Three files produced by the deterministic design system extraction engine.</p>',
      '  <div class="artifact-grid">',
      '    <div class="artifact-card">',
      '      <div class="artifact-icon">📋</div>',
      '      <h3>tokens.json</h3>',
      '      <p>DTCG-format design tokens. Import into Figma, Style Dictionary, or any token-compatible tool. Contains all colors, typography, spacing, radii, and shadows with semantic roles.</p>',
      '      <code>Format: DTCG (Design Tokens Community Group)</code>',
      '    </div>',
      '    <div class="artifact-card">',
      '      <div class="artifact-icon">🎨</div>',
      '      <h3>shared.css</h3>',
      '      <p>Ready-to-use CSS custom properties with :root variables and component classes. Drop into any web project for instant design system theming.</p>',
      '      <code>Format: CSS Custom Properties</code>',
      '    </div>',
      '    <div class="artifact-card">',
      '      <div class="artifact-icon">📖</div>',
      '      <h3>DESIGN.md</h3>',
      '      <p>Structured markdown reference with color tables, typography scale, component catalog, and usage notes. Ideal for documentation and handoff.</p>',
      '      <code>Format: Markdown</code>',
      '    </div>',
      '  </div>',
      '  <div class="fingerprint">',
      '    <span class="fp-label">Style Fingerprint</span>',
      '    <code class="fp-hash">' + escapeHtml(hash) + '</code>',
      '    <p class="fp-note">Same input always produces this exact fingerprint — the system is fully deterministic.</p>',
      '  </div>',
      '</div>',
    ].join("\n"),
    css: [
      '* { margin: 0; padding: 0; box-sizing: border-box; }',
      'body { background: ' + bg + '; font-family: "Inter", system-ui, sans-serif; width: ' + W + 'px; height: ' + H + 'px; display: flex; align-items: center; justify-content: center; }',
      '.artifacts-page { width: 1000px; }',
      '.section-title { font-size: 36px; font-weight: 700; color: ' + text + '; margin-bottom: 8px; }',
      '.section-desc { font-size: 16px; color: ' + muted + '; margin-bottom: 40px; }',
      '.artifact-grid { display: flex; gap: 24px; margin-bottom: 40px; }',
      '.artifact-card { flex: 1; background: ' + (bg === '#ffffff' ? '#f8f8f8' : bg) + '; border-radius: 16px; padding: 28px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }',
      '.artifact-icon { font-size: 36px; margin-bottom: 12px; }',
      '.artifact-card h3 { font-size: 18px; font-weight: 700; color: ' + text + '; margin-bottom: 8px; }',
      '.artifact-card p { font-size: 14px; color: ' + muted + '; line-height: 1.6; margin-bottom: 12px; }',
      '.artifact-card code { font-size: 11px; background: ' + accent + '11; color: ' + accent + '; padding: 4px 10px; border-radius: 6px; font-family: "JetBrains Mono", monospace; }',
      '.fingerprint { text-align: center; padding: 24px; background: ' + accent + '08; border-radius: 16px; border: 1px solid ' + accent + '22; }',
      '.fp-label { font-size: 12px; font-weight: 600; color: ' + muted + '; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 8px; }',
      '.fp-hash { font-size: 14px; font-family: "JetBrains Mono", monospace; color: ' + text + '; word-break: break-all; }',
      '.fp-note { font-size: 13px; color: ' + muted + '; margin-top: 8px; }',
    ].join("\n"),
  });

  return frames;
}
