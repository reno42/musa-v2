/**
 * Smart Guides calculation — Figma-style alignment and spacing detection.
 *
 * Given a dragging element's bounds and other elements' bounds, returns
 * alignment guides (edges + centers match) and equal-spacing indicators.
 */

import type { SmartGuide } from "../components/CanvasGuides";

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SNAP_THRESHOLD = 4; // px in canvas space

/**
 * Calculate alignment guides between a dragged element and a set of other elements.
 * Checks: left edge, center X, right edge (vertical guides)
 *         top edge, center Y, bottom edge (horizontal guides)
 */
export function computeAlignmentGuides(
  dragBounds: ElementBounds,
  otherBounds: ElementBounds[],
): SmartGuide[] {
  const guides: SmartGuide[] = [];
  const dragLeft = dragBounds.x;
  const dragRight = dragBounds.x + dragBounds.width;
  const dragCenterX = dragBounds.x + dragBounds.width / 2;
  const dragTop = dragBounds.y;
  const dragBottom = dragBounds.y + dragBounds.height;
  const dragCenterY = dragBounds.y + dragBounds.height / 2;

  for (const other of otherBounds) {
    const oLeft = other.x;
    const oRight = other.x + other.width;
    const oCenterX = other.x + other.width / 2;
    const oTop = other.y;
    const oBottom = other.y + other.height;
    const oCenterY = other.y + other.height / 2;

    // ── Vertical alignment guides (matching X positions) ──
    const xChecks: Array<[number, number, string]> = [
      [dragLeft, oLeft, "left"],
      [dragRight, oRight, "right"],
      [dragCenterX, oCenterX, "center"],
      [dragLeft, oRight, "left-right"],
      [dragRight, oLeft, "right-left"],
    ];
    for (const [dPos, oPos] of xChecks) {
      if (Math.abs(dPos - oPos) < SNAP_THRESHOLD) {
        const startY = Math.min(dragBounds.y, other.y);
        const endY = Math.max(dragBounds.y + dragBounds.height, other.y + other.height);
        guides.push({
          type: "align",
          orientation: "v",
          position: oPos,
          start: startY,
          length: endY - startY,
        });
      }
    }

    // ── Horizontal alignment guides (matching Y positions) ──
    const yChecks: Array<[number, number, string]> = [
      [dragTop, oTop, "top"],
      [dragBottom, oBottom, "bottom"],
      [dragCenterY, oCenterY, "center"],
      [dragTop, oBottom, "top-bottom"],
      [dragBottom, oTop, "bottom-top"],
    ];
    for (const [dPos, oPos] of yChecks) {
      if (Math.abs(dPos - oPos) < SNAP_THRESHOLD) {
        const startX = Math.min(dragBounds.x, other.x);
        const endX = Math.max(dragBounds.x + dragBounds.width, other.x + other.width);
        guides.push({
          type: "align",
          orientation: "h",
          position: oPos,
          start: startX,
          length: endX - startX,
        });
      }
    }
  }

  return guides;
}

/**
 * Calculate equal-spacing indicators.
 * For each pair of sibling elements in the same row (or column), check if
 * the gap between them equals the gap in another pair → show spacing label.
 */
export function computeSpacingGuides(
  dragBounds: ElementBounds,
  otherBounds: ElementBounds[],
): SmartGuide[] {
  const guides: SmartGuide[] = [];
  if (otherBounds.length < 1) return guides;

  // ── Horizontal spacing (elements roughly in the same row) ──
  const sameRowThreshold = 10;
  const rowSiblings = otherBounds.filter(b =>
    Math.abs(b.y - dragBounds.y) < sameRowThreshold ||
    Math.abs(b.y + b.height - dragBounds.y - dragBounds.height) < sameRowThreshold ||
    Math.abs((b.y + b.height / 2) - (dragBounds.y + dragBounds.height / 2)) < sameRowThreshold
  );

  for (const sib of rowSiblings) {
    // Distance from drag to sib
    let gap: number;
    let startX: number, endX: number;
    if (dragBounds.x + dragBounds.width <= sib.x) {
      gap = sib.x - (dragBounds.x + dragBounds.width);
      startX = dragBounds.x + dragBounds.width;
      endX = sib.x;
    } else if (sib.x + sib.width <= dragBounds.x) {
      gap = dragBounds.x - (sib.x + sib.width);
      startX = sib.x + sib.width;
      endX = dragBounds.x;
    } else continue;

    // Check if any OTHER sibling has the same gap
    for (const sib2 of rowSiblings) {
      if (sib2 === sib) continue;
      let gap2: number;
      if (dragBounds.x + dragBounds.width <= sib2.x) {
        gap2 = sib2.x - (dragBounds.x + dragBounds.width);
      } else if (sib2.x + sib2.width <= dragBounds.x) {
        gap2 = dragBounds.x - (sib2.x + sib2.width);
      } else continue;

      if (Math.abs(gap - gap2) < 2) {
        // Equal spacing found!
        const y = Math.max(dragBounds.y, sib.y) + Math.min(dragBounds.height, sib.height) / 2;
        guides.push({
          type: "spacing",
          orientation: "h",
          position: y,
          start: startX,
          length: endX - startX,
          label: `${Math.round(gap)}`,
        });
        break;
      }
    }
  }

  // ── Vertical spacing (elements roughly in the same column) ──
  const colSiblings = otherBounds.filter(b =>
    Math.abs(b.x - dragBounds.x) < sameRowThreshold ||
    Math.abs(b.x + b.width - dragBounds.x - dragBounds.width) < sameRowThreshold ||
    Math.abs((b.x + b.width / 2) - (dragBounds.x + dragBounds.width / 2)) < sameRowThreshold
  );

  for (const sib of colSiblings) {
    let gap: number;
    let startY: number, endY: number;
    if (dragBounds.y + dragBounds.height <= sib.y) {
      gap = sib.y - (dragBounds.y + dragBounds.height);
      startY = dragBounds.y + dragBounds.height;
      endY = sib.y;
    } else if (sib.y + sib.height <= dragBounds.y) {
      gap = dragBounds.y - (sib.y + sib.height);
      startY = sib.y + sib.height;
      endY = dragBounds.y;
    } else continue;

    for (const sib2 of colSiblings) {
      if (sib2 === sib) continue;
      let gap2: number;
      if (dragBounds.y + dragBounds.height <= sib2.y) {
        gap2 = sib2.y - (dragBounds.y + dragBounds.height);
      } else if (sib2.y + sib2.height <= dragBounds.y) {
        gap2 = dragBounds.y - (sib2.y + sib2.height);
      } else continue;

      if (Math.abs(gap - gap2) < 2) {
        const x = Math.max(dragBounds.x, sib.x) + Math.min(dragBounds.width, sib.width) / 2;
        guides.push({
          type: "spacing",
          orientation: "v",
          position: x,
          start: startY,
          length: endY - startY,
          label: `${Math.round(gap)}`,
        });
        break;
      }
    }
  }

  return guides;
}

/**
 * Snap a position to the nearest guide within threshold.
 */
export function snapToGuides(
  pos: number,
  guidePositions: number[],
  threshold = SNAP_THRESHOLD,
): number {
  let snapped = pos;
  let minDist = threshold;
  for (const g of guidePositions) {
    const dist = Math.abs(pos - g);
    if (dist < minDist) {
      minDist = dist;
      snapped = g;
    }
  }
  return snapped;
}
