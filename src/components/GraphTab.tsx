import { useCallback, useEffect, useRef, useState } from "react";

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

interface GraphNode {
  id: string;
  name: string;
  brand: string;
  tags: string[];
  theme: string;
  format: string;
  file_type: string;
  cover: string | null;
  obsidian_link: string;
}

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
const WANDER = 0.055;
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
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterBrand, setFilterBrand] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterFormat, setFilterFormat] = useState("");

  // Parent may pass an inline lambda — keep it out of the effect deps.
  const openRef = useRef(onOpenTemplate);
  openRef.current = onOpenTemplate;

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (workspaceId) params.set("workspaceId", workspaceId);
      if (filterBrand) params.set("brand", filterBrand);
      if (filterTag) params.set("tag", filterTag);
      if (filterFormat) params.set("format", filterFormat);
      const res = await fetch(`/api/graph?${params.toString()}`);
      const d = await res.json();
      if (d.success) {
        setNodes(d.data.nodes || []);
        setEdges(d.data.edges || []);
      }
    } catch { /* keep previous graph */ } finally { setLoading(false); }
  }, [workspaceId, filterBrand, filterTag, filterFormat]);

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

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cssW = rect.width; cssH = rect.height;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

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
        // Center gravity + gentle perpetual wander (the "float")
        n.vx += -n.x * GRAVITY * a + Math.sin(t * 0.00045 + n.phase) * WANDER;
        n.vy += -n.y * GRAVITY * a + Math.cos(t * 0.00038 + n.phase * 1.3) * WANDER;
        if (n === dragging) { n.vx = 0; n.vy = 0; continue; }
        n.vx *= DAMPING; n.vy *= DAMPING;
        const vmax = 14;
        if (n.vx > vmax) n.vx = vmax; else if (n.vx < -vmax) n.vx = -vmax;
        if (n.vy > vmax) n.vy = vmax; else if (n.vy < -vmax) n.vy = -vmax;
        n.x += n.vx; n.y += n.vy;
      }
      alpha += (alphaTarget - alpha) * ALPHA_DECAY;
    };

    // Warm up off-screen so the first paint is already a good layout, then fit.
    for (let i = 0; i < WARMUP_TICKS; i++) tick(i * 16);
    const fitView = () => {
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
    };
    fitView();

    // ── Draw ──
    const draw = (t: number) => {
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.k, view.k);

      const focus = dragging || hovered;
      const focusSet = focus ? neighbors.get(focus.id) || new Set<string>() : null;

      // Edges: one dim batch + one highlighted batch (screen-constant width)
      ctx.lineWidth = 0.8 / view.k;
      ctx.strokeStyle = focus ? "rgba(160,175,200,0.04)" : "rgba(160,175,200,0.10)";
      ctx.beginPath();
      for (const l of links) {
        if (focus && (l.a === focus || l.b === focus)) continue;
        ctx.moveTo(l.a.x, l.a.y);
        ctx.lineTo(l.b.x, l.b.y);
      }
      ctx.stroke();
      if (focus) {
        const [r, g, b] = hexToRgb(colorOf(focus));
        ctx.lineWidth = 1.5 / view.k;
        ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`;
        ctx.beginPath();
        for (const l of links) {
          if (l.a !== focus && l.b !== focus) continue;
          ctx.moveTo(l.a.x, l.a.y);
          ctx.lineTo(l.b.x, l.b.y);
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
          const halo = ctx.createRadialGradient(n.x, n.y, r * 0.7, n.x, n.y, haloR);
          halo.addColorStop(0, `rgba(${cr},${cg},${cb},${haloAlpha})`);
          halo.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(n.x, n.y, haloR, 0, Math.PI * 2);
          ctx.fill();
        }

        // Orb body: bright core → brand color → deep edge
        const body = ctx.createRadialGradient(n.x - r * 0.3, n.y - r * 0.35, r * 0.1, n.x, n.y, r);
        body.addColorStop(0, `rgba(${Math.min(255, cr + 110)},${Math.min(255, cg + 110)},${Math.min(255, cb + 110)},${coreAlpha})`);
        body.addColorStop(0.55, `rgba(${cr},${cg},${cb},${coreAlpha})`);
        body.addColorStop(1, `rgba(${Math.round(cr * 0.55)},${Math.round(cg * 0.55)},${Math.round(cb * 0.55)},${coreAlpha})`);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
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
        const ly = n.y + n.radius * n.hoverScale + 15 / view.k;
        ctx.fillStyle = `rgba(8,10,16,${a * 0.7})`;
        ctx.fillText(label, n.x + 1 / view.k, ly + 1 / view.k);
        ctx.fillStyle = `rgba(226,232,240,${a})`;
        ctx.fillText(label, n.x, ly);
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
        const dx = w.x - n.x, dy = w.y - n.y;
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
      if (!hitTest(p.x, p.y)) fitView();
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
      positions: () => sim.map(n => ({ id: n.id, x: Math.round(n.x * 10) / 10, y: Math.round(n.y * 10) / 10 })),
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

  const brands = [...new Set(nodes.map(n => n.brand).filter(Boolean))];
  const allTags = [...new Set(nodes.flatMap(n => n.tags))];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "4px 0" }}>
        <select style={filterSelectStyle} value={filterBrand} onChange={e => { setFilterBrand(e.target.value); setFilterTag(""); setFilterFormat(""); }}>
          <option value="">All brands</option>
          {brands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select style={filterSelectStyle} value={filterTag} onChange={e => setFilterTag(e.target.value)}>
          <option value="">All tags</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select style={filterSelectStyle} value={filterFormat} onChange={e => setFilterFormat(e.target.value)}>
          <option value="">All formats</option>
          <option value="web">Web</option>
          <option value="mobile">Mobile</option>
          <option value="social">Social</option>
          <option value="print">Print</option>
          <option value="email">Email</option>
        </select>
        <span style={{ fontSize: 11, color: "#8b93a7" }}>
          {nodes.length} templates · {edges.length} connections · arrastra los orbes, rueda = zoom, doble click = centrar
        </span>
      </div>

      {/* Canvas */}
      <div ref={wrapRef} style={{ flex: 1, position: "relative", borderRadius: 12, overflow: "hidden", background: "radial-gradient(ellipse at 50% 40%, rgba(30,41,66,0.55) 0%, rgba(8,10,16,0.85) 100%)", border: "1px solid rgba(255,255,255,0.07)" }}>
        {loading && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 13 }}>Loading graph…</div>}
        {!loading && nodes.length === 0 && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>
          No metadata yet. Tag templates from the Editor → Meta panel.
        </div>}
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, display: loading ? "none" : "block" }} />
      </div>
    </div>
  );
}

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
