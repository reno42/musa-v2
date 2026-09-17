/**
 * inkAudit — auditoría de tinta sobre las separaciones C/M/Y/K (paridad con
 * la mitad inspectora del Ink Manager de Illustrator): cobertura por placa,
 * TAC (Total Area Coverage = suma de las 4 tintas) y % de píxeles que
 * superan el límite del perfil.
 *
 * Los planos vienen del worker Ghostscript a dpi de preview; los PORCENTAJES
 * son invariantes a la escala, así que la auditoría sirve aunque el render
 * sea de 900px. El límite de TAC es propiedad del perfil ICC:
 * ISOcoated_v2_300 (FOGRA39) limita en 300% por construcción, FOGRA29
 * (uncoated) en 300%, GRACoL2013 (CRPC7) en 320%.
 */
import type { SeparationsResult } from "./printProtocol.ts";

/** Límite de tinta total (TAC) por perfil, en % de cobertura. */
export const TAC_LIMITS: Record<string, number> = {
  fogra39: 300,
  iso_uncoated: 300,
  gracol2013: 320,
};

export function tacLimitFor(profileId: string): number {
  return TAC_LIMITS[profileId] ?? 300;
}

export interface PlateStat {
  /** Cobertura máxima de la placa, 0–100%. */
  maxPct: number;
  /** Cobertura media de la placa, 0–100%. */
  avgPct: number;
}

export interface InkAudit {
  width: number;
  height: number;
  limitPct: number;
  /** TAC del píxel más cargado, 0–400%. */
  maxTacPct: number;
  avgTacPct: number;
  /** Fracción de píxeles cuyo TAC supera el límite, 0–100%. */
  overLimitPct: number;
  plates: { c: PlateStat; m: PlateStat; y: PlateStat; k: PlateStat };
}

const PCT = 100 / 255;

/** Audita un resultado de separaciones contra un límite de TAC. */
export function auditInk(res: SeparationsResult, limitPct: number): InkAudit {
  const n = res.width * res.height;
  const c = new Uint8Array(res.plates.c);
  const m = new Uint8Array(res.plates.m);
  const y = new Uint8Array(res.plates.y);
  const k = new Uint8Array(res.plates.k);

  let sumTac = 0;
  let maxTac = 0;
  let overCount = 0;
  const plateMax = { c: 0, m: 0, y: 0, k: 0 };
  const plateSum = { c: 0, m: 0, y: 0, k: 0 };
  const limitByte = limitPct / PCT; // tac en bytes (c+m+y+k) equivalente al límite %

  for (let i = 0; i < n; i++) {
    const cv = c[i], mv = m[i], yv = y[i], kv = k[i];
    plateMax.c = Math.max(plateMax.c, cv); plateSum.c += cv;
    plateMax.m = Math.max(plateMax.m, mv); plateSum.m += mv;
    plateMax.y = Math.max(plateMax.y, yv); plateSum.y += yv;
    plateMax.k = Math.max(plateMax.k, kv); plateSum.k += kv;
    const tac = cv + mv + yv + kv;
    sumTac += tac;
    if (tac > maxTac) maxTac = tac;
    if (tac > limitByte) overCount++;
  }

  const stat = (max: number, sum: number): PlateStat => ({
    maxPct: max * PCT,
    avgPct: n > 0 ? (sum / n) * PCT : 0,
  });

  return {
    width: res.width,
    height: res.height,
    limitPct,
    maxTacPct: maxTac * PCT,
    avgTacPct: n > 0 ? (sumTac / n) * PCT : 0,
    overLimitPct: n > 0 ? (overCount / n) * 100 : 0,
    plates: {
      c: stat(plateMax.c, plateSum.c),
      m: stat(plateMax.m, plateSum.m),
      y: stat(plateMax.y, plateSum.y),
      k: stat(plateMax.k, plateSum.k),
    },
  };
}
