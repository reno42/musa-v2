import React from "react";

const defaultSize = 16;

export const Icon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number; color?: string }> = ({ children, size = defaultSize, color = "currentColor", style, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }} {...rest}>
    {children}
  </svg>
);

// ── Close / X ────────────────────────────────────────────
export const IconX = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M18 6L6 18" /><path d="M6 6l12 12" /></Icon>
);

// ── Check / ✓ ────────────────────────────────────────────
export const IconCheck = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M5 13l4 4L19 7" /></Icon>
);

// ── Warning Triangle / ⚠ ─────────────────────────────────
export const IconWarn = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></Icon>
);

// ── Zap / ⚡ ──────────────────────────────────────────────
export const IconZap = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></Icon>
);

// ── Box / 📦 ──────────────────────────────────────────────
export const IconBox = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></Icon>
);

// ── Play / ▶ ──────────────────────────────────────────────
export const IconPlay = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polygon points="5 3 19 12 5 21 5 3" /></Icon>
);

// ── Bot / 🤖 ──────────────────────────────────────────────
export const IconBot = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16.01" /><line x1="16" y1="16" x2="16" y2="16.01" /></Icon>
);

// ── Clock / 🕐 ────────────────────────────────────────────
export const IconClock = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></Icon>
);

// ── DNA / 🧬 ──────────────────────────────────────────────
export const IconDna = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M4 22h2c2 0 4-2 4-5s-2-5-4-5H4" /><path d="M20 2h-2c-2 0-4 2-4 5s2 5 4 5h2" /><path d="M10 2h4" /><path d="M10 12h4" /><path d="M10 22h4" /></Icon>
);

// ── Sparkle / ✨ ──────────────────────────────────────────
export const IconSparkle = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" /><path d="M18 16l.75 2.75L21.5 19.5l-2.75.75L18 23l-.75-2.75L14.5 19.5l2.75-.75z" /></Icon>
);

// ── Palette / 🎨 ──────────────────────────────────────────
export const IconPalette = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M12 2a10 10 0 100 20c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16a6 6 0 006-6c0-5-4.48-9-10-9z" /><circle cx="7.5" cy="11.5" r="1.5" /><circle cx="12" cy="7.5" r="1.5" /><circle cx="16.5" cy="11.5" r="1.5" /></Icon>
);

// ── Search / 🔍 ───────────────────────────────────────────
export const IconSearch = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Icon>
);

// ── Target / 🎯 ───────────────────────────────────────────
export const IconTarget = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></Icon>
);

// ── Masks / 🎭 ────────────────────────────────────────────
export const IconMasks = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></Icon>
);

// ── Bar Chart / 📊 ────────────────────────────────────────
export const IconBarChart = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></Icon>
);

// ── Lightbulb / 💡 ────────────────────────────────────────
export const IconBulb = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M9 18h6" /><path d="M10 22h4" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14" /></Icon>
);

// ── Microscope / 🔬 ───────────────────────────────────────
export const IconMicroscope = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M6 22h12" /><path d="M6 18h12" /><path d="M17 2l-6 4v14" /><path d="M11 6l6-4" /><path d="M17 14a4 4 0 100-8 4 4 0 000 8z" /></Icon>
);

// ── Link / 🔗 ─────────────────────────────────────────────
export const IconLink = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></Icon>
);

// ── Edit / 📝 ─────────────────────────────────────────────
export const IconEdit = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></Icon>
);

// ── File / 📄 ─────────────────────────────────────────────
export const IconFile = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></Icon>
);

// ── Folder / 📁 ───────────────────────────────────────────
export const IconFolder = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></Icon>
);

// ── Eye / 👁 ──────────────────────────────────────────────
export const IconEye = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></Icon>
);

// ── Lock / 🔒 ─────────────────────────────────────────────
export const IconLock = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></Icon>
);

// ── Scissors / ✂ ──────────────────────────────────────────
export const IconScissors = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><circle cx="6" cy="6" r="3" /><path d="M8.12 8.12L12 12" /><path d="M20 4L8.12 15.88" /><circle cx="6" cy="18" r="3" /><path d="M14.8 14.8L20 20" /></Icon>
);

// ── Ghost / 👻 ────────────────────────────────────────────
export const IconGhost = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M9 10h.01" /><path d="M15 10h.01" /><path d="M12 2a8 8 0 00-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 00-8-8z" /></Icon>
);

// ── User / 👤 ─────────────────────────────────────────────
export const IconUser = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></Icon>
);

// ── Settings / ⚙️ ─────────────────────────────────────────
export const IconSettings = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></Icon>
);

// ── Image / 🖼 ────────────────────────────────────────────
export const IconImage = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></Icon>
);

// ── Video / 🎬 ────────────────────────────────────────────
export const IconVideo = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></Icon>
);

// ── Music / 🎵 ────────────────────────────────────────────
export const IconMusic = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></Icon>
);

// ── Share / 🐦 ────────────────────────────────────────────
export const IconShare = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></Icon>
);

// ── Monitor / 💻 ──────────────────────────────────────────
export const IconMonitor = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></Icon>
);

// ── Layout / 📑 ───────────────────────────────────────────
export const IconLayout = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" /></Icon>
);

// ── Chat / 💬 ─────────────────────────────────────────────
export const IconChat = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></Icon>
);

// ── Clipboard / 📋 ────────────────────────────────────────
export const IconClipboard = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" /></Icon>
);

// ── Sliders / ⚙️ ──────────────────────────────────────────
export const IconSliders = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></Icon>
);

// ── Circle (filled) / ● ───────────────────────────────────
export const IconCircle: React.FC<React.SVGProps<SVGSVGElement> & { size?: number; color?: string }> = ({ size = defaultSize, color = "currentColor", style, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ flexShrink: 0, ...style }} {...rest}>
    <circle cx="12" cy="12" r="8" />
  </svg>
);

// ── Newspaper / 📰 ────────────────────────────────────────
export const IconNewspaper = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2" /><path d="M18 14l-4-6h8l-4 6z" /><path d="M8 10h2" /><path d="M8 14h2" /><path d="M8 18h6" /></Icon>
);

// ── Type / 📝 ─────────────────────────────────────────────
export const IconType = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></Icon>
);

// ── Code / </> ────────────────────────────────────────────
export const IconCode = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></Icon>
);

// ── Grid / 📐 ─────────────────────────────────────────────
export const IconGrid = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></Icon>
);

// ── Columns / ▐▌ ───────────────────────────────────────────
export const IconColumns = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><rect x="3" y="3" width="7" height="18" rx="1" /><rect x="14" y="3" width="7" height="18" rx="1" /></Icon>
);

// ── Ruler / 📏 ────────────────────────────────────────────
export const IconRuler = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M21.3 8.7L8.7 21.3c-1 1-2.6 1-3.5 0l-2.6-2.6c-1-1-1-2.6 0-3.5L15.3 2.6c1-1 2.6-1 3.5 0l2.6 2.6c.9 1 .9 2.5-.1 3.5z" /><path d="M7.5 10.5l2 2" /><path d="M10.5 7.5l2 2" /><path d="M13.5 4.5l2 2" /><path d="M4.5 13.5l2 2" /></Icon>
);

// ── Bricks / 🧱 ───────────────────────────────────────────
export const IconBricks = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" /><rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" /></Icon>
);

// ── Arrow Left / ← ────────────────────────────────────────
export const IconArrowLeft = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></Icon>
);

// ── Plus ──────────────────────────────────────────────────
export const IconPlus = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>
);

// ── Trash ─────────────────────────────────────────────────
export const IconTrash = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></Icon>
);

// ── Align Left ───────────────────────────────────────────
export const IconAlignLeft = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" /></Icon>
);

// ── Align Center ─────────────────────────────────────────
export const IconAlignCenter = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><line x1="3" y1="6" x2="21" y2="6" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></Icon>
);

// ── Align Right ──────────────────────────────────────────
export const IconAlignRight = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><line x1="3" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="6" y1="18" x2="21" y2="18" /></Icon>
);

// ── Pen (Bezier) ─────────────────────────────────────────
export const IconPen = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></Icon>
);

// ── Rectangle ────────────────────────────────────────────
export const IconRectangle = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></Icon>
);

// ── Circle (outline) ─────────────────────────────────────
export const IconCircleOutline = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /></Icon>
);

// ── Triangle ────────────────────────────────────────────
export const IconTriangle = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polygon points="12,3 22,21 2,21" /></Icon>
);

// ── Star ────────────────────────────────────────────────
export const IconStar = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polygon points="12,2 15,9 22,9 16,14 18,21 12,17 6,21 8,14 2,9 9,9" /></Icon>
);

// ── Hexagon / Polygon ────────────────────────────────────
export const IconHexagon = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polygon points="21,16 12,21 3,16 3,8 12,3 21,8" /></Icon>
);

// ── Flex Row ─────────────────────────────────────────────
export const IconFlexRow = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><rect x="3" y="3" width="5" height="18" rx="1" /><rect x="10" y="3" width="5" height="18" rx="1" /><rect x="17" y="3" width="5" height="18" rx="1" /></Icon>
);

// ── Flex Column ──────────────────────────────────────────
export const IconFlexCol = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><rect x="3" y="3" width="18" height="5" rx="1" /><rect x="3" y="10" width="18" height="5" rx="1" /><rect x="3" y="17" width="18" height="5" rx="1" /></Icon>
);

// ── Chevron Down ─────────────────────────────────────────
export const IconChevronDown = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polyline points="6 9 12 15 18 9" /></Icon>
);

// ── Chevron Left ─────────────────────────────────────────
export const IconChevronLeft = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polyline points="15 18 9 12 15 6" /></Icon>
);

// ── Chevron Right ────────────────────────────────────────
export const IconChevronRight = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polyline points="9 6 15 12 9 18" /></Icon>
);

// ── Eye Off ──────────────────────────────────────────────
export const IconEyeOff = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" /><path d="M14.12 14.12a3 3 0 11-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></Icon>
);

// ── Copy (duplicate) ─────────────────────────────────────
export const IconCopy = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></Icon>
);

// ── Frame (artboard) ─────────────────────────────────────
export const IconFrame = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="3" y2="3" /><line x1="9" y1="3" x2="3" y2="3" /><line x1="21" y1="9" x2="21" y2="3" /><line x1="15" y1="3" x2="21" y2="3" /><line x1="3" y1="15" x2="3" y2="21" /><line x1="9" y1="21" x2="3" y2="21" /><line x1="21" y1="15" x2="21" y2="21" /><line x1="15" y1="21" x2="21" y2="21" /></Icon>
);

// ── Move (4-way arrows) ──────────────────────────────────
export const IconMove = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polyline points="5 9 2 12 5 15" /><polyline points="9 5 12 2 15 5" /><polyline points="15 19 12 22 9 19" /><polyline points="19 9 22 12 19 15" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" /></Icon>
);

// ── Tag ──────────────────────────────────────────────────
export const IconTag = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></Icon>
);

// ── MousePointer ─────────────────────────────────────────
export const IconPointer = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /><path d="M13 13l6 6" /></Icon>
);

// ── Hand (grab) ──────────────────────────────────────────
export const IconHand = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M18 11V6a2 2 0 00-4 0v1" /><path d="M14 10V4a2 2 0 00-4 0v2" /><path d="M10 10.5V6a2 2 0 00-4 0v8" /><path d="M18 8a2 2 0 014 0v7a8 8 0 01-8 8h-2c-2.83 0-3.5-.95-5.17-2.7L4.41 17.3a2 2 0 01.76-3.14L8 13" /></Icon>
);

// ── Zoom In ──────────────────────────────────────────────
export const IconZoomIn = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></Icon>
);

// ── Zoom Out ─────────────────────────────────────────────
export const IconZoomOut = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></Icon>
);

// ── Download ─────────────────────────────────────────────
export const IconDownload = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></Icon>
);

// ── Maximize (fit to view) ───────────────────────────────
export const IconMaximize = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" /></Icon>
);

// ── History (clock-back) ──────────────────────────────────
export const IconHistory = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></Icon>
);

// ── Wand (magic/AI) ───────────────────────────────────────
export const IconWand = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" /><path d="M17.8 11.8L19 13" /><path d="M15 9h.01" /><path d="M17.8 6.2L19 5" /><path d="M3 21l9-9" /><path d="M12.2 6.2L11 5" /></Icon>
);

// ── Refresh (circular arrows) ─────────────────────────────
export const IconRefresh = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></Icon>
);

// ── Upload ────────────────────────────────────────────────
export const IconUpload = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></Icon>
);

// ── Pen Plus (add point to segment) ───────────────────────
export const IconPenPlus = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /><line x1="12" y1="5" x2="12" y2="11" /><line x1="9" y1="8" x2="15" y2="8" /></Icon>
);

// ── Pen Minus (remove point) ──────────────────────────────
export const IconPenMinus = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /><line x1="9" y1="8" x2="15" y2="8" /></Icon>
);

// ── Pen Edit (convert / show handles) ─────────────────────
export const IconPenEdit = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /><circle cx="6" cy="6" r="2" /><line x1="6" y1="4" x2="6" y2="2" /><line x1="6" y1="8" x2="6" y2="10" /><line x1="4" y1="6" x2="2" y2="6" /><line x1="8" y1="6" x2="10" y2="6" /></Icon>
);

// ── Pencil (freehand draw) ────────────────────────────────
export const IconPencil = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><circle cx="11" cy="11" r="1" /></Icon>
);

// ── Text on Path ──────────────────────────────────────────
export const IconTextPath = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}>
    <path d="M4 19c0-4.418 3.582-8 8-8s8 3.582 8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M9 4v6M15 4v6M7 4h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </Icon>
);

// ── Shapes (circle + square + triangle) ───────────────────
export const IconShapes = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}>
    <circle cx="8.5" cy="8.5" r="4.5" />
    <rect x="12.5" y="12.5" width="8" height="8" rx="1" />
    <path d="M6 21l4-7 4 7z" />
  </Icon>
);

// ── Eraser ──────────────────────────────────────────────
export const IconEraser = (p: React.ComponentProps<typeof Icon>) => (
  <Icon {...p}>
    <path d="M20 20H9L4.6 15.6a2 2 0 010-2.8l8.6-8.6a2 2 0 012.8 0l5.4 5.4a2 2 0 010 2.8L15 19" />
    <path d="M9 20l-4-4" />
  </Icon>
);
