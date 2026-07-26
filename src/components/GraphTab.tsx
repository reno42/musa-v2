import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/supabase";
import {
  buildDesignHierarchy,
  buildKnowledgeGraph,
  type DesignGraphBrand,
  type DesignGraphContact,
  type DesignGraphNode,
  type DesignGraphWorkspace,
  type KnowledgeGraphEdge,
  type KnowledgeNodeKind,
} from "../lib/designGraph";

/**
 * GraphTab — Obsidian-style design knowledge graph.
 *
 * Rendering model: ONE setup effect keyed on the data only. All interaction
 * state (hover, drag, pan/zoom, physics alpha) lives in refs read by a
 * continuous rAF loop — hovering or parent re-renders never rebuild the
 * simulation (the old version re-seeded random positions on every hover).
 *
 * Physics: d3-style force simulation, hand-rolled (no deps):
 *   repulsion (charge) · edge springs (degree-normalized so hubs don't
 *   collapse) · center gravity · collision · per-node wander so the orbs
 *   keep floating gently after the layout settles.
 * Dragging pins the node to the pointer and re-heats alpha so its
 * neighbors are tugged along — the Obsidian feel.
 */

interface Props {
  workspaceId: string | null;
  onOpenTemplate?: (templateId: string) => void;
}

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rendered position = physics + visual float wobble (kept in sync each frame). */
  wx: number;
  wy: number;
  radius: number;
  degree: number;
  name: string;
  colorKey: string;
  kind: KnowledgeNodeKind;
  externalLink?: string;
  templateId?: string;
  phase: number;       // wander/pulse phase
  hoverScale: number;  // animated 1 → 1.28 on hover
}

// ── Simulation tuning ──
const REPULSION = 2500;
const SPRING = 0.07;
const SPRING_REST = 40;
const GRAVITY = 0.2;
const DAMPING = 0.88;
const ALPHA_DECAY = 0.03;
const ALPHA_FLOOR = 0.02;
// Physics wander removed: macroscopic drift reads as slow chaos. The float
// the eye sees is the bounded visual Lissajous wobble applied at render time.
const WARMUP_TICKS = 140;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.5;

const GRAPH_COLOR = "#5B9CF6";
const BASE_RADIUS = 5;
const MAX_DEGREE_BONUS = 12;
const RADIUS_FACTOR = 1.4;

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function GraphTab({ workspaceId, onOpenTemplate }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [designNodes, setDesignNodes] = useState<DesignGraphNode[]>([]);
  const [brandAccounts, setBrandAccounts] = useState<DesignGraphBrand[]>([]);
  const [contacts, setContacts] = useState<DesignGraphContact[]>([]);
  const [workspace, setWorkspace] = useState<DesignGraphWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const hierarchy = useMemo(
    () => buildDesignHierarchy(designNodes, brandAccounts, contacts, workspace),
    [designNodes, brandAccounts, contacts, workspace],
  );
  const { nodes, edges } = useMemo(
    () => buildKnowledgeGraph(workspace, hierarchy),
    [workspace, hierarchy],
  );

  // Parent may pass an inline lambda — keep it out of the effect deps.
  const openRef = useRef(onOpenTemplate);
  openRef.current = onOpenTemplate;

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (workspaceId) params.set("workspaceId", workspaceId);
      const response = await apiFetch<{
        success: boolean;
        data?: {
          workspace?: DesignGraphWorkspace | null;
          brands?: DesignGraphBrand[];
          contacts?: DesignGraphContact[];
          nodes?: DesignGraphNode[];
        };
        error?: string;
      }>(`/api/graph?${params.toString()}`);
      if (!response.success) throw new Error(response.error || "No se pudo cargar el grafo.");
      setDesignNodes(Array.isArray(response.data?.nodes) ? response.data.nodes : []);
      setBrandAccounts(Array.isArray(response.data?.brands) ? response.data.brands : []);
      setContacts(Array.isArray(response.data?.contacts) ? response.data.contacts : []);
      setWorkspace(response.data?.workspace || null);
    } catch (cause: unknown) {
      setDesignNodes([]);
      setBrandAccounts([]);
      setContacts([]);
      setWorkspace(null);
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el grafo.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || nodes.length === 0) return;
    const ctx = canvas.getContext("2d")!;

    // ── Build simulation state (world coordinates around 0,0) ──
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) || 0) + 1);
      degree.set(e.target, (degree.get(e.target) || 0) + 1);
    }
    const sim: SimNode[] = nodes.map((n, i) => {
      const golden = i * 2.39996; // golden-angle spiral: deterministic, no jumps between loads
      const r = 26 * Math.sqrt(i + 1);
      const deg = degree.get(n.id) || 0;
      return {
        id: n.id,
        x: r * Math.cos(golden),
        y: r * Math.sin(golden),
        vx: 0, vy: 0,
        wx: r * Math.cos(golden),
        wy: r * Math.sin(golden),
        radius: BASE_RADIUS + Math.min(MAX_DEGREE_BONUS, Math.sqrt(deg) * RADIUS_FACTOR),
        degree: deg,
        name: n.name,
        colorKey: n.colorKey,
        kind: n.kind,
        externalLink: n.externalLink,
        templateId: n.templateId,
        phase: i * 1.7,
        hoverScale: 1,
      };
    });
    const byId = new Map(sim.map(n => [n.id, n]));
    const links = edges
      .map(e => ({ a: byId.get(e.source), b: byId.get(e.target), kind: e.kind }))
      .filter((l): l is { a: SimNode; b: SimNode; kind: KnowledgeGraphEdge["kind"] } => !!l.a && !!l.b);
    const neighbors = new Map<string, Set<string>>();
    for (const l of links) {
      if (!neighbors.has(l.a.id)) neighbors.set(l.a.id, new Set());
      if (!neighbors.has(l.b.id)) neighbors.set(l.b.id, new Set());
      neighbors.get(l.a.id)!.add(l.b.id);
      neighbors.get(l.b.id)!.add(l.a.id);
    }

    const colorOf = (_?: SimNode) => GRAPH_COLOR;

    // ── Interaction state (refs only — never re-runs this effect) ──
    const view = { x: 0, y: 0, k: 1 };
    let alpha = 1;
    let alphaTarget = 0;
    let hovered: SimNode | null = null;
    let dragging: SimNode | null = null;
    let panning = false;
    let downScreen = { x: 0, y: 0 };
    let downView = { x: 0, y: 0 };
    let moved = false;
    let raf = 0;
    let cssW = 0, cssH = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Until the user pans/zooms, every canvas resize re-fits the view — the
    // tab often mounts before layout settles, so the first fit uses a stale size.
    let userMovedView = false;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cssW = rect.width; cssH = rect.height;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!userMovedView) fitView();
    };
    const ro = new ResizeObserver(resize);

    const toWorld = (sx: number, sy: number) => ({ x: (sx - view.x) / view.k, y: (sy - view.y) / view.k });

    // ── Physics tick ──
    const tick = (t: number) => {
      const a = Math.max(alpha, ALPHA_FLOOR);
      // Repulsion + collision (single O(n²) pass — fine for a few hundred nodes)
      for (let i = 0; i < sim.length; i++) {
        const ni = sim[i];
        for (let j = i + 1; j < sim.length; j++) {
          const nj = sim[j];
          let dx = nj.x - ni.x, dy = nj.y - ni.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = 0.5; dy = 0.5; d2 = 0.5; }
          const d = Math.sqrt(d2);
          const f = (REPULSION / d2) * a;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          ni.vx -= fx; ni.vy -= fy;
          nj.vx += fx; nj.vy += fy;
          const minDist = ni.radius + nj.radius + 6;
          if (d < minDist) {
            const push = (minDist - d) * 0.35;
            ni.vx -= (dx / d) * push; ni.vy -= (dy / d) * push;
            nj.vx += (dx / d) * push; nj.vy += (dy / d) * push;
          }
        }
      }
      // Springs — normalized by degree so hubs don't swallow the graph
      for (const l of links) {
        const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = SPRING_REST + l.a.radius + l.b.radius;
        const norm = 1 / Math.min(l.a.degree || 1, l.b.degree || 1) ** 0.5;
        const f = (d - rest) * SPRING * norm * a;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        l.a.vx += fx; l.a.vy += fy;
        l.b.vx -= fx; l.b.vy -= fy;
      }
      for (const n of sim) {
        // Center gravity (the visible "float" is the render-time wobble)
        n.vx += -n.x * GRAVITY * a;
        n.vy += -n.y * GRAVITY * a;
        if (n === dragging) { n.vx = 0; n.vy = 0; continue; }
        n.vx *= DAMPING; n.vy *= DAMPING;
        const vmax = 14;
        if (n.vx > vmax) n.vx = vmax; else if (n.vx < -vmax) n.vx = -vmax;
        if (n.vy > vmax) n.vy = vmax; else if (n.vy < -vmax) n.vy = -vmax;
        n.x += n.vx; n.y += n.vy;
      }
      alpha += (alphaTarget - alpha) * ALPHA_DECAY;
    };

    function fitView() {
      if (!cssW || !cssH) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of sim) {
        minX = Math.min(minX, n.x - n.radius); maxX = Math.max(maxX, n.x + n.radius);
        minY = Math.min(minY, n.y - n.radius); maxY = Math.max(maxY, n.y + n.radius);
      }
      const pad = 70;
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(
        cssW / (maxX - minX + pad * 2), cssH / (maxY - minY + pad * 2),
      )));
      view.k = k;
      view.x = cssW / 2 - ((minX + maxX) / 2) * k;
      view.y = cssH / 2 - ((minY + maxY) / 2) * k;
    }

    // Warm up off-screen so the first paint is already a good layout, then fit.
    for (let i = 0; i < WARMUP_TICKS; i++) tick(i * 16);
    resize();
    ro.observe(wrap);

    // ── Draw ──
    const draw = (t: number) => {
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.k, view.k);

      const focus = dragging || hovered;
      const focusSet = focus ? neighbors.get(focus.id) || new Set<string>() : null;

      // Visual float: slow Lissajous drift on the RENDERED position. Dense
      // graphs (966 springs) brace the physics rigid, so the "floating" the
      // eye sees is decoupled from layout. The dragged node stays pinned.
      for (const n of sim) {
        if (n === dragging) { n.wx = n.x; n.wy = n.y; continue; }
        n.wx = n.x + (reduceMotion ? 0 : 3.5 * Math.sin(t / 1300 + n.phase));
        n.wy = n.y + (reduceMotion ? 0 : 3.5 * Math.cos(t / 1750 + n.phase * 1.31));
      }

      // Edges: one dim batch + one highlighted batch (screen-constant width)
      ctx.lineWidth = 0.8 / view.k;
      ctx.strokeStyle = focus ? "rgba(160,175,200,0.04)" : "rgba(160,175,200,0.10)";
      ctx.beginPath();
      for (const l of links) {
        if (focus && (l.a === focus || l.b === focus)) continue;
        ctx.moveTo(l.a.wx, l.a.wy);
        ctx.lineTo(l.b.wx, l.b.wy);
      }
      ctx.stroke();
      if (focus) {
        const [r, g, b] = hexToRgb(colorOf(focus));
        ctx.lineWidth = 1.5 / view.k;
        ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`;
        ctx.beginPath();
        for (const l of links) {
          if (l.a !== focus && l.b !== focus) continue;
          ctx.moveTo(l.a.wx, l.a.wy);
          ctx.lineTo(l.b.wx, l.b.wy);
        }
        ctx.stroke();
      }

      // Orbs
      for (const n of sim) {
        const isFocus = n === focus;
        const isNeighbor = !!(focusSet && focusSet.has(n.id));
        const dim = focus && !isFocus && !isNeighbor;
        const targetScale = isFocus ? 1.28 : 1;
        n.hoverScale += (targetScale - n.hoverScale) * 0.18;
        const pulse = 1 + 0.035 * Math.sin(t * 0.0012 + n.phase);
        const r = n.radius * n.hoverScale * pulse;
        const [cr, cg, cb] = hexToRgb(colorOf(n));
        const coreAlpha = dim ? 0.28 : 1;

        // Halo only where there's a story: focused node glows, neighbors shimmer,
        // resting nodes stay clean orbs — glow everywhere reads as foam, not space.
        const haloAlpha = isFocus ? 0.32 : isNeighbor ? 0.15 : focus ? 0 : 0.045;
        if (haloAlpha > 0.01) {
          const haloR = r * (isFocus ? 2.5 : 1.9);
          const halo = ctx.createRadialGradient(n.wx, n.wy, r * 0.7, n.wx, n.wy, haloR);
          halo.addColorStop(0, `rgba(${cr},${cg},${cb},${haloAlpha})`);
          halo.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(n.wx, n.wy, haloR, 0, Math.PI * 2);
          ctx.fill();
        }

        // Orb body: bright core → brand color → deep edge
        const body = ctx.createRadialGradient(n.wx - r * 0.3, n.wy - r * 0.35, r * 0.1, n.wx, n.wy, r);
        body.addColorStop(0, `rgba(${Math.min(255, cr + 110)},${Math.min(255, cg + 110)},${Math.min(255, cb + 110)},${coreAlpha})`);
        body.addColorStop(0.55, `rgba(${cr},${cg},${cb},${coreAlpha})`);
        body.addColorStop(1, `rgba(${Math.round(cr * 0.55)},${Math.round(cg * 0.55)},${Math.round(cb * 0.55)},${coreAlpha})`);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(n.wx, n.wy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1 / view.k;
        ctx.strokeStyle = `rgba(255,255,255,${dim ? 0.06 : 0.28})`;
        ctx.stroke();
      }

      // Labels: hovered + neighbors always; the rest fade in with zoom
      const zoomLabelAlpha = Math.max(0, Math.min(1, (view.k - 0.55) / 0.5));
      ctx.textAlign = "center";
      ctx.font = `${11 / view.k}px Inter, system-ui, sans-serif`;
      for (const n of sim) {
        const isFocus = n === focus;
        const isNeighbor = !!(focusSet && focusSet.has(n.id));
        let a = isFocus ? 1 : isNeighbor ? 0.85 : zoomLabelAlpha * (focus ? 0.12 : 0.55);
        if (a <= 0.02) continue;
        const label = n.name.length > 18 ? n.name.slice(0, 17) + "…" : n.name;
        const ly = n.wy + n.radius * n.hoverScale + 15 / view.k;
        ctx.fillStyle = `rgba(8,10,16,${a * 0.7})`;
        ctx.fillText(label, n.wx + 1 / view.k, ly + 1 / view.k);
        ctx.fillStyle = `rgba(226,232,240,${a})`;
        ctx.fillText(label, n.wx, ly);
      }
      ctx.restore();
    };

    let lastStep = 0;
    const step = (t: number) => {
      lastStep = t;
      tick(t);
      draw(t);
    };
    const loop = (t: number) => {
      step(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // Hidden tabs pause rAF entirely. Keep the simulation alive at ~15fps so
    // (a) the layout doesn't freeze mid-drag when the user switches tabs and
    // (b) AI agents driving a headless/background pane can still verify it.
    const watchdog = window.setInterval(() => {
      const now = performance.now();
      if (now - lastStep > 50) step(now);
    }, 66);

    // ── Interaction ──
    const hitTest = (sx: number, sy: number): SimNode | null => {
      const w = toWorld(sx, sy);
      let best: SimNode | null = null, bestD = Infinity;
      for (const n of sim) {
        const dx = w.x - n.wx, dy = w.y - n.wy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < n.radius + 6 / view.k && d < bestD) { best = n; bestD = d; }
      }
      return best;
    };
    const localXY = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };

    const onDown = (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      const p = localXY(ev);
      downScreen = { x: ev.clientX, y: ev.clientY };
      moved = false;
      const hit = hitTest(p.x, p.y);
      if (hit) {
        dragging = hit;
        alphaTarget = 0.35; alpha = Math.max(alpha, 0.35); // re-heat: neighbors follow the tug
        canvas.style.cursor = "grabbing";
      } else {
        panning = true;
        userMovedView = true;
        downView = { x: view.x, y: view.y };
        canvas.style.cursor = "grabbing";
      }
      ev.preventDefault();
    };
    const onMove = (ev: MouseEvent) => {
      const p = localXY(ev);
      if (dragging) {
        if (Math.abs(ev.clientX - downScreen.x) + Math.abs(ev.clientY - downScreen.y) > 4) moved = true;
        const w = toWorld(p.x, p.y);
        dragging.x = w.x; dragging.y = w.y;
        dragging.vx = 0; dragging.vy = 0;
        return;
      }
      if (panning) {
        if (Math.abs(ev.clientX - downScreen.x) + Math.abs(ev.clientY - downScreen.y) > 4) moved = true;
        view.x = downView.x + (ev.clientX - downScreen.x);
        view.y = downView.y + (ev.clientY - downScreen.y);
        return;
      }
      hovered = hitTest(p.x, p.y);
      canvas.style.cursor = hovered ? "pointer" : "grab";
    };
    const onUp = (ev: MouseEvent) => {
      if (dragging) {
        const n = dragging;
        dragging = null;
        alphaTarget = 0;
        if (!moved) {
          if (n.externalLink) window.open(n.externalLink, "_blank", "noopener,noreferrer");
          else if (n.templateId) openRef.current?.(n.templateId);
        }
      }
      panning = false;
      const p = localXY(ev);
      hovered = hitTest(p.x, p.y);
      canvas.style.cursor = hovered ? "pointer" : "grab";
    };
    const onLeave = () => { hovered = null; if (!dragging && !panning) canvas.style.cursor = "grab"; };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      userMovedView = true;
      const p = localXY(ev);
      const factor = Math.exp(-ev.deltaY * 0.0016);
      const k2 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.k * factor));
      // Zoom toward the cursor
      view.x = p.x - ((p.x - view.x) / view.k) * k2;
      view.y = p.y - ((p.y - view.y) / view.k) * k2;
      view.k = k2;
    };
    const onDblClick = (ev: MouseEvent) => {
      const p = localXY(ev);
      if (!hitTest(p.x, p.y)) { fitView(); userMovedView = false; }
    };

    canvas.style.cursor = "grab";
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDblClick);

    // Expose a tiny probe so QA agents can verify the graph without guessing.
    (window as any).__graphProbe = {
      nodeCount: sim.length,
      positions: () => sim.map(n => ({ id: n.id, x: Math.round(n.wx * 10) / 10, y: Math.round(n.wy * 10) / 10 })),
      raw: () => sim.map(n => ({ id: n.id, x: Math.round(n.x * 10) / 10, y: Math.round(n.y * 10) / 10 })),
      view: () => ({ ...view }),
      alpha: () => alpha,
    };

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(watchdog);
      ro.disconnect();
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDblClick);
      delete (window as any).__graphProbe;
    };
  }, [nodes, edges]);

  const clientBrandCount = nodes.filter(n => n.kind === "brand").length;
  const campaignCount = nodes.filter(n => n.kind === "campaign").length;
  const designCount = nodes.filter(n => n.kind === "design").length;

  return (
    <div ref={wrapRef} style={{ height: "100%", position: "relative", borderRadius: 12, overflow: "hidden", background: "#080a10", border: "1px solid rgba(255,255,255,0.07)" }}>
      {loading && <div role="status" aria-live="polite" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#777", fontSize: 13 }}>Cargando grafo…</div>}
      {!loading && error && <GraphError message={error} onRetry={fetchGraph} />}
      {!loading && !error && designCount === 0 && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#777", fontSize: 13, gap: 8 }}>
          <span>No hay diseños para mostrar.</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Asigna marcas a los archivos desde File Info.</span>
        </div>
      )}
      {!loading && !error && designCount > 0 && (
        <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", background: "rgba(8,10,16,0.8)", padding: "4px 12px", borderRadius: 100 }}>
            {clientBrandCount} marcas · {campaignCount} campañas · {designCount} archivos · arrastra para explorar
          </span>
        </div>
      )}
      <canvas ref={canvasRef} aria-label="Grafo de diseños" style={{ position: "absolute", inset: 0, display: loading || error || designCount === 0 ? "none" : "block" }} />
    </div>
  );
}

function GraphError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#fca5a5", fontSize: 13, textAlign: "center", padding: 24 }}>
      <span>No se pudo cargar el visor de patrones.</span>
      <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>{message}</span>
      <button type="button" onClick={onRetry} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.07)", color: "#fff", cursor: "pointer" }}>Reintentar</button>
    </div>
  );
}
