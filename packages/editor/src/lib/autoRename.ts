// autoRename.ts — Auto-naming utility for batch design
// Ported from Batch-a-mator Figma plugin
// Groups frames by Y-axis proximity, sorts by X, renames layers

import * as fabric from "fabric";

export interface RenameGroup {
  /** The canvas objects in this row/group */
  objects: fabric.FabricObject[];
  /** Row Y position (average) */
  y: number;
}

/** Group objects by Y-axis proximity into rows */
export function groupByRows(
  objects: fabric.FabricObject[],
  threshold = 200,
): RenameGroup[] {
  const sorted = [...objects].sort((a, b) => (a.top || 0) - (b.top || 0));
  const rows: RenameGroup[] = [];
  let currentRow: fabric.FabricObject[] = [];
  let currentY = sorted[0]?.top || 0;

  for (const obj of sorted) {
    const objY = obj.top || 0;
    if (Math.abs(objY - currentY) > threshold) {
      if (currentRow.length > 0) {
        rows.push({ objects: currentRow, y: currentY });
      }
      currentRow = [];
      currentY = objY;
    }
    currentRow.push(obj);
  }
  if (currentRow.length > 0) {
    rows.push({ objects: currentRow, y: currentY });
  }

  // Sort each row by X (left to right)
  for (const row of rows) {
    row.objects.sort((a, b) => (a.left || 0) - (b.left || 0));
  }

  return rows;
}

/** Get all text objects within a group, sorted top-to-bottom, left-to-right */
export function getTextsInGroup(group: fabric.Group): fabric.FabricObject[] {
  const texts = (group._objects || []) as fabric.FabricObject[];
  return texts
    .filter((o) => {
      const t = o.type || "";
      return t === "text" || t === "textbox" || t === "i-text";
    })
    .sort((a, b) => {
      const ay = a.top || 0, by = b.top || 0;
      if (Math.abs(ay - by) > 20) return ay - by;
      return (a.left || 0) - (b.left || 0);
    });
}

/** Auto-rename frames and their text layers for batch processing.
 *  Mode: "unico" → #Unico1, #Unico2… / "variable" → #Variable1, #Variable2… / "carrusel" → #Carrusel1, #Carrusel2…
 */
export function autoRenameObjects(
  groups: fabric.Group[],
  mode: "unico" | "variable" | "carrusel",
): void {
  if (groups.length === 0) return;

  // Group groups by Y rows
  const groupObjects = groups as unknown as fabric.FabricObject[];
  const rows = groupByRows(groupObjects, 300);

  let carruselIndex = 1;
  let plantillaIndex = 1;
  let postIndex = 1;

  for (const row of rows) {
    let slideIndex = 1;

    for (const obj of row.objects) {
      const group = obj as unknown as fabric.Group;

      // Rename the frame/group
      if (mode === "carrusel") {
        (group as any).layerName = `Carrusel_${carruselIndex}_Slide_${slideIndex}`;
      } else if (mode === "variable") {
        (group as any).layerName = `Plantilla_${plantillaIndex}`;
      } else if (mode === "unico") {
        (group as any).layerName = `PostTemplate_${postIndex}`;
      }

      // Rename internal text layers
      const texts = getTextsInGroup(group);
      let textIndex = 1;
      for (const t of texts) {
        const prefix = mode === "carrusel" ? "Carrusel" : mode === "variable" ? "Variable" : "Unico";
        (t as any).layerName = `#${prefix}${textIndex}`;
        textIndex++;
      }

      slideIndex++;
      plantillaIndex++;
      postIndex++;
    }
    carruselIndex++;
  }
}

/** Find all groups on the canvas */
export function findAllGroups(canvas: fabric.Canvas): fabric.Group[] {
  return canvas.getObjects().filter((o) => o.type === "group") as fabric.Group[];
}

/** Find a group by its layer name */
export function findGroupByName(
  canvas: fabric.Canvas,
  name: string,
): fabric.Group | null {
  const found = canvas.getObjects().find(
    (o) => o.type === "group" && (o as any).layerName === name,
  );
  return (found as fabric.Group) || null;
}

/** Get the column names from a template group (text layer names without #) */
export function getTemplateColumns(group: fabric.Group): string[] {
  return getTextsInGroup(group).map(
    (t) => ((t as any).layerName || "").replace(/^#/, ""),
  );
}
