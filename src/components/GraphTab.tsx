import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { buildDesignHierarchy, type DesignGraphNode } from "../lib/designGraph";

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

interface GraphEdge {
  source: string;
  target: string;
  kind: string;
}

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
  brand: string;
  obsidian_link: string;
  phase: number;       // wander/pulse phase
  hoverScale: number;  // animated 1 → 1.28 on hover
}

// ── Simulation tuning ──
const REPULSION = 4200;
const SPRING = 0.038;
const SPRING_REST = 120;
const GRAVITY = 0.035;
const DAMPING = 0.88;
const ALPHA_DECAY = 0.03;
const ALPHA_FLOOR = 0.02;
// Physics wander removed: macroscopic drift reads as slow chaos. The float
// the eye sees is the bounded visual Lissajous wobble applied at render time.
const WARMUP_TICKS = 140;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.5;

const PALETTE = ["#5B9CF6", "#F87171", "#34D399", "#FBBF24", "#A78BFA", "#F472B6", "#22D3EE", "#FB923C"];

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function GraphTab({ workspaceId, onOpenTemplate }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<DesignGraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterBrand, setFilterBrand] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterFormat, setFilterFormat] = useState("");
  const [viewMode, setViewMode] = useState<"tree" | "canvas">("tree");

  // Parent may pass an inline lambda — keep it out of the effect deps.
  const openRef = useRef(onOpenTemplate);
  openRef.current = onOpenTemplate;

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (workspaceId) params.set("workspaceId", workspaceId);
      if (filterBrand) params.set("brand", filterBrand);
      if (filterTag) params.set("tag", filterTag);
      if (filterFormat) params.set("format", filterFormat);
      const response = await apiFetch<{
        success: boolean;
        data?: { nodes?: DesignGraphNode[]; edges?: GraphEdge[] };
        error?: string;
      }>(`/api/graph?${params.toString()}`);
      if (!response.success) throw new Error(response.error || "No se pudo cargar el grafo.");
      setNodes(Array.isArray(response.data?.nodes) ? response.data.nodes : []);
      setEdges(Array.isArray(response.data?.edges) ? response.data.edges : []);
    } catch (cause: unknown) {
      setNodes([]);
      setEdges([]);
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el grafo.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, filterBrand, filterTag, filterFormat]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (viewMode !== "canvas" || !canvas || !wrap || nodes.length === 0) return;
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
        radius: 5 + Math.min(12, Math.sqrt(deg) * 1.7),
        degree: deg,
        name: n.name,
        brand: n.brand,
        obsidian_link: n.obsidian_link,
        phase: i * 1.7,
        hoverScale: 1,
      };
    });
    const byId = new Map(sim.map(n => [n.id, n]));
    const links = edges
      .map(e => ({ a: byId.get(e.source), b: byId.get(e.target), kind: e.kind }))
      .filter((l): l is { a: SimNode; b: SimNode; kind: string } => !!l.a && !!l.b);
    const neighbors = new Map<string, Set<string>>();
    for (const l of links) {
      if (!neighbors.has(l.a.id)) neighbors.set(l.a.id, new Set());
      if (!neighbors.has(l.b.id)) neighbors.set(l.b.id, new Set());
      neighbors.get(l.a.id)!.add(l.b.id);
      neighbors.get(l.b.id)!.add(l.a.id);
    }

    const brandColor = new Map<string, string>();
    let ci = 0;
    for (const n of sim) {
      if (n.brand && !brandColor.has(n.brand)) brandColor.set(n.brand, PALETTE[ci++ % PALETTE.length]);
    }
    const colorOf = (n: SimNode) => brandColor.get(n.brand) || "#8B93A7";

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
        n.wx = n.x + 3.5 * Math.sin(t / 1300 + n.phase);
        n.wy = n.y + 3.5 * Math.cos(t / 1750 + n.phase * 1.31);
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
          if (n.obsidian_link) window.open(n.obsidian_link, "_blank");
          else openRef.current?.(n.id);
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
  }, [nodes, edges, viewMode]);

  const brands = [...new Set(nodes.map(n => n.brand).filter(Boolean))];
  const allTags = [...new Set(nodes.flatMap(n => n.tags))];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      {/* Filters + View Toggle */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "4px 0" }}>
        {/* View mode toggle */}
        <div style={{ display: "flex", gap: 2, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
          <button
            type="button"
            aria-pressed={viewMode === "tree"}
            onClick={() => setViewMode("tree")}
            style={{
              padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer",
              border: "none", color: viewMode === "tree" ? "#fff" : "rgba(255,255,255,0.4)",
              background: viewMode === "tree" ? "rgba(139,92,246,0.2)" : "transparent",
            }}
          >📂 Brands</button>
          <button
            type="button"
            aria-pressed={viewMode === "canvas"}
            onClick={() => setViewMode("canvas")}
            style={{
              padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer",
              border: "none", color: viewMode === "canvas" ? "#fff" : "rgba(255,255,255,0.4)",
              background: viewMode === "canvas" ? "rgba(139,92,246,0.2)" : "transparent",
            }}
          >🌌 Graph</button>
        </div>

        <select aria-label="Filtrar por marca" style={filterSelectStyle} value={filterBrand} onChange={e => { setFilterBrand(e.target.value); setFilterTag(""); setFilterFormat(""); }}>
          <option value="">All brands</option>
          {brands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select aria-label="Filtrar por etiqueta" style={filterSelectStyle} value={filterTag} onChange={e => setFilterTag(e.target.value)}>
          <option value="">All tags</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select aria-label="Filtrar por formato" style={filterSelectStyle} value={filterFormat} onChange={e => setFilterFormat(e.target.value)}>
          <option value="">All formats</option>
          <option value="web">Web</option>
          <option value="mobile">Mobile</option>
          <option value="social">Social</option>
          <option value="print">Print</option>
          <option value="email">Email</option>
        </select>
        <span style={{ fontSize: 11, color: "#8b93a7" }}>
          {viewMode === "canvas"
            ? `${nodes.length} templates · ${edges.length} connections`
            : `${nodes.length} templates across ${brands.length} brand${brands.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Tree View (brand-grouped) */}
      {viewMode === "tree" && (
        <BrandTreeView nodes={nodes} loading={loading} error={error} onRetry={fetchGraph} onOpenTemplate={onOpenTemplate} />
      )}

      {/* Canvas View (force graph) */}
      {viewMode === "canvas" && (
        <div ref={wrapRef} style={{ flex: 1, position: "relative", borderRadius: 12, overflow: "hidden", background: "radial-gradient(ellipse at 50% 40%, rgba(30,41,66,0.55) 0%, rgba(8,10,16,0.85) 100%)", border: "1px solid rgba(255,255,255,0.07)" }}>
          {loading && <div role="status" aria-live="polite" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#777", fontSize: 13 }}>Cargando grafo…</div>}
          {!loading && error && <GraphError message={error} onRetry={fetchGraph} />}
          {!loading && !error && nodes.length === 0 && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#777", fontSize: 13 }}>
            No metadata yet. Tag templates from the Editor → Meta panel.
          </div>}
          <canvas ref={canvasRef} aria-label="Grafo interactivo de relaciones entre diseños" style={{ position: "absolute", inset: 0, display: loading || error ? "none" : "block" }} />
        </div>
      )}
    </div>
  );
}

// ── Brand Tree View Component ──

function BrandTreeView({ nodes, loading, error, onRetry, onOpenTemplate }: {
  nodes: DesignGraphNode[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onOpenTemplate?: (templateId: string) => void;
}) {
  const treeId = useId().replace(/:/g, "");
  const hierarchy = useMemo(() => buildDesignHierarchy(nodes), [nodes]);
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const knownBrands = useRef(new Set<string>());

  useEffect(() => {
    setExpandedBrands((previous) => {
      const next = new Set(previous);
      for (const brand of hierarchy) {
        if (!knownBrands.current.has(brand.name)) next.add(brand.name);
        knownBrands.current.add(brand.name);
      }
      return next;
    });
  }, [hierarchy]);

  const toggleExpanded = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    key: string,
  ) => setter((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  if (loading) {
    return <div role="status" aria-live="polite" style={centeredStateStyle}>Cargando patrones…</div>;
  }
  if (error) {
    return <div style={{ flex: 1, position: "relative" }}><GraphError message={error} onRetry={onRetry} /></div>;
  }
  if (nodes.length === 0) {
    return (
      <div style={{ ...centeredStateStyle, flexDirection: "column", gap: 12 }}>
        <div aria-hidden="true" style={{ fontSize: 40, opacity: 0.2 }}>📂</div>
        <div style={{ color: "#777", textAlign: "center", maxWidth: 340 }}>
          No hay metadata todavía. Abre un diseño → File Info para asignar marca, campaña y formato.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(10,10,20,0.3)", padding: 8 }}>
      {hierarchy.map((brand, brandIndex) => {
        const color = PALETTE[brandIndex % PALETTE.length];
        const isExpanded = expandedBrands.has(brand.name);
        const brandPanelId = `${treeId}-brand-${brandIndex}`;
        return (
          <section key={brand.name} style={{ marginBottom: 4 }}>
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-controls={brandPanelId}
              onClick={() => toggleExpanded(setExpandedBrands, brand.name)}
              style={{ ...treeButtonStyle, padding: "10px 12px", background: "rgba(255,255,255,0.03)" }}
            >
              <span aria-hidden="true" style={{ ...chevronStyle, transform: isExpanded ? "rotate(90deg)" : "none" }}>▶</span>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.82)" }}>{brand.name}</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.42)" }}>
                {brand.totalDesigns} diseño{brand.totalDesigns !== 1 ? "s" : ""}
                {brand.campaigns.length > 0 ? ` · ${brand.campaigns.length} campaña${brand.campaigns.length !== 1 ? "s" : ""}` : ""}
              </span>
            </button>

            {isExpanded && (
              <div id={brandPanelId} style={{ marginLeft: 20, marginTop: 2 }}>
                {brand.directDesigns.map((design) => (
                  <DesignRow key={design.id} design={design} color={color} onOpenTemplate={onOpenTemplate} />
                ))}
                {brand.campaigns.map((campaign, campaignIndex) => {
                  const campaignKey = `${brand.name}\u0000${campaign.name}`;
                  const campaignExpanded = expandedCampaigns.has(campaignKey);
                  const campaignPanelId = `${brandPanelId}-campaign-${campaignIndex}`;
                  return (
                    <section key={campaignKey} style={{ marginBottom: 2 }}>
                      <button
                        type="button"
                        aria-expanded={campaignExpanded}
                        aria-controls={campaignPanelId}
                        onClick={() => toggleExpanded(setExpandedCampaigns, campaignKey)}
                        style={{ ...treeButtonStyle, padding: "7px 10px" }}
                      >
                        <span aria-hidden="true" style={{ ...chevronStyle, fontSize: 9, transform: campaignExpanded ? "rotate(90deg)" : "none" }}>▶</span>
                        <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.62)" }}>{campaign.name}</span>
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{campaign.designs.length}</span>
                      </button>
                      {campaignExpanded && (
                        <div id={campaignPanelId} style={{ marginLeft: 16, display: "flex", flexDirection: "column", gap: 2 }}>
                          {campaign.designs.map((design) => (
                            <DesignRow key={design.id} design={design} color={color} onOpenTemplate={onOpenTemplate} />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function DesignRow({ design, color, onOpenTemplate }: {
  design: DesignGraphNode;
  color: string;
  onOpenTemplate?: (templateId: string) => void;
}) {
  const setHighlighted = (element: HTMLButtonElement, highlighted: boolean) => {
    element.style.background = highlighted ? "rgba(139,92,246,0.08)" : "transparent";
  };
  return (
    <button
      type="button"
      onClick={() => onOpenTemplate?.(design.id)}
      onMouseEnter={(event) => setHighlighted(event.currentTarget, true)}
      onMouseLeave={(event) => setHighlighted(event.currentTarget, false)}
      onFocus={(event) => setHighlighted(event.currentTarget, true)}
      onBlur={(event) => setHighlighted(event.currentTarget, false)}
      style={{ ...treeButtonStyle, padding: "6px 10px" }}
    >
      {design.cover ? (
        <img src={design.cover} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: "cover", border: `1px solid ${color}40` }} />
      ) : (
        <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 4, background: "rgba(255,255,255,0.03)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, opacity: 0.35 }}>📄</span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,0.74)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{design.name}</span>
        {(design.format || design.tags.length > 0) && (
          <span style={{ display: "flex", gap: 4, marginTop: 2 }}>
            {design.format && <span style={formatBadgeStyle}>{design.format}</span>}
            {design.tags.slice(0, 2).map((tag) => <span key={tag} style={tagBadgeStyle}>{tag}</span>)}
          </span>
        )}
      </span>
    </button>
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

const centeredStateStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#777",
  fontSize: 13,
};

const treeButtonStyle: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "none",
  borderRadius: 7,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  fontFamily: "Inter, system-ui, sans-serif",
  textAlign: "left",
  transition: "background 0.15s ease",
};

const chevronStyle: React.CSSProperties = {
  display: "inline-block",
  flexShrink: 0,
  color: "rgba(255,255,255,0.38)",
  fontSize: 10,
  transition: "transform 0.15s ease",
};

const formatBadgeStyle: React.CSSProperties = {
  fontSize: 9,
  padding: "1px 6px",
  borderRadius: 100,
  background: "rgba(91,156,246,0.1)",
  color: "rgba(147,197,253,0.8)",
  textTransform: "capitalize",
};

const tagBadgeStyle: React.CSSProperties = {
  fontSize: 9,
  padding: "1px 6px",
  borderRadius: 100,
  background: "rgba(255,255,255,0.05)",
  color: "rgba(255,255,255,0.5)",
};

const filterSelectStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  color: "#ccc",
  outline: "none",
  fontFamily: "Inter, system-ui, sans-serif",
  cursor: "pointer",
};
