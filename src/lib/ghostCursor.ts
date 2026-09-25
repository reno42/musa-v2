// ghostCursor — FASE 2: el teatro del cursor fantasma vive AHORA en la app
// (antes era un script de pruebas en .tmp/mouse-demo). Es SOLO presentación:
// la ejecución real sigue siendo el gate (REPORTE_MIRA_fase2_ghost.md Parte 3).
//
// Modos de ritmo (Parte 0) — mismo cerebro y mismo resultado, SOLO cambia el
// ritmo del teatro. El switch del dock persiste en localStorage.
//
//   TEACHER = { cursorMove: 400ms, typingDelay: 80ms/char, pauseRead: 1200ms }
//   FULL    = { cursorMove: 80ms,  typingDelay: 0 (paste),  pauseRead: 0 }
//
// Abort (Parte 0): badge flotante "Musa está operando — no toques nada" con
// botón ABORTAR — cancela al instante, limpia cursor/badge y avisa a los
// listeners (el gate corta la cadena en el próximo paso con burbuja honesta).

export type GhostMode = "teacher" | "full";

export interface GhostTimings {
  cursorMove: number;
  typingDelay: number;
  pauseRead: number;
}

export const GHOST_TIMINGS: Record<GhostMode, GhostTimings> = {
  teacher: { cursorMove: 400, typingDelay: 80, pauseRead: 1200 },
  full: { cursorMove: 80, typingDelay: 0, pauseRead: 0 },
};

const LS_MODE_KEY = "futuraria-ghost-mode";
const Z_CURSOR = 2147483646;
const Z_BADGE = 2147483647;

const CURSOR_CSS = `
#ghost-cursor{position:fixed;left:0;top:0;z-index:${Z_CURSOR};pointer-events:none;
  transform:translate(-40px,-40px);transition:transform 400ms ease;will-change:transform;}
#ghost-cursor svg{display:block;transition:opacity .4s ease,transform .12s ease;
  filter:drop-shadow(0 1px 3px rgba(0,0,0,.55));}
#ghost-cursor.ghost-clicking svg{transform:scale(.78);}
#ghost-cursor.ghost-hidden svg{opacity:0;}
#ghost-badge{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:${Z_BADGE};
  display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:999px;
  background:rgba(15,15,20,0.85);backdrop-filter:blur(8px);
  border:1px solid rgba(96,165,250,0.4);box-shadow:0 8px 32px rgba(0,0,0,0.45);
  font-family:Inter,system-ui,sans-serif;font-size:12.5px;font-weight:600;color:#e5e7eb;
  animation:ghost-badge-in .25s ease;}
@keyframes ghost-badge-in{from{opacity:0;transform:translateX(-50%) translateY(-8px);}
  to{opacity:1;transform:translateX(-50%) translateY(0);}}
#ghost-badge .ghost-dot{width:8px;height:8px;border-radius:50%;background:#60a5fa;
  animation:ghost-pulse 1.1s ease-in-out infinite;}
@keyframes ghost-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.4;transform:scale(.7);}}
#ghost-badge button{font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.04em;
  padding:4px 10px;border-radius:999px;cursor:pointer;
  background:rgba(248,113,113,0.15);color:#fca5a5;border:1px solid rgba(248,113,113,0.4);}
#ghost-badge button:hover{background:rgba(248,113,113,0.3);}
`;

const CURSOR_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
<path d="M5.2 2.8 L19.2 11.2 L12.6 12.6 L9.2 19.4 Z" fill="#ffffff" stroke="#161616"
 stroke-width="1.5" stroke-linejoin="round"/></svg>`;

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** React controla los inputs: el native setter + evento input es lo que el
 *  setState del componente realmente escucha (patrón testing-library). */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export class GhostAbortedError extends Error {
  constructor() {
    super("Ghost abortado por el usuario");
    this.name = "GhostAbortedError";
  }
}

class GhostCursorImpl {
  private pos = { x: -40, y: -40 };
  private abortCbs = new Set<() => void>();
  private abortedFlag = false;
  private activeFlag = false;

  // ── Modo (switch del dock, persistido) ─────────────────────────────────────
  getMode(): GhostMode {
    try {
      const v = localStorage.getItem(LS_MODE_KEY);
      return v === "full" ? "full" : "teacher";
    } catch {
      return "teacher";
    }
  }

  setMode(mode: GhostMode): void {
    try { localStorage.setItem(LS_MODE_KEY, mode); } catch { /* noop */ }
  }

  get timings(): GhostTimings {
    return GHOST_TIMINGS[this.getMode()];
  }

  // ── Estado ─────────────────────────────────────────────────────────────────
  isActive(): boolean { return this.activeFlag; }
  isAborted(): boolean { return this.abortedFlag; }

  onAbort(cb: () => void): () => void {
    this.abortCbs.add(cb);
    return () => this.abortCbs.delete(cb);
  }

  /** Lanza GhostAbortedError si el usuario abortó — el gate/loop lo consulta
   *  entre pasos para cortar con transparencia. */
  assertLive(): void {
    if (this.abortedFlag) throw new GhostAbortedError();
  }

  // ── Ciclo de vida ──────────────────────────────────────────────────────────
  /** Entra en escena: cursor + badge con ABORTAR. Idempotente por sesión.
   *  Con label explícito actualiza el texto de un badge ya en escena (REQ-028
   *  Item 4: el badge nombra la capa que sirve la IA); sin label conserva el
   *  texto actual — así los start() sin argumentos del agente no lo pisan. */
  start(label?: string): void {
    if (typeof document === "undefined") return;
    if (!this.activeFlag) {
      this.abortedFlag = false;
      this.activeFlag = true;
      this.pos = { x: -40, y: -40 };
    }
    if (!document.getElementById("ghost-cursor")) {
      const style = document.createElement("style");
      style.id = "ghost-style";
      style.textContent = CURSOR_CSS;
      document.head.appendChild(style);
      const div = document.createElement("div");
      div.id = "ghost-cursor";
      div.innerHTML = CURSOR_SVG;
      document.body.appendChild(div);
    } else {
      document.getElementById("ghost-cursor")?.classList.remove("ghost-hidden");
    }
    if (!document.getElementById("ghost-badge")) {
      const badge = document.createElement("div");
      badge.id = "ghost-badge";
      badge.setAttribute("data-testid", "ghost-badge");
      badge.setAttribute("role", "status");
      const dot = document.createElement("span");
      dot.className = "ghost-dot";
      const text = document.createElement("span");
      text.id = "ghost-badge-text";
      text.textContent = label || "Musa está operando — no toques nada";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "ABORTAR";
      btn.setAttribute("aria-label", "Abortar coreografía de Musa");
      btn.addEventListener("click", () => this.abort());
      badge.append(dot, text, btn);
      document.body.appendChild(badge);
    } else if (label) {
      this.setLabel(label);
    }
  }

  /** REQ-028 Item 4 — texto del badge en vivo ("IA de Musa · quedan N" /
   *  "Tu IA (provider)"). Noop sin badge en escena. */
  setLabel(label: string): void {
    if (typeof document === "undefined") return;
    const el = document.getElementById("ghost-badge-text");
    if (el) el.textContent = label;
  }

  /** Salida limpia: cursor vuela a la esquina, fade, badge fuera. */
  done(): void {
    this.activeFlag = false;
    if (typeof document === "undefined") return;
    const cur = document.getElementById("ghost-cursor");
    if (cur) {
      cur.style.transition = `transform ${Math.max(240, this.timings.cursorMove)}ms ease`;
      cur.style.transform = `translate(${window.innerWidth - 30}px, ${window.innerHeight - 30}px)`;
      cur.classList.add("ghost-hidden");
    }
    this.removeBadge();
  }

  /** ABORTAR: cancela al instante, limpia TODO y avisa listeners. */
  abort(): void {
    if (this.abortedFlag) return;
    this.abortedFlag = true;
    this.activeFlag = false;
    if (typeof document !== "undefined") {
      document.getElementById("ghost-cursor")?.remove();
      this.removeBadge();
    }
    for (const cb of [...this.abortCbs]) {
      try { cb(); } catch { /* un listener roto no bloquea los demás */ }
    }
  }

  private removeBadge(): void {
    document.getElementById("ghost-badge")?.remove();
  }

  // ── Acciones de teatro ─────────────────────────────────────────────────────
  /** Vuelo con codo (2 tramos + offset perpendicular random — nada de líneas
   *  rectas: fue el tell #2 de la Fase 1). target: elemento o punto. */
  async move(target: HTMLElement | { x: number; y: number }, opts: { settle?: number } = {}): Promise<void> {
    this.assertLive();
    if (typeof document === "undefined") return;
    const cur = document.getElementById("ghost-cursor");
    if (!cur) { this.start(); }
    let x: number, y: number;
    if (target instanceof HTMLElement) {
      const r = target.getBoundingClientRect();
      x = r.x + r.width / 2 + rand(-4, 4);
      y = r.y + r.height / 2 + rand(-3, 3);
    } else {
      x = target.x;
      y = target.y;
    }
    x = Math.max(6, Math.min(window.innerWidth - 6, x));
    y = Math.max(6, Math.min(window.innerHeight - 6, y));
    const t = this.timings;
    const el = document.getElementById("ghost-cursor");
    if (!el) return;
    el.style.transition = `transform ${t.cursorMove}ms ease`;
    // Tramo 1: codo con offset perpendicular random (hasta ~12% de la distancia).
    const mx = this.pos.x + (x - this.pos.x) * 0.55 + rand(-48, 48);
    const my = this.pos.y + (y - this.pos.y) * 0.55 + rand(-36, 36);
    el.style.transform = `translate(${mx}px, ${my}px)`;
    await wait(t.cursorMove * 0.55);
    this.assertLive();
    // Tramo 2: llegada.
    el.style.transition = `transform ${Math.round(t.cursorMove * 0.8)}ms ease`;
    el.style.transform = `translate(${x}px, ${y}px)`;
    await wait(Math.round(t.cursorMove * 0.8) + (opts.settle ?? 60));
    this.pos = { x, y };
    this.assertLive();
  }

  /** Pulsito visual del cursor (equivalente del clicking de la Fase 1). */
  async pulse(): Promise<void> {
    const el = document.getElementById("ghost-cursor");
    if (!el) return;
    el.classList.add("ghost-clicking");
    await wait(120);
    el.classList.remove("ghost-clicking");
    this.assertLive();
  }

  /** Hover real (evento) + click sintético completo: pointerdown → mousedown →
   *  pointerup → mouseup → click con coords del cursor. Los handlers React
   *  (onClick/onMouseDown/onPointerDown) reciben el evento por bubbling. */
  async click(target: HTMLElement | { x: number; y: number }): Promise<void> {
    this.assertLive();
    let el: HTMLElement | null;
    if (target instanceof HTMLElement) el = target;
    else el = document.elementFromPoint(target.x, target.y) as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = this.pos.x || r.x + r.width / 2;
    const cy = this.pos.y || r.y + r.height / 2;
    await this.move(el);
    // Prendemos los :hover del DOM (tell #3 de la Fase 1) con enter/over reales.
    for (const type of ["pointerover", "mouseover", "mouseenter"] as const) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: type !== "mouseenter", cancelable: true, clientX: cx, clientY: cy, view: window }));
    }
    await wait(rand(90, 160));
    await this.pulse();
    const init: MouseEventInit = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", init));
    el.dispatchEvent(new MouseEvent("mousedown", init));
    el.dispatchEvent(new PointerEvent("pointerup", init));
    el.dispatchEvent(new MouseEvent("mouseup", init));
    el.click();
    await wait(140);
    this.assertLive();
  }

  /** Tipeo humano según modo: TEACHER letra a letra (80ms), FULL pega todo. */
  async type(el: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
    this.assertLive();
    await this.move(el);
    el.focus();
    const t = this.timings;
    if (t.typingDelay <= 0) {
      setNativeValue(el, el.value + text);
    } else {
      for (const ch of text) {
        this.assertLive();
        setNativeValue(el, el.value + ch);
        await wait(t.typingDelay + rand(-18, 30));
      }
    }
    await wait(rand(120, 220));
    this.assertLive();
  }

  /** Scroll de teatro: trae el target al centro (o flick vertical) y mueve el
   *  cursor un cachito — el gesto se VE sin depender del wheel real. */
  async scroll(target?: HTMLElement | null, dir: "up" | "down" = "down"): Promise<void> {
    this.assertLive();
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      window.scrollBy({ top: dir === "down" ? Math.round(window.innerHeight * 0.6) : -Math.round(window.innerHeight * 0.6), behavior: "smooth" });
    }
    await wait(rand(380, 520));
    this.assertLive();
  }

  /** Pausa de lectura del modo (o ms explícitos). */
  async pause(ms?: number): Promise<void> {
    this.assertLive();
    await wait(ms ?? this.timings.pauseRead);
    this.assertLive();
  }
}

/** Singleton: un solo fantasma en pantalla, igual que un solo cursor. */
export const ghost = new GhostCursorImpl();
