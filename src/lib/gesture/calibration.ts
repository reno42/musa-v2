/**
 * Calibration profiles for Musa Hands (REQ Gesture Mode §6 calibration.ts,
 * wizard §10-r4). The wizard teaches the 3 base gestures while sampling:
 *   palm open  → max pinch distance (fingers far apart)
 *   pinch hold → max distance while "closed"
 *   stillness  → average hand jitter (drives the One-Euro beta)
 * From those three numbers we derive grab/release thresholds with hysteresis
 * and smoothing strength for THIS user at THIS distance from the camera.
 *
 * Plain erasable TS; storage is injectable so QA can pass a fake.
 */

export interface CalibrationProfile {
  name: string;
  /** Pinch distance (normalized) below which a grab STARTS. */
  pinchGrab: number;
  /** Distance above which the pinch RELEASES (hysteresis > grab). */
  pinchRelease: number;
  /** One-Euro base cutoff — lower = smoother for shaky hands. */
  minCutoff: number;
  /** One-Euro speed coefficient — lower = more lag tolerated. */
  beta: number;
  savedAt: string;
}

export interface CalibrationSamples {
  /** Largest pinch distance seen while holding the palm open. */
  pinchOpen: number;
  /** Largest pinch distance seen while holding the pinch closed. */
  pinchClosed: number;
  /** Mean per-frame wrist jitter (normalized units) while holding still. */
  stillness: number;
}

export const CALIBRATION_STORAGE_KEY = "musa-hands-calibration-v1";
export const CALIBRATION_ACTIVE_KEY = "musa-hands-calibration-active-v1";

export const DEFAULT_CALIBRATION: CalibrationProfile = {
  name: "default",
  pinchGrab: 0.07,
  pinchRelease: 0.115,
  minCutoff: 1.2,
  beta: 0.25,
  savedAt: "",
};

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadCalibration(storage: Storage | null = safeStorage()): CalibrationProfile {
  if (!storage) return { ...DEFAULT_CALIBRATION };
  try {
    const activeName = storage.getItem(CALIBRATION_ACTIVE_KEY) || "default";
    const raw = storage.getItem(`${CALIBRATION_STORAGE_KEY}:${activeName}`);
    if (!raw) return { ...DEFAULT_CALIBRATION };
    const parsed = JSON.parse(raw) as Partial<CalibrationProfile>;
    return {
      name: activeName,
      pinchGrab: Number(parsed.pinchGrab) || DEFAULT_CALIBRATION.pinchGrab,
      pinchRelease: Number(parsed.pinchRelease) || DEFAULT_CALIBRATION.pinchRelease,
      minCutoff: Number(parsed.minCutoff) || DEFAULT_CALIBRATION.minCutoff,
      beta: Number(parsed.beta) || DEFAULT_CALIBRATION.beta,
      savedAt: String(parsed.savedAt || ""),
    };
  } catch {
    return { ...DEFAULT_CALIBRATION };
  }
}

export function saveCalibration(profile: CalibrationProfile, storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(`${CALIBRATION_STORAGE_KEY}:${profile.name}`, JSON.stringify(profile));
    storage.setItem(CALIBRATION_ACTIVE_KEY, profile.name);
  } catch {
    // Private mode / quota — calibration works this session only.
  }
}

export function listCalibrationProfiles(storage: Storage | null = safeStorage()): string[] {
  if (!storage) return [];
  const names: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(`${CALIBRATION_STORAGE_KEY}:`)) {
        names.push(key.slice(CALIBRATION_STORAGE_KEY.length + 1));
      }
    }
  } catch {
    return [];
  }
  return names;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Derive the user's profile from wizard samples. The grab threshold sits
 * 35% of the way from "closed" toward "open", release adds hysteresis so a
 * half-open pinch doesn't stutter the drag. Shakier hands (higher stillness)
 * get a tighter cutoff and a smaller beta — smoothing over speed.
 */
export function computeCalibration(name: string, s: CalibrationSamples): CalibrationProfile {
  const span = Math.max(s.pinchOpen - s.pinchClosed, 0.03);
  const pinchGrab = clamp(s.pinchClosed + span * 0.35, 0.025, 0.25);
  const pinchRelease = clamp(pinchGrab + span * 0.3, pinchGrab + 0.015, 0.3);
  const stillness = clamp(s.stillness, 0, 0.05);
  const minCutoff = clamp(1.6 - stillness * 18, 0.6, 1.6);
  const beta = clamp(0.45 - stillness * 6, 0.05, 0.45);
  return { name, pinchGrab, pinchRelease, minCutoff, beta, savedAt: new Date().toISOString() };
}
