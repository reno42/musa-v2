// batchEngine.ts — Batch design engine
// Clones templates and fills text from CSV data
// Ported from Batch-a-mator Figma plugin — adapted for Fabric.js

import * as fabric from "fabric";
import { getTextsInGroup, findGroupByName } from "./autoRename";

const uidCounters: Record<string, number> = {};
function uidSep(p = "n"): string {
  uidCounters[p] = (uidCounters[p] || 0) + 1;
  return `${p}_${Date.now()}_${uidCounters[p]}`;
}

export interface BatchResult {
  totalRows: number;
  generated: number;
  skipped: number;
  errors: string[];
}

/** Serialize a group for cloning, preserving custom properties */
const cloneKeys = [
  "layerId", "layerName", "frameId", "isClosedPath",
  "imageFilters", "styleId", "componentId", "isComponentInstance",
];

/**
 * MODE 1: Single Post
 * Clone a single template for each CSV row, filling matching columns.
 */
export async function batchSinglePost(
  canvas: fabric.Canvas,
  template: fabric.Group,
  rows: Record<string, string>[],
  gap = 100,
): Promise<BatchResult> {
  const result: BatchResult = { totalRows: rows.length, generated: 0, skipped: 0, errors: [] };
  if (rows.length === 0) return result;
  if (!template) { result.errors.push("No template selected"); return result; }

  const templateHeight = (template as any).height || 200;
  let startY = (template.top || 0) + templateHeight + gap;
  const promises: Promise<void>[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const serialized = (template.toObject as any)(cloneKeys);
      const p = fabric.util.enlivenObjects([serialized]).then(([clone]: any[]) => {
        if (!clone) { result.errors.push(`Row ${i + 1}: clone failed`); result.skipped++; return; }
        (clone as any).layerId = uidSep("layer");
        clone.set({ left: template.left || 100, top: startY });
        (clone as any).layerName = `${(template as any).layerName || "Post"} - ${i + 1}`;

        const texts = getTextsInGroup(clone as fabric.Group);
        for (const t of texts) {
          (t as any).layerId = uidSep("layer");
          const colName = ((t as any).layerName || "").replace("#", "");
          if (row[colName] !== undefined && row[colName] !== "") {
            try { (t as fabric.IText).set("text", row[colName]); } catch {}
          }
        }

        canvas.add(clone);
        result.generated++;
      }).catch((err) => {
        result.errors.push(`Row ${i + 1}: ${(err as Error).message}`);
        result.skipped++;
      });

      promises.push(p);
      startY += templateHeight + gap;
    } catch (err) {
      result.errors.push(`Row ${i + 1}: ${(err as Error).message}`);
      result.skipped++;
    }
  }

  await Promise.all(promises);
  canvas.renderAll();
  return result;
}

/**
 * MODE 2: Multi Posts
 * CSV has a "Plantilla" column → find each template by name → clone → fill.
 */
export async function batchMultiPosts(
  canvas: fabric.Canvas,
  rows: Record<string, string>[],
  gap = 100,
): Promise<BatchResult> {
  const result: BatchResult = { totalRows: rows.length, generated: 0, skipped: 0, errors: [] };

  let startY = 0;
  let startX = 100;
  const allObjs = canvas.getObjects();
  if (allObjs.length > 0) {
    const last = allObjs[allObjs.length - 1];
    startY = (last.top || 0) + ((last as any).height || 200) + gap;
    startX = last.left || 100;
  }

  const promises: Promise<void>[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const templateName = row["Plantilla"];
    if (!templateName) { result.skipped++; continue; }

    const tpl = findGroupByName(canvas, templateName);
    if (!tpl) {
      result.errors.push(`Row ${i + 1}: template "${templateName}" not found`);
      result.skipped++;
      continue;
    }

    try {
      const serialized = (tpl.toObject as any)(cloneKeys);
      const p = fabric.util.enlivenObjects([serialized]).then(([clone]: any[]) => {
        if (!clone) { result.errors.push(`Row ${i + 1}: clone failed`); result.skipped++; return; }
        (clone as any).layerId = uidSep("layer");
        clone.set({ left: startX, top: startY });
        (clone as any).layerName = `${templateName} - Gen ${i + 1}`;
        startY += ((clone as any).height || 200) + gap;

        const texts = getTextsInGroup(clone as fabric.Group);
        for (const t of texts) {
          (t as any).layerId = uidSep("layer");
          const colName = ((t as any).layerName || "").replace("#", "");
          if (row[colName] !== undefined && row[colName] !== "") {
            try { (t as fabric.IText).set("text", row[colName]); } catch {}
          }
        }

        canvas.add(clone);
        result.generated++;
      }).catch((err) => {
        result.errors.push(`Row ${i + 1}: ${(err as Error).message}`);
        result.skipped++;
      });

      promises.push(p);
    } catch (err) {
      result.errors.push(`Row ${i + 1}: ${(err as Error).message}`);
      result.skipped++;
    }
  }

  await Promise.all(promises);
  canvas.renderAll();
  return result;
}

/**
 * MODE 3: Carousels
 * CSV has "ID_Carrusel" + "Plantilla_Slide" → group by ID → place slides side-by-side.
 */
export async function batchCarousels(
  canvas: fabric.Canvas,
  rows: Record<string, string>[],
  gapX = 50,
  gapY = 200,
): Promise<BatchResult> {
  const result: BatchResult = { totalRows: rows.length, generated: 0, skipped: 0, errors: [] };

  // Group by ID_Carrusel
  const carruseles: Record<string, Record<string, string>[]> = {};
  for (const row of rows) {
    const id = row["ID_Carrusel"];
    if (!id) { result.skipped++; continue; }
    if (!carruseles[id]) carruseles[id] = [];
    carruseles[id].push(row);
  }

  let currentY = 0;
  const allObjs = canvas.getObjects();
  if (allObjs.length > 0) {
    const last = allObjs[allObjs.length - 1];
    currentY = (last.top || 0) + ((last as any).height || 200) + gapY;
  }

  const promises: Promise<void>[] = [];

  for (const carruselId in carruseles) {
    const slides = carruseles[carruselId];
    let currentX = 100;
    let maxHeight = 0;

    for (let i = 0; i < slides.length; i++) {
      const row = slides[i];
      const templateName = row["Plantilla_Slide"];
      if (!templateName) { result.skipped++; continue; }

      const tpl = findGroupByName(canvas, templateName);
      if (!tpl) {
        result.errors.push(`Carrusel ${carruselId} slide ${i + 1}: template "${templateName}" not found`);
        result.skipped++;
        continue;
      }

      try {
        const serialized = (tpl.toObject as any)(cloneKeys);
        const p = fabric.util.enlivenObjects([serialized]).then(([clone]: any[]) => {
          if (!clone) { result.errors.push(`Carrusel ${carruselId}: clone failed`); result.skipped++; return; }
          (clone as any).layerId = uidSep("layer");
          clone.set({ left: currentX, top: currentY });
          (clone as any).layerName = `Gen_Carrusel_${carruselId}_Slide_${i + 1}`;
          currentX += ((clone as any).width || 200) + gapX;
          if (((clone as any).height || 200) > maxHeight) {
            maxHeight = (clone as any).height || 200;
          }

          const texts = getTextsInGroup(clone as fabric.Group);
          for (const t of texts) {
            (t as any).layerId = uidSep("layer");
            const colName = ((t as any).layerName || "").replace("#", "");
            if (row[colName] !== undefined && row[colName] !== "") {
              try { (t as fabric.IText).set("text", row[colName]); } catch {}
            }
          }

          canvas.add(clone);
          result.generated++;
        }).catch((err) => {
          result.errors.push(`Carrusel ${carruselId}: ${(err as Error).message}`);
          result.skipped++;
        });

        promises.push(p);
      } catch (err) {
        result.errors.push(`Carrusel ${carruselId}: ${(err as Error).message}`);
        result.skipped++;
      }
    }
    currentY += maxHeight + gapY;
  }

  await Promise.all(promises);
  canvas.renderAll();
  return result;
}
