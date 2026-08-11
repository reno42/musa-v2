/**
 * Fonts that are already on the machine.
 *
 * Georgia and Helvetica were missing because they are not Google Fonts and
 * never will be — they ship with the operating system. They need no
 * downloading, no `<link>`, and no network: naming them in `font-family` is
 * enough. Leaving them out of the picker meant the editor could not use the
 * fonts most reliably present on every device it runs on.
 *
 * Each carries a fallback stack, because "installed" is not universal: Helvetica
 * is on macOS and rare on Windows, where Arial is the metric-compatible
 * substitute. The stack is what actually gets written into the design, so a
 * file made on a Mac still renders sensibly on a PC.
 */

export interface SystemFont {
  family: string;
  category: string;
  /** What goes into CSS — the family plus its substitutes. */
  stack: string;
  /** Where it is reliably present, for the picker's own note. */
  availability: string;
}

export const SYSTEM_FONTS: SystemFont[] = [
  { family: "Arial", category: "sans-serif", stack: "Arial, Helvetica, sans-serif", availability: "Windows, macOS, Android" },
  { family: "Helvetica", category: "sans-serif", stack: "Helvetica, Arial, sans-serif", availability: "macOS (Arial en Windows)" },
  { family: "Helvetica Neue", category: "sans-serif", stack: '"Helvetica Neue", Helvetica, Arial, sans-serif', availability: "macOS" },
  { family: "Verdana", category: "sans-serif", stack: "Verdana, Geneva, sans-serif", availability: "Windows, macOS" },
  { family: "Tahoma", category: "sans-serif", stack: "Tahoma, Geneva, sans-serif", availability: "Windows, macOS" },
  { family: "Trebuchet MS", category: "sans-serif", stack: '"Trebuchet MS", Tahoma, sans-serif', availability: "Windows, macOS" },
  { family: "Segoe UI", category: "sans-serif", stack: '"Segoe UI", Tahoma, sans-serif', availability: "Windows" },
  { family: "Impact", category: "display", stack: "Impact, Haettenschweiler, sans-serif", availability: "Windows, macOS" },

  { family: "Georgia", category: "serif", stack: "Georgia, 'Times New Roman', serif", availability: "Windows, macOS" },
  { family: "Times New Roman", category: "serif", stack: "'Times New Roman', Times, serif", availability: "Windows, macOS" },
  { family: "Palatino", category: "serif", stack: "Palatino, 'Palatino Linotype', 'Book Antiqua', serif", availability: "macOS, Windows" },
  { family: "Garamond", category: "serif", stack: "Garamond, 'Times New Roman', serif", availability: "Windows, macOS" },
  { family: "Baskerville", category: "serif", stack: "Baskerville, Georgia, serif", availability: "macOS" },

  { family: "Courier New", category: "monospace", stack: "'Courier New', Courier, monospace", availability: "Windows, macOS" },
  { family: "Menlo", category: "monospace", stack: "Menlo, Monaco, 'Courier New', monospace", availability: "macOS" },
  { family: "Consolas", category: "monospace", stack: "Consolas, 'Courier New', monospace", availability: "Windows" },

  { family: "Comic Sans MS", category: "handwriting", stack: "'Comic Sans MS', cursive", availability: "Windows, macOS" },
  { family: "Brush Script MT", category: "handwriting", stack: "'Brush Script MT', cursive", availability: "macOS, Windows" },
];

/**
 * Fonts people ask for that cannot be shipped, and what to reach for instead.
 *
 * Futura is the one that comes up most. It is licensed — Paratype and Linotype
 * sell it — so it is not on Google Fonts and cannot be bundled here without
 * buying it. These are the free faces closest to it in feel, which is a more
 * useful answer than an empty search result.
 */
export const LICENSED_ALTERNATIVES: Record<string, { note: string; instead: string[] }> = {
  futura: {
    note: "Futura es de pago (Paratype/Linotype), no está en Google Fonts.",
    instead: ["Jost", "Questrial", "Poppins", "Montserrat"],
  },
  helvetica: {
    note: "Helvetica viene con macOS; en Windows se sustituye por Arial.",
    instead: ["Inter", "Roboto", "Arimo"],
  },
  "gotham": {
    note: "Gotham es de pago (Hoefler&Co), no está en Google Fonts.",
    instead: ["Montserrat", "Poppins"],
  },
  "avenir": {
    note: "Avenir es de pago (Linotype), no está en Google Fonts.",
    instead: ["Nunito Sans", "Jost", "Montserrat"],
  },
  "proxima nova": {
    note: "Proxima Nova es de pago (Mark Simonson), no está en Google Fonts.",
    instead: ["Montserrat", "Raleway"],
  },
};
