// style-template-v2.mjs — v2 Rich Design System Template (DTCG-compatible)
// This is the canonical template used by download_style_template and given to external AI tools.
// Structure preserves ALL sections from the NewForm-level template so AIs can produce
// complete, consistent design systems that upload correctly via Style Library.
export const STYLE_TEMPLATE_V2 = `{
  "$schema": "https://design-tokens.org/format",
  "$version": "2.0",
  "$instructions": [
    "ESTE ARCHIVO ES EL TEMPLATE COMPLETO para replicar estilos de diseño.",
    "Todas las secciones son obligatorias. Si una categoría no aplica a tu estilo, usa \\"none\\" o array vacío [].",
    "Reemplaza todos los valores de ejemplo con los de tu marca. Mantén la estructura exacta.",
    "Para usar con Gemini: 'Replicá este estilo usando el template adjunto. Quiero [N] slides de [1080x1080|1080x1350] para [propósito].'",
    "Cada componente incluye el CSS exacto que lo define. Gemini debe usar estas clases tal cual o adaptarlas manteniendo proporciones.",
    "Las reglas 'do' y 'dont' NO SON OPCIONALES — son constraints que Gemini debe respetar estrictamente."
  ],

  "meta": {
    "name": "",
    "version": "2.0",
    "theme": "light",
    "density": "spacious",
    "mood": "",
    "description": "",
    "similarBrands": [],
    "formatDimensions": {
      "instagramPost": "1080×1080px",
      "carouselSlide": "1080×1350px",
      "storyVertical": "1080×1920px"
    }
  },

  "color": {
    "canvas": {
      "$value": "",
      "role": "Page background — full-bleed canvas for every section",
      "description": "",
      "constraints": "Every section sits on this canvas."
    },
    "ink": {
      "$value": "",
      "role": "Primary text, dominant borders",
      "description": "",
      "constraints": "Primary text color for h1-h6, strong tags, and dominant borders."
    },
    "inkPure": {
      "$value": "",
      "role": "Hard borders, icon strokes, deepest text layer",
      "description": "Pure black reserved for maximum contrast moments."
    },
    "bark": {
      "$value": "",
      "role": "Secondary dark surface",
      "description": "Half-step lighter than ink for layered depth."
    },
    "inkSecondary": {
      "$value": "",
      "role": "Muted body text, secondary borders, labels",
      "description": "Secondary text color for paragraphs, captions, labels."
    },
    "border": {
      "$value": "",
      "role": "Hairline dividers, card borders, subtle separators",
      "description": "Subtle border color for dividers and card edges."
    },
    "accent": {
      "$value": "",
      "role": "Primary CTA color — filled buttons, selected nav, focused conversion moments",
      "description": "The main saturated accent color. Used surgically for CTAs and emphasis.",
      "constraints": "NEVER use for body text, headings, or backgrounds. Only for CTAs, highlights, and focused conversion moments."
    },
    "accentSupport": {
      "$value": "",
      "role": "Supporting accent — decorative details, low-frequency emphasis",
      "description": "Muted version of accent for decorative elements.",
      "constraints": "Decorative only. Do NOT promote to primary CTA color."
    },
    "pollen": {
      "$value": "",
      "role": "Light supporting accent — decorative, low-frequency",
      "description": "Very light tint for subtle decorative accents.",
      "constraints": "Decorative only."
    },
    "success": {
      "$value": "",
      "role": "Success state",
      "description": "Success indicator color."
    },
    "warning": {
      "$value": "",
      "role": "Warning state",
      "description": "Warning indicator color."
    },
    "error": {
      "$value": "",
      "role": "Error state",
      "description": "Error indicator color."
    }
  },

  "typography": {
    "families": [
      {
        "name": "",
        "token": "--font-display-primary",
        "role": "Hero display headlines",
        "weights": [],
        "defaultSize": "",
        "lineHeight": 0.9,
        "letterSpacing": "",
        "ideal": "",
        "fallback": "",
        "usage": "",
        "constraints": ""
      },
      {
        "name": "",
        "token": "--font-display-secondary",
        "role": "Alternative display voice for architectural/monumental statements",
        "weights": [],
        "defaultSize": "",
        "lineHeight": 0.9,
        "letterSpacing": "",
        "ideal": "",
        "fallback": "",
        "usage": "",
        "constraints": ""
      },
      {
        "name": "",
        "token": "--font-ui",
        "role": "Primary UI and body family. All non-display text: nav, labels, body copy, buttons.",
        "weights": [],
        "ideal": "",
        "fallback": "",
        "defaultSize": "",
        "lineHeight": "1.4 for body, 1.1 for larger UI",
        "usage": "",
        "constraints": "",
        "weightRoles": {}
      },
      {
        "name": "",
        "token": "--font-caption",
        "role": "System serif for image captions and micro-copy",
        "weights": [],
        "ideal": "",
        "fallback": "",
        "defaultSize": "",
        "lineHeight": 1.2,
        "usage": "",
        "constraints": "Captions only. Never for headings or body text."
      }
    ],
    "scale": [
      { "role": "caption", "size": "", "lineHeight": 1.4, "letterSpacing": "", "family": "ui", "weight": 0, "token": "--text-caption" },
      { "role": "body-sm", "size": "", "lineHeight": 1.4, "letterSpacing": "", "family": "ui", "weight": 0, "token": "--text-body-sm" },
      { "role": "body", "size": "", "lineHeight": 1.4, "letterSpacing": "", "family": "ui", "weight": 0, "token": "--text-body" },
      { "role": "body-lg", "size": "", "lineHeight": 1.45, "letterSpacing": "", "family": "ui", "weight": 0, "token": "--text-body-lg" },
      { "role": "body-xl", "size": "", "lineHeight": 1.4, "letterSpacing": "", "family": "ui", "weight": 0, "token": "--text-body-xl" },
      { "role": "subheading", "size": "", "lineHeight": 1.4, "letterSpacing": "", "family": "ui", "weight": 0, "token": "--text-subheading", "textTransform": "uppercase" },
      { "role": "heading-sm", "size": "", "lineHeight": 0.9, "letterSpacing": "", "family": "display", "weight": 0, "token": "--text-heading-sm" },
      { "role": "heading", "size": "", "lineHeight": 1.1, "letterSpacing": "", "family": "display", "weight": 0, "token": "--text-heading" },
      { "role": "heading-lg", "size": "", "lineHeight": 1.1, "letterSpacing": "", "family": "display", "weight": 0, "token": "--text-heading-lg" },
      { "role": "heading-xl", "size": "", "lineHeight": 0.9, "letterSpacing": "", "family": "display", "weight": 0, "token": "--text-heading-xl" },
      { "role": "display", "size": "", "lineHeight": 0.9, "letterSpacing": "", "family": "display", "weight": 0, "token": "--text-display" },
      { "role": "display-lg", "size": "", "lineHeight": 0.9, "letterSpacing": "", "family": "display", "weight": 0, "token": "--text-display-lg" }
    ],
    "textTransformRules": {
      "ctaButton": "uppercase, letter-spacing +0.01em to +0.02em",
      "sectionLabel": "uppercase, letter-spacing +0.08em to +0.1em, weight 600, color inkSecondary",
      "detailLabel": "uppercase, letter-spacing +0.08em, weight 600, color inkSecondary",
      "bodyText": "sentence case, no transform",
      "navLinks": "no transform"
    },
    "colorRules": {
      "h1": "ink color, display family, weight 300-400, line-height 0.9",
      "h1 .italic": "italic style, keep same weight and color",
      "h1 .accentWord": "accent color, italic — used for ONE key word per headline maximum",
      "h3": "inkSecondary color, ui family, weight 600, uppercase, letter-spacing +0.1em — section labels",
      "p": "inkSecondary color, ui family, weight 350-400, line-height 1.4-1.5",
      "p strong": "ink color, weight 550-600",
      "caption": "inkSecondary color, caption family, italic"
    },
    "pairingLogic": "Describe how your font families pair together. When to use display vs UI vs caption families. The logic should explain which font to use at each size tier and for each purpose."
  },

  "spacing": {
    "scale": {
      "4": { "$value": "", "use": "Micro gaps, icon padding" },
      "8": { "$value": "", "use": "Tight inline spacing" },
      "10": { "$value": "", "use": "CTA arrow gap" },
      "15": { "$value": "", "use": "Small icon width" },
      "20": { "$value": "", "use": "Card padding, element gap rhythm" },
      "25": { "$value": "", "use": "Medium gaps" },
      "30": { "$value": "", "use": "Section internal spacing" },
      "32": { "$value": "", "use": "Divider margin" },
      "35": { "$value": "", "use": "Medium-large gaps" },
      "40": { "$value": "", "use": "Detail row gap" },
      "45": { "$value": "", "use": "Large internal spacing" },
      "50": { "$value": "", "use": "Masthead horizontal padding (minimum)" },
      "55": { "$value": "", "use": "Large gaps" },
      "60": { "$value": "", "use": "Large section padding" },
      "120": { "$value": "", "use": "Section gap (lower bound)" },
      "190": { "$value": "", "use": "Section gap (upper bound)" }
    },
    "semantic": {
      "sectionGap": "Vertical rhythm between content blocks. Whitespace IS the divider.",
      "cardPadding": "Standard internal card padding",
      "elementGap": "Inline rhythm between elements of the same type",
      "mastheadPadding": "Horizontal padding for top nav/masthead",
      "contentPadding": "Horizontal + top padding for main content area",
      "footerPadding": "Top (after border) + bottom padding for footer"
    }
  },

  "radius": {
    "card": { "$value": "", "appliesTo": "Cards, images, editorial frames" },
    "button": { "$value": "", "appliesTo": "CTA buttons only" },
    "pill": { "$value": "", "appliesTo": "Pill-style elements: tags, badges" },
    "formField": { "$value": "", "appliesTo": "Input fields, text areas" },
    "calendarDay": { "$value": "", "appliesTo": "Calendar day cells" },
    "tag": { "$value": "", "appliesTo": "Tag/chip elements" },
    "chart": { "$value": "", "appliesTo": "Chart bars, progress tracks" }
  },

  "shadows": {
    "cta": {
      "$value": "",
      "description": "CTA button shadow — tinted with accent color",
      "constraints": "ONLY on filled CTA buttons. Shadow must be tinted with the accent color."
    }
  },

  "surfaces": [
    {
      "level": 0,
      "name": "Canvas",
      "value": "",
      "purpose": "Full-bleed page background. Every section sits on this surface.",
      "elevation": "none"
    },
    {
      "level": 1,
      "name": "Card",
      "value": "",
      "purpose": "Cards defined by radius + padding, not a different fill color.",
      "elevation": "none"
    },
    {
      "level": 2,
      "name": "Dark Panel",
      "value": "",
      "purpose": "Rare dark surface for footer or inverted moments.",
      "elevation": "none"
    },
    {
      "level": 3,
      "name": "Bordered Card",
      "value": "",
      "purpose": "When a card needs visible separation, add border.",
      "border": "1px solid <border-color>",
      "elevation": "none"
    }
  ],

  "layout": {
    "pageMaxWidth": "",
    "contentMaxWidth": "",
    "sectionGap": "",
    "cardPadding": "",
    "grids": {
      "desktop": { "columns": 12, "margin": "24px", "gutter": "24px" },
      "tablet": { "columns": 6, "margin": "24px", "gutter": "24px" },
      "mobile": { "columns": 2, "margin": "24px", "gutter": "24px" }
    },
    "postLayout": {
      "container": "flex column, overflow hidden",
      "structure": "masthead → content (flex:1) → footer-bar",
      "masthead": "flex row, space-between",
      "content": "flex column, flex:1",
      "footerBar": "flex row, space-between, border-top 1px solid border, margin-top auto"
    }
  },

  "components": {
    "masthead": {
      "name": "Masthead / Nav Header",
      "description": "Top bar with split-color wordmark (left) + menu label and icon (right).",
      "css": ".masthead{display:flex;justify-content:space-between;align-items:center;padding:0}",
      "wordmark": {
        "css": ".wm{font-family:ui;font-weight:600} .wm .first{color:ink} .wm .second{color:accent}",
        "rule": "Split-color: first part in ink color, second part in accent color."
      },
      "menu": {
        "css": ".ml{font-family:ui;font-weight:400;color:ink}",
        "structure": "Menu label text + icon mark"
      }
    },

    "heroHeadline": {
      "name": "Hero Display Headline",
      "description": "Massive serif display headline that breaks across multiple lines. The core identity element.",
      "css": "h1{font-family:display;font-weight:300-400;color:ink;line-height:0.9}",
      "sizes": {
        "xl": "font-size:132px;letter-spacing:-0.025em",
        "lg": "font-size:96px;letter-spacing:-0.02em",
        "md": "font-size:64px;letter-spacing:-0.015em"
      },
      "emphasisPatterns": [
        "Italic for style contrast",
        "One accent-color word per headline maximum",
        "Line breaks with <br> for multi-line rhythm"
      ],
      "constraints": "Line-height 0.90 is MANDATORY — lines must nearly touch. This is the signature."
    },

    "accentTick": {
      "name": "Accent Tick Mark",
      "description": "Short horizontal accent lines that function as visual rests between headline and body.",
      "css": ".tick{width:56-72px;height:2-3px;background:accent;margin-bottom:28-32px}",
      "variants": {
        "centered": ".tick.center{margin-left:auto;margin-right:auto}",
        "decorative": ".vt{position:absolute;width:40-54px;height:2-3px;background:accent;opacity:0.5-1.0}"
      },
      "constraints": "Short. Never wider than 72px. Accent color only."
    },

    "bodyText": {
      "name": "Body Text",
      "description": "Paragraphs and inline text in muted color.",
      "css": "p{font-family:ui;font-weight:350-400;color:inkSecondary;line-height:1.4-1.5;max-width:560px} p strong{color:ink;font-weight:550-600}",
      "constraints": "Body text max-width ~560px to maintain readable line length."
    },

    "ctaButton": {
      "name": "Primary CTA Button",
      "description": "Primary action — the ONLY filled button. Accent background with tinted shadow.",
      "css": ".cta{display:inline-flex;align-items:center;gap:8-10px;background:accent;color:inkPure;font-family:ui;font-weight:550-600;text-transform:uppercase;letter-spacing:0.01em-0.02em;padding:14-20px 36-50px;border-radius:button-radius;box-shadow:<accent-tinted-shadow>;text-decoration:none}",
      "structure": "Label text (uppercase) + right arrow (→)",
      "constraints": "ALWAYS includes right arrow. Shadow tinted with accent color. Only filled button on the page."
    },

    "ghostLink": {
      "name": "Ghost Link / Secondary Action",
      "description": "Text-only links for navigation.",
      "css": "color:ink;font-family:ui;font-weight:350-400;text-decoration:none. Underline on hover.",
      "usage": "Menu label, footer links, read-more affordances."
    },

    "imageTile": {
      "name": "Image Tile",
      "description": "Editorial photography cropped into rounded rectangles.",
      "css": "border-radius:card-radius. No border. No shadow. Overflow hidden.",
      "style": "Photo treatment style and constraints.",
      "constraints": "Use card radius. No borders, no shadows on images."
    },

    "captionPair": {
      "name": "Caption / Editorial Metadata",
      "description": "Small italic caption for images or footer context.",
      "css": ".cap{font-family:caption;font-style:italic;color:inkSecondary}",
      "constraints": "Caption family only. Never in UI or display fonts."
    },

    "sectionLabel": {
      "name": "Section Label (h3)",
      "description": "Small uppercase label above display headlines to give context.",
      "css": "h3{font-family:ui;font-weight:600;color:inkSecondary;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:16px}"
    },

    "calendarGrid": {
      "name": "Calendar Grid",
      "description": "7-column responsive grid for event date visualization.",
      "css": ".cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:12px} .cal-header{font-family:ui;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:inkSecondary;text-align:center;padding:8px 0} .cal-day{aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-family:ui;color:ink;border-radius:8px}",
      "states": {
        "event": ".cal-day.event{background:accent;color:inkPure;font-weight:600}",
        "today": ".cal-day.today{border:3px solid ink;font-weight:600}",
        "dim": ".cal-day.dim{color:border}"
      }
    },

    "countdown": {
      "name": "Countdown Timer",
      "description": "Large numbers for event-urgency countdown display.",
      "css": ".countdown{display:flex;gap:44px} .cd-item{text-align:center} .cd-num{font-family:display;font-size:120px;font-weight:400;color:ink;line-height:1} .cd-label{font-family:ui;font-weight:500;color:inkSecondary;text-transform:uppercase;letter-spacing:0.1em}"
    },

    "agendaList": {
      "name": "Agenda / Schedule List",
      "description": "Left-aligned time + title + description for event schedules.",
      "css": ".agenda{display:flex;flex-direction:column;gap:28px} .agenda-item{display:flex;gap:28px;align-items:baseline} .agenda-time{font-family:ui;font-weight:600;color:accent;min-width:88px} .agenda-text h4{font-family:display;font-weight:400;color:ink} .agenda-text p{color:inkSecondary}"
    },

    "timeline": {
      "name": "Vertical Timeline",
      "description": "Chronological timeline with accent dots on a vertical line.",
      "css": ".timeline{display:flex;flex-direction:column;position:relative;padding-left:44px} .timeline::before{content:'';position:absolute;left:12px;top:0;bottom:0;width:3px;background:border} .tl-item{position:relative;padding-bottom:36px} .tl-item::before{content:'';position:absolute;left:-38px;top:8px;width:18px;height:18px;border-radius:50%;background:accent}"
    },

    "speakerBio": {
      "name": "Speaker / Person Bio",
      "description": "Circular photo placeholder + name + role.",
      "css": ".speaker{display:flex;gap:32px;align-items:center} .sp-photo{width:120px;height:120px;border-radius:50%;background:ink;display:flex;align-items:center;justify-content:center;color:canvas;font-family:display;font-size:42px} .sp-info h4{font-family:display;font-weight:400;color:ink} .sp-info .role{font-family:ui;color:inkSecondary}"
    },

    "blockquote": {
      "name": "Blockquote / Testimonial",
      "description": "Large italic quote with left accent border.",
      "css": ".blockquote{padding-left:44px;border-left:4px solid accent} .blockquote .q{font-family:display;font-style:italic;font-weight:400;color:ink;line-height:1.25} .blockquote .a{font-family:ui;font-weight:500;color:inkSecondary}"
    },

    "audiencePills": {
      "name": "Audience / Target Pills",
      "description": "Checkmark-led pills showing target audience segments.",
      "css": ".audience{display:flex;flex-wrap:wrap;gap:16px} .aud-pill{background:canvas;border:1px solid border;border-radius:pill-radius;padding:14px 24px;font-family:ui;color:ink} .aud-pill::before{content:'\\\\2713  ';color:accent;font-weight:700}"
    },

    "expectGrid": {
      "name": "Expectations / Features Grid",
      "description": "2-column grid of feature cards.",
      "css": ".expect-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px} .expect-card{background:canvas;border:1px solid border;border-radius:card-radius;padding:28px} .expect-card h4{font-family:display;font-weight:400;color:ink} .expect-card p{color:inkSecondary}"
    },

    "statGrid": {
      "name": "Statistics / KPI Grid",
      "description": "Big-number stats for impact metrics.",
      "css": ".stat-grid{display:flex;gap:56px} .stat-item{text-align:center} .stat-big{font-family:display;font-size:96px;font-weight:400;color:ink;line-height:1} .stat-big.volt{color:accent} .stat-sub{font-family:ui;color:inkSecondary}"
    },

    "formFields": {
      "name": "Registration / Form Fields",
      "description": "Form with uppercase labels and bordered inputs.",
      "css": ".reg-fields{display:flex;flex-direction:column;gap:16px;max-width:560px} .reg-field{display:flex;flex-direction:column;gap:6px} .reg-field label{font-family:ui;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:inkSecondary} .input{background:canvas;border:1px solid border;border-radius:form-radius;padding:16px 20px;font-family:ui;color:ink}"
    },

    "footerBar": {
      "name": "Footer Bar",
      "description": "Bottom bar with italic caption (left) + CTA button (right), separated by hairline top border.",
      "css": ".footer-bar{display:flex;justify-content:space-between;align-items:center;padding:24-28px 56-76px 40-48px;border-top:1px solid border;margin-top:auto}",
      "structure": "Flex row. Left: italic caption (caption family, inkSecondary). Right: CTA button."
    },

    "detailRow": {
      "name": "Detail / Metadata Row",
      "description": "Horizontal row of label+value pairs for metadata.",
      "css": ".detail-row{display:flex;gap:40-56px} .detail-item{display:flex;flex-direction:column;gap:2-4px} .detail-label{font-family:ui;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:inkSecondary} .detail-value{font-family:ui;font-weight:400;color:ink}"
    },

    "chartBar": {
      "name": "Horizontal Bar Chart",
      "description": "Comparison bar chart with accent-colored fills.",
      "css": ".bars-wrap{display:flex;flex-direction:column;gap:24px;width:440px} .bar-row{display:flex;align-items:center;gap:20px} .bar-label{font-family:ui;font-weight:600;color:ink} .bar-track{flex:1;height:26px;background:<track-bg>;border-radius:6px;overflow:hidden} .bar-fill{height:100%;border-radius:6px} .bar-pct{font-family:ui;font-weight:500;color:ink;text-align:right}"
    },

    "slide": {
      "name": "Slide Container (Carousel/PPT)",
      "description": "Container for carousel slides — the PPT/deck format.",
      "css": ".slide{width:1080px;height:1350px;background:canvas;position:relative;overflow:hidden;display:flex;flex-direction:column;font-family:ui;page-break-after:always}",
      "difference": "Same design system as 1080×1080 posts but taller. More vertical space for content-heavy slides."
    }
  },

  "decoration": {
    "accentTicks": {
      "description": "Short accent horizontal lines (40-72px × 2-3px) placed at page corners or between sections.",
      "usage": "Visual rests — small accent beats. Can be full opacity or 0.5 opacity for decorative corners.",
      "css": ".vt{position:absolute;width:40-54px;height:2-3px;background:accent}"
    },
    "ornaments": {
      "description": "Large faint circles at very low opacity for atmospheric depth.",
      "css": ".orn{position:absolute;width:120px;height:120px;border-radius:50%;background:inkPure;opacity:0.05-0.06}",
      "placement": "Corner areas. Never center. Never competing with content."
    }
  },

  "imagery": {
    "style": "Describe your photography/image style. Treatment, mood, subject matter.",
    "treatment": "Color treatment: full color, monochrome, duotone, desaturated.",
    "frames": "Image frame styling: radius, border, shadow.",
    "placement": "How images sit in layouts: centered, asymmetric, overlapping.",
    "constraints": [
      "Image constraint 1",
      "Image constraint 2"
    ]
  },

  "rules": {
    "do": [
      "DO rule 1 — add brand-specific positive constraints",
      "DO rule 2"
    ],
    "dont": [
      "DON'T rule 1 — add brand-specific prohibitions",
      "DON'T rule 2"
    ]
  },

  "cssCustomProperties": {
    "description": "Complete :root block ready to copy into any CSS file.",
    ":root": {
      "--color-canvas": "",
      "--color-ink": "",
      "--color-ink-pure": "",
      "--color-bark": "",
      "--color-ink-secondary": "",
      "--color-border": "",
      "--color-accent": "",
      "--color-accent-support": "",
      "--color-pollen": "",
      "--color-success": "",
      "--color-warning": "",
      "--color-error": "",
      "--font-display": "",
      "--font-ui": "",
      "--font-caption": "",
      "--text-caption": "",
      "--text-body-sm": "",
      "--text-body": "",
      "--text-body-lg": "",
      "--text-body-xl": "",
      "--text-subheading": "",
      "--text-heading-sm": "",
      "--text-heading": "",
      "--text-heading-lg": "",
      "--text-heading-xl": "",
      "--text-display": "",
      "--text-display-lg": "",
      "--radius-card": "",
      "--radius-button": "",
      "--radius-pill": "",
      "--radius-form": "",
      "--radius-calendar": "",
      "--radius-tag": "",
      "--radius-chart": "",
      "--shadow-cta": "",
      "--section-gap": "",
      "--card-padding": "",
      "--element-gap": "",
      "--page-max-width": "",
      "--content-max-width": ""
    }
  },

  "promptExamples": [],

  "adaptationGuide": {
    "description": "How to adapt this template for a different brand while keeping the same structure.",
    "steps": [
      "1. Change meta.name and meta.description to your brand.",
      "2. Replace all color hex values. Keep the same number of tokens and the same semantic roles (canvas, ink, accent, etc).",
      "3. Replace font families. Keep the 4-tier structure: display-primary, display-secondary, ui, caption.",
      "4. Adjust the type scale sizes to match your brand's proportions. Keep the line-height + letter-spacing per size.",
      "5. Adjust spacing scale if your brand is more compact or more airy.",
      "6. Adjust radius values per element type.",
      "7. Rewrite shadows to use your brand's accent colors tinted.",
      "8. Keep ALL component CSS structures — just change colors and fonts to your tokens.",
      "9. Rewrite do/don't rules for your brand's constraints.",
      "10. Rewrite prompt examples with your brand's name and scenarios.",
      "11. Update CSS custom properties block.",
      "12. Change imagery rules to match your photography style."
    ],
    "nonNegotiableStructure": [
      "The JSON structure (meta → color → typography → spacing → radius → shadows → surfaces → layout → components → decoration → imagery → rules → cssCustomProperties → promptExamples) MUST be preserved.",
      "Every component must include its CSS definition.",
      "Every color must include role, description, and constraints.",
      "Type scale must include line-height and letter-spacing per size.",
      "Do/don't rules must be explicit and enforceable."
    ]
  }
}
`;
