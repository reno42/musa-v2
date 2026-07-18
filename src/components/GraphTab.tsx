import { useCallback, useEffect, useRef, useState } from "react";

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

// ── Force-directed layout constants ──
const REPULSION = 8000;
const ATTRACTION = 0.005;
const DAMPING = 0.85;
const MIN_VELOCITY = 0.5;
const MAX_ITERATIONS = 300;

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  name: string;
  brand: string;
  tags: string[];
  cover: string | null;
  obsidian_link: string;
  radius: number;
}

export function GraphTab({ workspaceId, onOpenTemplate }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const simNodesRef = useRef<SimNode[]>([]);
  const simEdgesRef = useRef<GraphEdge[]>([]);
  const animRef = useRef<number>();
  const [filterBrand, setFilterBrand] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterFormat, setFilterFormat] = useState("");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Fetch graph data
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
    } catch {} finally { setLoading(false); }
  }, [workspaceId, filterBrand, filterTag, filterFormat]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  // Canvas force simulation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    // Build simulation nodes
    const simNodes: SimNode[] = nodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      const r = Math.min(W, H) * 0.28;
      return {
        id: n.id,
        x: W / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 80,
        y: H / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 80,
        vx: 0, vy: 0,
        name: n.name,
        brand: n.brand,
        tags: n.tags,
        cover: n.cover,
        obsidian_link: n.obsidian_link,
        radius: 14,
      };
    });
    simNodesRef.current = simNodes;
    simEdgesRef.current = edges;

    // Build adjacency map
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      if (!adj.has(e.target)) adj.set(e.target, []);
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }

    // Simulate
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      let maxVel = 0;
      // Repulsion
      for (let i = 0; i < simNodes.length; i++) {
        for (let j = i + 1; j < simNodes.length; j++) {
          const dx = simNodes[j].x - simNodes[i].x;
          const dy = simNodes[j].y - simNodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = REPULSION / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          simNodes[i].vx -= fx;
          simNodes[i].vy -= fy;
          simNodes[j].vx += fx;
          simNodes[j].vy += fy;
        }
      }
      // Attraction
      for (const e of edges) {
        const a = simNodes.find(n => n.id === e.source);
        const b = simNodes.find(n => n.id === e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const fx = dx * ATTRACTION;
        const fy = dy * ATTRACTION;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
      // Center gravity
      for (const n of simNodes) {
        n.vx += (W / 2 - n.x) * 0.001;
        n.vy += (H / 2 - n.y) * 0.001;
      }
      // Apply + damp
      for (const n of simNodes) {
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(20, Math.min(W - 20, n.x));
        n.y = Math.max(20, Math.min(H - 20, n.y));
        maxVel = Math.max(maxVel, Math.abs(n.vx), Math.abs(n.vy));
      }
      if (maxVel < MIN_VELOCITY) break;
    }

    // Render
    const brandColors = new Map<string, string>();
    const palette = ["#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316"];
    let ci = 0;
    for (const n of simNodes) {
      if (n.brand && !brandColors.has(n.brand)) {
        brandColors.set(n.brand, palette[ci % palette.length]);
        ci++;
      }
    }

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      // Edges
      ctx.lineWidth = 0.5;
      for (const e of edges) {
        const a = simNodes.find(n => n.id === e.source);
        const b = simNodes.find(n => n.id === e.target);
        if (!a || !b) continue;
        const isHighlighted = hoveredNode && (e.source === hoveredNode || e.target === hoveredNode);
        ctx.strokeStyle = isHighlighted ? "rgba(255,255,255,0.25)" : (e.kind === "brand" ? "rgba(59,130,246,0.10)" : "rgba(255,255,255,0.06)");
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Nodes
      for (const n of simNodes) {
        const color = brandColors.get(n.brand) || "#666";
        const dimmed = hoveredNode ? (n.id !== hoveredNode && !edges.some(e =>
          (e.source === hoveredNode && e.target === n.id) || (e.target === hoveredNode && e.source === n.id)
        )) : false;

        ctx.globalAlpha = dimmed ? 0.3 : 1;

        // Glow
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Border
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Label
        const label = n.name.length > 14 ? n.name.slice(0, 13) + "…" : n.name;
        ctx.fillStyle = "#ccc";
        ctx.font = "10px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label, n.x, n.y + n.radius + 14);

        ctx.globalAlpha = 1;
      }
    };

    draw();

    // Click handler
    const handleClick = (ev: MouseEvent) => {
      const cx = ev.clientX - canvas.getBoundingClientRect().left;
      const cy = ev.clientY - canvas.getBoundingClientRect().top;
      for (const n of simNodes) {
        const dx = cx - n.x;
        const dy = cy - n.y;
        if (Math.sqrt(dx * dx + dy * dy) < n.radius + 4) {
          if (n.obsidian_link) {
            window.open(n.obsidian_link, "_blank");
          } else {
            onOpenTemplate?.(n.id);
          }
          return;
        }
      }
    };

    const handleMove = (ev: MouseEvent) => {
      const cx = ev.clientX - canvas.getBoundingClientRect().left;
      const cy = ev.clientY - canvas.getBoundingClientRect().top;
      let found = null;
      for (const n of simNodes) {
        const dx = cx - n.x;
        const dy = cy - n.y;
        if (Math.sqrt(dx * dx + dy * dy) < n.radius + 4) {
          found = n.id;
          break;
        }
      }
      setHoveredNode(found);
    };

    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("mousemove", handleMove);
    canvas.style.cursor = hoveredNode ? "pointer" : "default";

    return () => {
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("mousemove", handleMove);
    };
  }, [nodes, edges, hoveredNode, onOpenTemplate]);

  // Extract unique brands/tags for filters
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
        <select style={filterSelectStyle} value={filterTag} onChange={e => { setFilterTag(e.target.value); }}>
          <option value="">All tags</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select style={filterSelectStyle} value={filterFormat} onChange={e => { setFilterFormat(e.target.value); }}>
          <option value="">All formats</option>
          <option value="web">Web</option>
          <option value="mobile">Mobile</option>
          <option value="social">Social</option>
          <option value="print">Print</option>
          <option value="email">Email</option>
        </select>
        <span style={{ fontSize: 11, color: "#666" }}>{nodes.length} templates, {edges.length} connections</span>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: "relative", borderRadius: 8, overflow: "hidden", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        {loading && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 13 }}>Loading graph…</div>}
        {!loading && nodes.length === 0 && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>
          No metadata yet. Tag templates from the Editor → Meta panel.
        </div>}
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: loading ? "none" : "block" }} />
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
