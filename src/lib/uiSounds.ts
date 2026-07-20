/**
 * uiSounds — tiny WebAudio-synthesized UI sounds (no audio assets needed).
 * Apple-style feedback for the Storage tab: trash crumple, restore pop,
 * empty-trash rumble. All sounds are generated on the fly and short (<400ms).
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch { return null; }
}

/** White-noise buffer of `seconds` length. */
function noiseBuffer(ac: AudioContext, seconds: number): AudioBuffer {
  const buf = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Paper-crumple + thud: dropping a file into the trash. */
export function playTrashSound() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;

  // Crumple: band-passed noise burst with fast decay
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuffer(ac, 0.25);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(2600, t);
  bp.frequency.exponentialRampToValueAtTime(900, t + 0.22);
  bp.Q.value = 0.9;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.35, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  noise.connect(bp).connect(ng).connect(ac.destination);
  noise.start(t);

  // Thud: low sine hit slightly after
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, t + 0.06);
  osc.frequency.exponentialRampToValueAtTime(55, t + 0.28);
  const og = ac.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.4, t + 0.08);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(og).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.32);
}

/** Bright pop: restoring a file from the trash. */
export function playRestoreSound() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(420, t);
  osc.frequency.exponentialRampToValueAtTime(880, t + 0.12);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.2);
}

/** Deep rumble: emptying the trash / permanent delete. */
export function playEmptyTrashSound() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;

  // Rumble: low-passed noise
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuffer(ac, 0.5);
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.exponentialRampToValueAtTime(90, t + 0.45);
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.4, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  noise.connect(lp).connect(ng).connect(ac.destination);
  noise.start(t);

  // Descending tone
  const osc = ac.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.4);
  const og = ac.createGain();
  og.gain.setValueAtTime(0.18, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
  osc.connect(og).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.45);
}
