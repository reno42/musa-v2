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
  return a.value.localeCompare(b.value);
}

function sortNumberDesc(a, b) {
  return b - a;
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
    allRules.push.apply(allRules, parsed.rules);
    allAtRules.push.apply(allAtRules, parsed.atRules);
    allImports.push.apply(allImports, parsed.imports);
    frameCssMap[f.id || i] = parsed.rules;
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
    .sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });

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
        selector: c.tag + "." + c.classList.join("."),
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
      return a.selector.localeCompare(b.selector);
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
    lines.push(extraction.typography.weights.join(", "));
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
      lines.push("- **Classes:** " + c.classes.join(", "));
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
