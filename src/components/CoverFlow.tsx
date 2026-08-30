import { useCallback, useEffect, useRef, useState } from "react";

/**
 * CoverFlow — stable iPod-style cover slider.
 *
 * Why not the old scroll-based version: a native overflow-x track with 3D
 * transforms desyncs painted positions from scroll geometry (scroll-snap and
 * scrollTo fight the perspective projection), the first/last card can never
 * reach the center without phantom padding, and re-rendering every card on
 * each index change collapses past ~15 covers.
 *
 * This version owns its motion:
 *  - a continuous float `pos` animated by a rAF loop toward `target`
 *  - card transforms are written imperatively to refs (React only re-renders
 *    when the mounted WINDOW of cards changes — 15 nodes max, any list size)
 *  - covers are static images (curated cover → thumbnail → clean blank card);
 *    no live editors, no iframes
 *  - starts with item 0 dead-center facing front, by construction
 *  - input: pointer drag (mouse/touch/pen), trackpad & wheel, arrow keys,
 *    click a side card to travel, click the center card to open
 */

export interface CoverFlowItem {
  id: string;
  name: string;
  cover: string | null;
  background?: string;
}

interface Props {
  items: CoverFlowItem[];
  onOpen: (id: string) => void;
  /** Fires when the centered (settled) index changes — for external metadata UI. */
  onIndexChange?: (index: number) => void;
  /** Stage height in px (default 380). */
  height?: number;
  /** Fill the parent flex column instead of a fixed px height — the flow
      then always fits the viewport, whatever its size. */
  flexible?: boolean;
}

// ── Geometry (iPod feel) ──
const CARD_W = 230;
const CARD_H = 300;
const CENTER_SPACING = 150;  // px per index within |d| <= 1
const SIDE_SPACING = 96;     // px per index beyond the center slot
const SIDE_ANGLE = 55;       // deg
const CENTER_POP_Z = 140;
const SIDE_Z = -90;
const WINDOW = 7;            // mounted cards: center ± WINDOW
const EASE = 0.16;           // approach factor per frame
const DRAG_PX_PER_INDEX = 140;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function CoverFlow({ items, onOpen, onIndexChange, height = 380, flexible = false }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<number, HTMLDivElement>());
  const [center, setCenter] = useState(0);

  // Motion state lives in refs — the rAF loop reads/writes without re-rendering.
  const posRef = useRef(0);
  const targetRef = useRef(0);
  const draggingRef = useRef(false);
  const itemsLen = items.length;
  const lenRef = useRef(itemsLen);
  lenRef.current = itemsLen;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const hasItems = itemsLen > 0;

  /** Apply the coverflow transform for card index i at continuous position p. */
  const applyTransform = useCallback((el: HTMLDivElement, i: number, p: number) => {
    const d = i - p;
    const ad = Math.abs(d);
    const sign = d < 0 ? -1 : 1;
    const x = ad <= 1 ? d * CENTER_SPACING : sign * (CENTER_SPACING + (ad - 1) * SIDE_SPACING);
    const rot = -clamp(d, -1, 1) * SIDE_ANGLE;
    const z = ad <= 1 ? CENTER_POP_Z - ad * (CENTER_POP_Z - SIDE_Z) : SIDE_Z;
    const scale = 1 - Math.min(ad, 1) * 0.16;
    const fadeStart = WINDOW - 1.5;
    const opacity = ad <= fadeStart ? 1 : clamp(1 - (ad - fadeStart) / 1.5, 0, 1);
    el.style.transform = `translate(-50%, -50%) translate3d(${x}px, 0, ${z}px) rotateY(${rot}deg) scale(${scale})`;
    el.style.opacity = String(opacity);
    el.style.zIndex = String(1000 - Math.round(ad * 12));
    el.style.pointerEvents = opacity < 0.15 ? "none" : "auto";
  }, []);

  // ── Animation loop: ease pos → target, keep transforms + window in sync ──
  useEffect(() => {
    if (itemsLen === 0) return;
    let raf = 0;
    let lastStep = 0;
    let lastSettled = -1;

    const step = (t: number) => {
      lastStep = t;
      const target = clamp(targetRef.current, 0, lenRef.current - 1);
      targetRef.current = target;
      let pos = posRef.current;
      const delta = target - pos;
      pos = Math.abs(delta) < 0.0008 ? target : pos + delta * EASE;
      posRef.current = pos;

      for (const [i, el] of cardRefs.current) applyTransform(el, i, pos);

      const rounded = Math.round(pos);
      setCenter(prev => (prev === rounded ? prev : rounded));
      if (!draggingRef.current && pos === target && rounded !== lastSettled) {
        lastSettled = rounded;
        onIndexChangeRef.current?.(rounded);
      }
    };
    const loop = (t: number) => { step(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    // rAF pauses in hidden tabs — keep motion (and agent verification) alive.
    const watchdog = window.setInterval(() => {
      const now = performance.now();
      if (now - lastStep > 50) step(now);
    }, 66);
    return () => { cancelAnimationFrame(raf); clearInterval(watchdog); };
  }, [itemsLen, applyTransform]);

  // Reset to a centered first cover whenever the collection identity changes.
  useEffect(() => {
    posRef.current = 0;
    targetRef.current = 0;
    setCenter(0);
    onIndexChangeRef.current?.(0);
  }, [itemsLen]);

  // ── Pointer drag (mouse / touch / pen unified) ──
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !hasItems) return;

    let startX = 0;
    let startPos = 0;
    let moved = false;
    let cancelled = false;
    // Hit-test anchor: pointer capture retargets every later pointer event to
    // the stage, so `ev.target` on pointerup is the stage — never the card.
    // The pointerdown target is the real hit element; remember it.
    let downTarget: HTMLElement | null = null;
    let lastX = 0, lastT = 0, velocity = 0; // index units per ms

    const onPointerDown = (ev: PointerEvent) => {
      // The side arrows are stage children: capturing the pointer here would
      // retarget their click to the stage and the buttons would never fire.
      if ((ev.target as HTMLElement | null)?.closest("button")) return;
      if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === "mouse") return;
      draggingRef.current = true;
      moved = false;
      cancelled = false;
      downTarget = ev.target as HTMLElement | null;
      startX = ev.clientX;
      startPos = posRef.current;
      lastX = ev.clientX;
      lastT = performance.now();
      velocity = 0;
      stage.setPointerCapture(ev.pointerId);
      stage.style.cursor = "grabbing";
    };
    const onPointerMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 5) moved = true;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      velocity = 0.8 * velocity + 0.2 * (-(ev.clientX - lastX) / DRAG_PX_PER_INDEX / dt);
      lastX = ev.clientX; lastT = now;
      // Direct manipulation: the flow tracks the finger 1:1 while dragging.
      const p = clamp(startPos - dx / DRAG_PX_PER_INDEX, -0.49, lenRef.current - 0.51);
      posRef.current = p;
      targetRef.current = p;
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      stage.style.cursor = "grab";
      try { stage.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
      // Momentum fling → snap to the nearest resulting cover.
      const fling = clamp(velocity * 260, -4, 4);
      targetRef.current = clamp(Math.round(posRef.current + fling), 0, lenRef.current - 1);
      if (!moved && !cancelled) {
        // Tap/click any card → open editor directly (iPod-style). Hit-test via
        // the pointerdown target — pointer capture retargets ev.target here.
        const el = downTarget?.closest("[data-flow-index]") as HTMLElement | null;
        if (el) {
          const idx = Number(el.dataset.flowIndex);
          const item = itemsRef.current[idx];
          if (item) onOpenRef.current(item.id);
        }
      }
    };
    // The browser taking the gesture (e.g. vertical scroll with touch-action
    // pan-y) must not count as a tap — it would open a cover mid-scroll.
    const onPointerCancel = (ev: PointerEvent) => {
      cancelled = true;
      onPointerUp(ev);
    };

    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerCancel);
    return () => {
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [hasItems]);

  // ── Wheel / trackpad (needs passive:false to preventDefault) ──
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !hasItems) return;
    let snapTimer: number | undefined;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const unit = ev.deltaMode === 1 ? 16 : 1; // lines → px
      const raw = (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY) * unit;
      targetRef.current = clamp(targetRef.current + raw / 220, 0, lenRef.current - 1);
      window.clearTimeout(snapTimer);
      snapTimer = window.setTimeout(() => {
        targetRef.current = clamp(Math.round(targetRef.current), 0, lenRef.current - 1);
      }, 130);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => { stage.removeEventListener("wheel", onWheel); window.clearTimeout(snapTimer); };
  }, [hasItems]);

  // ── Keyboard: ← → Home End Enter (ignored while typing) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || (document.activeElement as HTMLElement)?.isContentEditable) return;
      const go = (idx: number) => { targetRef.current = clamp(idx, 0, lenRef.current - 1); };
      if (e.key === "ArrowLeft") { e.preventDefault(); go(Math.round(targetRef.current) - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(Math.round(targetRef.current) + 1); }
      else if (e.key === "Home") { e.preventDefault(); go(0); }
      else if (e.key === "End") { e.preventDefault(); go(lenRef.current - 1); }
      else if (e.key === "Enter") {
        const item = itemsRef.current[Math.round(posRef.current)];
        if (item) { e.preventDefault(); onOpenRef.current(item.id); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasItems]);

  // QA probe — lets verification agents read/drive the flow deterministically.
  useEffect(() => {
    (window as any).__coverFlowProbe = {
      count: () => lenRef.current,
      pos: () => posRef.current,
      target: () => targetRef.current,
      center: () => Math.round(posRef.current),
      goTo: (i: number) => { targetRef.current = clamp(i, 0, lenRef.current - 1); },
    };
    return () => { delete (window as any).__coverFlowProbe; };
  }, []);

  if (itemsLen === 0) return null;

  // Mounted window: center ± WINDOW (15 nodes max regardless of list size).
  const from = Math.max(0, center - WINDOW);
  const to = Math.min(itemsLen - 1, center + WINDOW);
  const mounted: number[] = [];
  for (let i = from; i <= to; i++) mounted.push(i);

  const arrowStyle = (side: "left" | "right", disabled: boolean): React.CSSProperties => ({
    position: "absolute", top: "50%", [side]: 18, transform: "translateY(-50%)",
    zIndex: 2000, borderRadius: "50%", width: 44, height: 44, border: "none",
    cursor: disabled ? "default" : "pointer", display: "flex", alignItems: "center",
    justifyContent: "center", opacity: disabled ? 0.15 : 0.75,
    background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.85)",
    transition: "opacity 0.2s ease",
  });

  return (
    <div
      ref={stageRef}
      style={{
        position: "relative",
        height: flexible ? undefined : height,
        flex: flexible ? "1 1 0" : undefined,
        minHeight: flexible ? 160 : undefined,
        flexShrink: flexible ? undefined : 0,
        perspective: 1100, perspectiveOrigin: "50% 45%",
        overflow: "hidden", cursor: "grab",
        touchAction: "pan-y",
        userSelect: "none",
      }}
    >
      {mounted.map(i => {
        const item = items[i];
        const blank = !item.cover;
        return (
          <div
            key={item.id}
            data-flow-index={i}
            ref={el => {
              if (el) {
                cardRefs.current.set(i, el);
                applyTransform(el, i, posRef.current);
              } else {
                cardRefs.current.delete(i);
              }
            }}
            style={{
              position: "absolute", left: "50%", top: "45%",
              width: CARD_W, height: CARD_H,
              willChange: "transform, opacity",
              transformStyle: "preserve-3d",
              cursor: "pointer",
            }}
          >
            {/* Cover */}
            <div style={{
              width: "100%", height: "100%", borderRadius: 10, overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
              background: item.background || "#0d0d1a",
            }}>
              {blank ? (
                <div style={{
                  width: "100%", height: "100%", display: "flex", alignItems: "center",
                  justifyContent: "center", padding: 16, boxSizing: "border-box", textAlign: "center",
                  background: `linear-gradient(160deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 60%), ${item.background || "#0d0d1a"}`,
                }}>
                  <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 15, fontFamily: "'Instrument Serif', serif", lineHeight: 1.4 }}>
                    {item.name}
                  </span>
                </div>
              ) : (
                <img
                  src={item.cover!}
                  alt={item.name}
                  draggable={false}
                  decoding="async"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onError={e => {
                    // Broken cover URL → degrade to the blank card, never a broken glyph.
                    const img = e.currentTarget;
                    img.style.display = "none";
                  }}
                />
              )}
            </div>
            {/* iPod reflection */}
            <div style={{
              position: "absolute", top: "100%", left: 0, width: "100%", height: "45%",
              transform: "scaleY(-1)", transformOrigin: "top",
              borderRadius: 10, overflow: "hidden", opacity: 0.22, pointerEvents: "none",
              WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,0.7), transparent 75%)",
              maskImage: "linear-gradient(to top, rgba(0,0,0,0.7), transparent 75%)",
              background: item.background || "#0d0d1a",
            }}>
              {!blank && (
                <img src={item.cover!} alt="" draggable={false} decoding="async"
                  style={{ width: "100%", height: `${(CARD_H / (CARD_H * 0.45)) * 100}%`, objectFit: "cover", display: "block" }} />
              )}
            </div>
          </div>
        );
      })}

      {/* Arrows */}
      <button type="button" className="liquid-glass" aria-label="Previous"
        disabled={center <= 0}
        onClick={() => { targetRef.current = clamp(Math.round(targetRef.current) - 1, 0, itemsLen - 1); }}
        style={arrowStyle("left", center <= 0)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <button type="button" className="liquid-glass" aria-label="Next"
        disabled={center >= itemsLen - 1}
        onClick={() => { targetRef.current = clamp(Math.round(targetRef.current) + 1, 0, itemsLen - 1); }}
        style={arrowStyle("right", center >= itemsLen - 1)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
      </button>

      {/* Position indicator */}
      <div style={{
        position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)",
        fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em",
        fontFamily: "Inter, system-ui, sans-serif", pointerEvents: "none",
      }}>
        {center + 1} / {itemsLen}
      </div>
    </div>
  );
}
