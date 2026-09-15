/**
 * BrandGraphCanvas — Second Brain: grafo force-directed del workspace.
 *
 * Renders a brand hierarchy as an interactive canvas with physics simulation,
 * brand-colored nodes, category grouping, and Obsidian link badges.
 *
 * v56: el click en un nodo abre su ficha (InspectorDrawer sin velo) con las
 * notas en Markdown del archivo — el "Second Brain" del workspace, editable
 * y sincronizado con el editor y las IAs (misma columna notes_md).
 *
 * Peers with the existing GraphTab knowledge graph but uses a different
 * data source (GET /api/brand-graph).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/supabase";
import { InspectorDrawer } from "./InspectorDrawer";
import { renderMarkdown } from "../lib/markdown";
import { splitNoteZones } from "../../shared/brainNoteZones";

// ── Types matching api/src/services/brandGraph.ts ──

type BrandGraphNodeKind = "workspace" | "brand" | "category" | "template" | "asset" | "frame" | "note";

interface BrandGraphNode {
  id: string;
  name: string;
  level: number;
  kind: BrandGraphNodeKind;
  color: string;
  templateId?: string;
  obsidianLink?: string;
  category?: string;
  campaign?: string;
  /** Second Brain: which living note this node opens, under which slug. */
  noteKind?: string;
  noteSlug?: string;
  personaIndex?: number;
  /** File no brand claimed. */
  orphan?: boolean;
  children: BrandGraphNode[];
}

interface BrandGraphRoot {
  workspaceId: string;
  workspaceName: string;
  brands: BrandGraphNode[];
  /** Files not filed under any brand — free-floating planets. */
  orphans?: BrandGraphNode[];
}

interface Props {
  workspaceId: string | null;
  onOpenTemplate?: (templateId: string) => void;
}

// ── Flattened simulation node ──

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  name: string;
  level: number;
  kind: BrandGraphNodeKind;
  color: string;
  templateId?: string;
  obsidianLink?: string;
  campaign?: string;
  noteKind?: string;
  noteSlug?: string;
  personaIndex?: number;
  hoverScale: number;
  phase: number;
  /** File no brand claimed — floats outside the brand ring, in grey. */
  orphan?: boolean;
  /** Rest distance from this node's parent. Set per node so orphans can sit
   *  further out than brands without sharing their depth. */
  orbit: number;
  /** Parent node ID for tree structure */
  parentId: string | null;
}

interface SimLink {
  source: SimNode;
  target: SimNode;
}

// ── Physics tuning ──

const CENTER_RADIUS = 12;
const BRAND_RADIUS_BASE = 7;
const CAT_RADIUS_BASE = 5;
const ITEM_RADIUS_BASE = 4;
const ORBIT_RADIUS = 160; // Brands orbit distance from center
const CAT_ORBIT = 100; // Categories orbit distance from brand
const ITEM_ORBIT = 55; // Items orbit distance from category

const REPULSION = 2200;
const SPRING = 0.06;
const GRAVITY = 0.6;
const DAMPING = 0.85;
const ALPHA_DECAY = 0.03;
const WARMUP_TICKS = 120;

/**
 * Rest length of the spring holding a node to its parent, by depth.
 * These are the orbit shells above: level 1 (brands) sit at ORBIT_RADIUS
 * from the centre, level 2 (categories) at CAT_ORBIT from their brand, and
 * so on. Previously every link shared one flat rest length, so all three
 * levels settled at the same distance and the hierarchy read as a blob.
 */
function orbitForLevel(level: number): number {
  if (level <= 1) return ORBIT_RADIUS;
  if (level === 2) return CAT_ORBIT;
  return ITEM_ORBIT;
}

/** Orphans ring the workspace well outside the brands, so being unfiled reads
 *  as a position, not just a colour. */
const ORPHAN_ORBIT = ORBIT_RADIUS * 2.4;

/** Monochrome. Depth and state read as brightness, never as hue. */
const BRAND_PALETTE = ["#ffffff"];

export function BrandGraphCanvas({ workspaceId, onOpenTemplate }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState<BrandGraphRoot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Selected node & context menu ──
  const [selectedNode, setSelectedNode] = useState<{
    id: string; name: string; kind: string; color: string;
    templateId?: string; obsidianLink?: string; campaign?: string;
    brandName?: string; brandId?: string;
    noteKind?: string; noteSlug?: string; personaIndex?: number;
    orphan?: boolean;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  // v56: la ficha del nodo (drawer Second Brain) se abre con un click limpio,
  // no al presionar — arrastrar un nodo no debe despertar el panel.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reconnectMode, setReconnectMode] = useState(false);
  const [infoMsg, setInfoMsg] = useState("");
  // Ref to bridge reconnect state into the rAF effect closure
  const reconnectRef = useRef<{ active: boolean; nodeId: string | null }>({ active: false, nodeId: null });
  reconnectRef.current = { active: reconnectMode, nodeId: selectedNode?.id ?? null };

  const openRef = useRef(onOpenTemplate);
  openRef.current = onOpenTemplate;

  // ── Fetch ──

  const fetchGraph = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      // v57: sin retry y con deadline corto — si la API está saturada, el
      // error (con su botón Reintentar) aparece rápido en vez de colgar 20s+.
      const res = await apiFetch<{ success: boolean; data?: BrandGraphRoot }>(
        `/api/brand-graph?workspaceId=${workspaceId}`,
        { retries: 0, timeoutMs: 8000 },
      );
      if (!res.success) throw new Error("Failed to load brand graph");
      setGraph(res.data || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  // ── Mutations (MCP calls) ──

  const callMcp = useCallback(async (method: string, params: Record<string, unknown>) => {
    if (!workspaceId) return null;
    try {
      const res = await apiFetch<{ success?: boolean; error?: string }>("/mcp", {
        method: "POST",
        body: JSON.stringify({ method, params: { workspaceId, ...params } }),
      });
      return res;
    } catch (e) {
      console.error(`[BrandGraph] MCP ${method} failed:`, e);
      return null;
    }
  }, [workspaceId]);

  /** Reassign a template to a different brand (update design_file_meta). */
  const reassignToBrand = useCallback(async (templateId: string, brandId: string) => {
    if (!workspaceId) return;
    try {
      await apiFetch(`/api/meta/${templateId}`, {
        method: "PUT",
        body: JSON.stringify({ brand_id: brandId }),
      });
      setInfoMsg("Marca reasignada correctamente");
      setTimeout(() => setInfoMsg(""), 2500);
      fetchGraph();
    } catch (e) {
      console.error("reassignToBrand failed:", e);
      setInfoMsg("Error al reasignar marca");
      setTimeout(() => setInfoMsg(""), 2500);
    }
  }, [workspaceId, fetchGraph]);

  /** Delete a template node (soft-delete via MCP). */
  const deleteTemplateNode = useCallback(async (templateId: string) => {
    const res = await callMcp("tools_remove_template", { templateId });
    if (res) {
      setInfoMsg("Template eliminado");
      setTimeout(() => setInfoMsg(""), 2500);
      fetchGraph();
    }
  }, [callMcp, fetchGraph]);

  // ── Flatten tree into SimNode[] + SimLink[] ──

  function flattenTree(root: BrandGraphRoot): { nodes: SimNode[]; links: SimLink[] } {
    const simNodes: SimNode[] = [];
    const simLinks: SimLink[] = [];
    let phaseCounter = 0;

    // Root (workspace)
    const rootNode: SimNode = {
      id: `ws:${root.workspaceId}`,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: CENTER_RADIUS,
      orbit: 0,
      name: root.workspaceName || "Mi cuenta",
      level: 0,
      kind: "workspace",
      color: "#ffffff",
      hoverScale: 1,
      phase: phaseCounter++,
      parentId: null,
    };
    simNodes.push(rootNode);

    // Position brands in a circle around root
    const brandCount = root.brands.length;
    root.brands.forEach((brand, i) => {
      const angle = (i / brandCount) * Math.PI * 2 - Math.PI / 2;
      const brandNode: SimNode = {
        id: brand.id,
        x: Math.cos(angle) * ORBIT_RADIUS,
        y: Math.sin(angle) * ORBIT_RADIUS,
        vx: 0,
        vy: 0,
        radius: BRAND_RADIUS_BASE + Math.min(8, Math.sqrt(brand.children.length) * 2),
        orbit: ORBIT_RADIUS,
        name: brand.name,
        level: 1,
        kind: "brand",
        color: brand.color || BRAND_PALETTE[i % BRAND_PALETTE.length],
        noteKind: brand.noteKind,
        noteSlug: brand.noteSlug,
        hoverScale: 1,
        phase: phaseCounter++,
        parentId: rootNode.id,
      };
      simNodes.push(brandNode);
      simLinks.push({ source: rootNode, target: brandNode });

      // Categories and their children
      brand.children.forEach((cat, ci) => {
        const catAngle = angle + ((ci / Math.max(brand.children.length, 1)) - 0.5) * Math.PI * 0.7;
        const catNode: SimNode = {
          id: cat.id,
          x: brandNode.x + Math.cos(catAngle) * CAT_ORBIT,
          y: brandNode.y + Math.sin(catAngle) * CAT_ORBIT,
          vx: 0,
          vy: 0,
          radius: CAT_RADIUS_BASE,
          orbit: CAT_ORBIT,
          name: cat.name,
          level: 2,
          kind: "category",
          color: brandNode.color,
          noteKind: cat.noteKind,
          noteSlug: cat.noteSlug,
            hoverScale: 1,
          phase: phaseCounter++,
          parentId: brandNode.id,
        };
        simNodes.push(catNode);
        simLinks.push({ source: brandNode, target: catNode });

        cat.children.forEach((item, ii) => {
          const itemAngle = catAngle + ((ii / Math.max(cat.children.length, 1)) - 0.5) * Math.PI * 0.5;
          const itemNode: SimNode = {
            id: item.id,
            x: catNode.x + Math.cos(itemAngle) * ITEM_ORBIT,
            y: catNode.y + Math.sin(itemAngle) * ITEM_ORBIT,
            vx: 0,
            vy: 0,
            radius: ITEM_RADIUS_BASE,
            orbit: ITEM_ORBIT,
            name: item.name,
            level: item.level,
            kind: item.kind,
            color: brandNode.color,
            templateId: item.templateId,
            obsidianLink: item.obsidianLink,
            campaign: item.campaign,
            noteKind: item.noteKind,
            noteSlug: item.noteSlug,
            personaIndex: item.personaIndex,
            hoverScale: 1,
            phase: phaseCounter++,
            parentId: catNode.id,
          };
          simNodes.push(itemNode);
          simLinks.push({ source: catNode, target: itemNode });
        });
      });
    });

    // Orphans: files no brand claimed. They hang off the workspace centre on
    // a wider shell than the brands, so being unfiled is visible as a position
    // and not only as a colour.
    const orphans = root.orphans || [];
    orphans.forEach((o, i) => {
      const a = (i / Math.max(orphans.length, 1)) * Math.PI * 2;
      simNodes.push({
        id: o.id,
        x: Math.cos(a) * ORPHAN_ORBIT,
        y: Math.sin(a) * ORPHAN_ORBIT,
        vx: 0,
        vy: 0,
        radius: ITEM_RADIUS_BASE + 1,
        orbit: ORPHAN_ORBIT,
        name: o.name,
        level: 1,
        kind: o.kind,
        color: o.color,
        templateId: o.templateId,
        obsidianLink: o.obsidianLink,
        campaign: o.campaign,
        noteKind: o.noteKind,
        noteSlug: o.noteSlug,
        orphan: true,
        hoverScale: 1,
        phase: phaseCounter++,
        parentId: rootNode.id,
      });
      simLinks.push({ source: rootNode, target: simNodes[simNodes.length - 1] });
    });

    return { nodes: simNodes, links: simLinks };
  }

  // ── Canvas + Physics effect ──

  useEffect(() => {
    if (!graph || graph.brands.length === 0) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d")!;

    const { nodes: sim, links } = flattenTree(graph);
    const byId = new Map(sim.map(n => [n.id, n]));
    const root = sim[0]; // workspace
    const neighborMap = new Map<string, Set<string>>();
    for (const l of links) {
      if (!neighborMap.has(l.source.id)) neighborMap.set(l.source.id, new Set());
      if (!neighborMap.has(l.target.id)) neighborMap.set(l.target.id, new Set());
      neighborMap.get(l.source.id)!.add(l.target.id);
      neighborMap.get(l.target.id)!.add(l.source.id);
    }

    // ── State ──
    const view = { x: 0, y: 0, k: 1 };
    let alpha = 1;
    let alphaTarget = 0;
    let hovered: SimNode | null = null;
    let dragged: SimNode | null = null;
    let selected: SimNode | null = null;
    let panning = false;
    let downScreen = { x: 0, y: 0 };
    let downView = { x: 0, y: 0 };
    let moved = false;
    let raf = 0;
    let cssW = 0, cssH = 0;
    let userMovedView = false;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

    const toWorld = (sx: number, sy: number) => ({
      x: (sx - view.x) / view.k,
      y: (sy - view.y) / view.k,
    });

    const fitView = () => {
      if (!cssW || !cssH) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of sim) {
        minX = Math.min(minX, n.x - n.radius); maxX = Math.max(maxX, n.x + n.radius);
        minY = Math.min(minY, n.y - n.radius); maxY = Math.max(maxY, n.y + n.radius);
      }
      const pad = 80;
      const k = Math.min(3.5, Math.max(0.2, Math.min(
        cssW / (maxX - minX + pad * 2),
        cssH / (maxY - minY + pad * 2),
      )));
      view.k = k;
      view.x = cssW / 2 - ((minX + maxX) / 2) * k;
      view.y = cssH / 2 - ((minY + maxY) / 2) * k;
    };

    // Physics tick
    const tick = (_t: number) => {
      const a = Math.max(alpha, 0.015);
      // Repulsion
      for (let i = 0; i < sim.length; i++) {
        for (let j = i + 1; j < sim.length; j++) {
          const dx = sim[j].x - sim[i].x, dy = sim[j].y - sim[i].y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { d2 = 1; }
          const d = Math.sqrt(d2);
          const f = (REPULSION / d2) * a;
          sim[i].vx -= (dx / d) * f; sim[i].vy -= (dy / d) * f;
          sim[j].vx += (dx / d) * f; sim[j].vy += (dy / d) * f;
          // Collision
          const minDist = sim[i].radius + sim[j].radius + 6;
          if (d < minDist) {
            const push = (minDist - d) * 0.35;
            sim[i].vx -= (dx / d) * push; sim[i].vy -= (dy / d) * push;
            sim[j].vx += (dx / d) * push; sim[j].vy += (dy / d) * push;
          }
        }
      }
      // Springs (parent-child)
      for (const l of links) {
        const dx = l.target.x - l.source.x, dy = l.target.y - l.source.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = l.target.orbit + l.source.radius + l.target.radius;
        const f = (d - rest) * SPRING * a;
        l.target.vx -= (dx / d) * f; l.target.vy -= (dy / d) * f;
        l.source.vx += (dx / d) * f * 0.3; // parent moves less
        l.source.vy += (dy / d) * f * 0.3;
      }
      for (const n of sim) {
        const parent = n.parentId ? byId.get(n.parentId) : null;
        if (parent) {
          // Hold the node on its orbit shell around the parent, rather than
          // pulling it into the parent's centre. The old version targeted the
          // parent's exact position, so this force fought the spring and won
          // near equilibrium — every child ended up sitting on top of its
          // parent. Now it only corrects the radial error, in either
          // direction, and leaves the angle to repulsion.
          const dx = n.x - parent.x, dy = n.y - parent.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const shell = n.orbit + parent.radius + n.radius;
          const pull = (d - shell) * GRAVITY * a * 0.3;
          n.vx -= (dx / d) * pull;
          n.vy -= (dy / d) * pull;
        } else {
          n.vx += (0 - n.x) * GRAVITY * a * 0.3;
          n.vy += (0 - n.y) * GRAVITY * a * 0.3;
        }
        if (n === dragged) { n.vx = 0; n.vy = 0; continue; }
        n.vx *= DAMPING; n.vy *= DAMPING;
        n.x += n.vx; n.y += n.vy;
      }
      if (root) { root.x = 0; root.y = 0; root.vx = 0; root.vy = 0; }
      alpha += (alphaTarget - alpha) * ALPHA_DECAY;
    };

    // Warm up
    for (let i = 0; i < WARMUP_TICKS; i++) tick(i * 16);
    resize();
    ro.observe(wrap);

    // Draw
    const hexToRgb = (hex: string): [number, number, number] => {
      const v = parseInt(hex.slice(1), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.k, view.k);

      const focus = dragged || hovered;
      const focusNeighbors = focus ? neighborMap.get(focus.id) || new Set() : null;

      // Edges
      ctx.lineWidth = 0.8 / view.k;
      for (const l of links) {
        const isFocusEdge = focus && (l.source === focus || l.target === focus);
        const isDim = focus && !isFocusEdge;
        if (isDim) continue;
        ctx.beginPath();
        ctx.moveTo(l.source.x, l.source.y);
        ctx.lineTo(l.target.x, l.target.y);
        if (isFocusEdge) {
          ctx.strokeStyle = l.target.color + "88";
          ctx.lineWidth = 1.5 / view.k;
        } else {
          ctx.strokeStyle = l.target.color + "33";
        }
        ctx.stroke();
      }

      // Connecting line (reconnect mode)
      const connChild = reconnectRef.current.active && reconnectRef.current.nodeId
        ? byId.get(reconnectRef.current.nodeId) ?? null
        : null;
      if (connChild) {
        ctx.beginPath();
        ctx.moveTo(connChild.x, connChild.y);
        if (hovered && hovered.level === connChild.level - 1) {
          ctx.lineTo(hovered.x, hovered.y);
          ctx.strokeStyle = connChild.color + "aa";
        } else {
          ctx.strokeStyle = "rgba(255,255,255,0.15)";
        }
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5 / view.k;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Nodes
      for (const n of sim) {
        const isFocus = n === focus;
        const isNeighbor = focusNeighbors?.has(n.id);
        const isSelected = n === selected;
        const dim = focus && !isFocus && !isNeighbor;
        const targetScale = isFocus ? 1.6 : 1;
        n.hoverScale += (targetScale - n.hoverScale) * 0.18;

        const r = n.radius * n.hoverScale;
        const [cr, cg, cb] = hexToRgb(n.color);
        // Ghosts stand for a category the brand hasn't filled yet, so they stay
        // faint even when nothing else is dimmed — present as a suggestion,
        // never mistakable for a real node.
        const coreAlpha = dim ? 0.25 : n.orphan ? 0.5 : 1;

        // Halo
        const haloAlpha = isFocus ? 0.35 : isNeighbor ? 0.15 : 0.04;
        if (haloAlpha > 0.01) {
          const haloR = r * (isFocus ? 2.5 : 1.9);
          const halo = ctx.createRadialGradient(n.x, n.y, r * 0.7, n.x, n.y, haloR);
          halo.addColorStop(0, `rgba(${cr},${cg},${cb},${haloAlpha})`);
          halo.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = halo;
          ctx.beginPath(); ctx.arc(n.x, n.y, haloR, 0, Math.PI * 2); ctx.fill();
        }

        // Body
        const body = ctx.createRadialGradient(n.x - r * 0.3, n.y - r * 0.35, r * 0.1, n.x, n.y, r);
        body.addColorStop(0, `rgba(${Math.min(255, cr + 110)},${Math.min(255, cg + 110)},${Math.min(255, cb + 110)},${coreAlpha})`);
        body.addColorStop(0.55, `rgba(${cr},${cg},${cb},${coreAlpha})`);
        body.addColorStop(1, `rgba(${Math.round(cr * 0.55)},${Math.round(cg * 0.55)},${Math.round(cb * 0.55)},${coreAlpha})`);
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 1 / view.k;
        // Set every frame (including the empty case) so the dash never leaks
        // from an orphan onto the nodes drawn after it.
        ctx.setLineDash(n.orphan ? [3 / view.k, 3 / view.k] : []);
        ctx.strokeStyle = isSelected ? "#ffffff" : `rgba(255,255,255,${dim ? 0.05 : n.orphan ? 0.45 : 0.22})`;
        ctx.stroke();

        // Obsidian badge
        if (n.obsidianLink && !dim) {
          const bx = n.x + r * 0.7, by = n.y - r * 0.7;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath(); ctx.arc(bx, by, 3.5 / view.k, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.font = `${6 / view.k}px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText("◆", bx, by + 2.5 / view.k);
        }

        // Label
        const hasLabel = n.level <= 2 || isFocus || isNeighbor || isSelected;
        if (hasLabel && n.name) {
          const label = n.name.length > 15 ? n.name.slice(0, 14) + "…" : n.name;
          const ly = n.y + r + 14 / view.k;
          ctx.font = `${isFocus ? 12 : 10} / ${view.k}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = `rgba(8,10,16,${dim ? 0.3 : 0.7})`;
          ctx.fillText(label, n.x + 0.5 / view.k, ly + 0.5 / view.k);
          ctx.fillStyle = `rgba(226,232,240,${dim ? 0.2 : isFocus ? 1 : 0.85})`;
          ctx.fillText(label, n.x, ly);
        }
      }

      ctx.restore();
    };

    let lastStep = 0;
    const step = (t: number) => { lastStep = t; tick(t); draw(t); };
    const loop = (t: number) => { step(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);

    const watchdog = window.setInterval(() => {
      if (performance.now() - lastStep > 50) step(performance.now());
    }, 66);

    // ── Interaction ──
    const hitTest = (sx: number, sy: number): SimNode | null => {
      const w = toWorld(sx, sy);
      let best: SimNode | null = null, bestD = Infinity;
      for (const n of sim) {
        const dx = w.x - n.x, dy = w.y - n.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < n.radius * n.hoverScale + 8 / view.k && d < bestD) {
          best = n; bestD = d;
        }
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

      // Handle reconnect mode: find the connecting child from the ref
      if (reconnectRef.current.active && reconnectRef.current.nodeId) {
        const connChild = byId.get(reconnectRef.current.nodeId);
        if (connChild) {
          const hit = hitTest(p.x, p.y);
          if (hit && hit.level === connChild.level - 1 && hit.kind === "brand") {
            const tplId = connChild.templateId;
            const brandId = hit.id;
            if (tplId && brandId) {
              callMcp("apply_brand_to_template", { templateId: tplId, brandId })
                .then(() => {
                  setInfoMsg("Template reasignado a " + hit.name);
                  setTimeout(() => setInfoMsg(""), 2500);
                });
            }
          }
          setReconnectMode(false);
          return;
        }
      }

      const hit = hitTest(p.x, p.y);
      if (hit) {
        selected = hit;
        dragged = hit;
        alphaTarget = 0.3; alpha = Math.max(alpha, 0.3);
        canvas.style.cursor = "grabbing";
        // A plain click opens the side card too; it used to need a right-click,
        // which is not discoverable and made orphans look inert.
        let bn = "";
        let bid = hit.kind === "brand" ? hit.id : "";
        let cur = hit.parentId;
        while (cur) {
          const par = byId.get(cur);
          if (par?.kind === "brand") { bn = par.name; if (!bid) bid = par.id; break; }
          cur = par?.parentId || null;
        }
        setSelectedNode({
          id: hit.id, name: hit.name, kind: hit.kind, color: hit.color,
          templateId: hit.templateId, obsidianLink: hit.obsidianLink,
          campaign: hit.campaign, brandName: bn, brandId: bid,
          noteKind: hit.noteKind, noteSlug: hit.noteSlug,
          personaIndex: hit.personaIndex, orphan: hit.orphan,
        });
        setContextMenu(null);
      } else {
        selected = null;
        setSelectedNode(null);
        panning = true;
        userMovedView = true;
        downView = { x: view.x, y: view.y };
        canvas.style.cursor = "grabbing";
      }
      ev.preventDefault();
    };

    const onMove = (ev: MouseEvent) => {
      const p = localXY(ev);
      if (dragged) {
        if (Math.abs(ev.clientX - downScreen.x) + Math.abs(ev.clientY - downScreen.y) > 4) moved = true;
        const w = toWorld(p.x, p.y);
        dragged.x = w.x; dragged.y = w.y;
        dragged.vx = 0; dragged.vy = 0;
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
      if (dragged) {
        dragged = null;
        alphaTarget = 0;
        if (!moved) {
          // v56: el click abre la ficha (drawer Second Brain) con las notas
          // MD. Abrir el editor de golpe era demasiado; «Abrir en editor»
          // vive dentro de la ficha.
          setDrawerOpen(true);
        }
      }
      panning = false;
      const p = localXY(ev);
      hovered = hitTest(p.x, p.y);
      canvas.style.cursor = hovered ? "pointer" : "grab";
    };

    const onLeave = () => {
      hovered = null;
      if (!dragged && !panning) canvas.style.cursor = "grab";
    };

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      userMovedView = true;
      const p = localXY(ev);
      const factor = Math.exp(-ev.deltaY * 0.0016);
      const k2 = Math.max(0.2, Math.min(3.5, view.k * factor));
      view.x = p.x - ((p.x - view.x) / view.k) * k2;
      view.y = p.y - ((p.y - view.y) / view.k) * k2;
      view.k = k2;
    };

    const onDblClick = (ev: MouseEvent) => {
      const p = localXY(ev);
      if (!hitTest(p.x, p.y)) { fitView(); userMovedView = false; }
    };

    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
      const p = localXY(ev);
      const hit = hitTest(p.x, p.y);
      if (hit) {
        // Find brand name from parent chain
        let brandName = "";
        let brandId = hit.kind === "brand" ? hit.id : "";
        let cursor = hit.parentId;
        while (cursor) {
          const parent = byId.get(cursor);
          if (parent?.kind === "brand") { brandName = parent.name; if (!brandId) brandId = parent.id; break; }
          cursor = parent?.parentId || null;
        }
        setSelectedNode({
          id: hit.id, name: hit.name, kind: hit.kind, color: hit.color,
          templateId: hit.templateId, obsidianLink: hit.obsidianLink,
          campaign: hit.campaign, brandName, brandId,
          noteKind: hit.noteKind, noteSlug: hit.noteSlug,
          personaIndex: hit.personaIndex, orphan: hit.orphan,
        });
        setContextMenu({ x: ev.clientX, y: ev.clientY });
      } else {
        setSelectedNode(null);
        setContextMenu(null);
      }
    };

    canvas.style.cursor = "grab";
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("contextmenu", onContextMenu);

    (window as any).__brandGraphProbe = {
      nodeCount: sim.length,
      brandCount: graph.brands.length,
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
      canvas.removeEventListener("contextmenu", onContextMenu);
      delete (window as any).__brandGraphProbe;
    };
  }, [graph]);

  // ── Render ──

  const brandCount = graph?.brands.length ?? 0;
  const empty = !loading && !error && brandCount === 0;

  /** Walks the whole tree (brands + orphans) looking for a note slug. */
  const findNodeBySlug = useCallback((slug: string) => {
    if (!graph) return null;
    const stack = [...graph.brands];
    while (stack.length) {
      const current = stack.pop() as BrandGraphNode | undefined;
      if (!current) break;
      if (current.noteSlug === slug) return current;
      if (current.children?.length) stack.push(...current.children);
    }
    for (const orphan of graph.orphans || []) {
      if (orphan.noteSlug === slug) return orphan;
    }
    return null;
  }, [graph]);

  /** [[wikilink]] click → abre la ficha del nodo con ese slug. */
  const navigateToSlug = useCallback((slug: string) => {
    const found = findNodeBySlug(slug);
    if (!found) {
      setInfoMsg(`La nota "${slug}" no tiene nodo en el grafo todavía — recarga para ver las ramas nuevas.`);
      return;
    }
    const brandId = /^(note|cat):/.test(found.id) ? found.id.split(":")[2] || "" : found.id;
    setSelectedNode({
      id: found.id, name: found.name, kind: found.kind, color: found.color || "#ffffff",
      templateId: found.templateId, obsidianLink: found.obsidianLink,
      campaign: found.campaign, orphan: found.orphan,
      brandId,
      noteKind: found.noteKind, noteSlug: found.noteSlug,
      personaIndex: found.personaIndex,
    });
    setDrawerOpen(true);
  }, [findNodeBySlug]);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      {loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#777", fontSize: 13 }}>
          Cargando Second Brain…
        </div>
      )}
      {!loading && error && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#fca5a5", fontSize: 13 }}>
          <span>No se pudo cargar el Second Brain.</span>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>{error}</span>
          <button onClick={fetchGraph} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.07)", color: "#fff", cursor: "pointer" }}>Reintentar</button>
        </div>
      )}
      {empty && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#777", fontSize: 13, gap: 8 }}>
          <span>No hay marcas para mostrar.</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Crea una marca desde el panel de Style Library.</span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        aria-label="Second Brain"
        style={{ position: "absolute", inset: 0, display: loading || error || empty ? "none" : "block" }}
      />
      {!loading && !error && brandCount > 0 && (
        <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 8, pointerEvents: "none" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", background: "rgba(8,10,16,0.8)", padding: "4px 12px", borderRadius: 100 }}>
            {brandCount} marcas · click: ficha y notas · doble-click reencuadra
          </span>
        </div>
      )}

      {/* ═══ v56 Second Brain: ficha del nodo en el InspectorDrawer (sin
          velo: el grafo sigue explorable detrás y otro click cambia la
          ficha; Esc o × la cierran). Sustituye a la vieja barra superior. ═══ */}
      {selectedNode && drawerOpen && (
        <GraphNodeDrawer
          node={selectedNode}
          brands={(graph?.brands || []).map((brand) => ({ id: brand.id, name: brand.name }))}
          workspaceId={workspaceId}
          onClose={() => { setDrawerOpen(false); setSelectedNode(null); setReconnectMode(false); }}
          onOpenTemplate={(templateId) => openRef.current?.(templateId)}
          onReconnect={() => { setReconnectMode(true); setDrawerOpen(false); }}
          onReassign={reassignToBrand}
          onDelete={(templateId) => { deleteTemplateNode(templateId); setDrawerOpen(false); setSelectedNode(null); }}
          onNavigateSlug={navigateToSlug}
        />
      )}

      {/* ═══ Context menu ═══ */}
      {contextMenu && selectedNode && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 99 }}
            onClick={() => { setContextMenu(null); }} />
          <div style={{
            position: "fixed", left: contextMenu.x, top: contextMenu.y,
            zIndex: 100, minWidth: 180,
            background: "rgba(18,20,28,0.98)", backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10,
            padding: "6px 0", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}>
            <div style={{ padding: "6px 14px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 4 }}>
              <span style={{ color: selectedNode.color, fontWeight: 600, fontSize: 13 }}>{selectedNode.name}</span>
              <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, marginLeft: 8 }}>{selectedNode.kind}</span>
            </div>
            {selectedNode.templateId && (
              <ContextMenuItem onClick={() => { openRef.current?.(selectedNode.templateId!); setContextMenu(null); }}>
                ↗ Abrir en editor
              </ContextMenuItem>
            )}
            {selectedNode.templateId && !reconnectMode && (
              <ContextMenuItem onClick={() => { setReconnectMode(true); setContextMenu(null); }}>
                🔗 Reconectar a otra marca
              </ContextMenuItem>
            )}
            {selectedNode.obsidianLink && (
              <ContextMenuItem onClick={() => { window.open(selectedNode.obsidianLink, "_blank", "noopener,noreferrer"); setContextMenu(null); }}>
                ◆ Abrir en Obsidian
              </ContextMenuItem>
            )}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "4px 0" }} />
            {selectedNode.templateId && (
              <ContextMenuItem danger onClick={() => { deleteTemplateNode(selectedNode.templateId!); setSelectedNode(null); setContextMenu(null); }}>
                🗑 Eliminar
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => setContextMenu(null)}>
              ✕ Cerrar
            </ContextMenuItem>
          </div>
        </>
      )}

      {/* ═══ Reconnect mode indicator ═══ */}
      {reconnectMode && selectedNode && (
        <div style={{
          position: "absolute", top: selectedNode ? 60 : 12, left: "50%", transform: "translateX(-50%)",
          padding: "6px 16px", borderRadius: 100,
          background: "rgba(255,180,3,0.18)", border: "1px solid rgba(255,180,3,0.4)",
          fontSize: 11, color: "#ffb703", zIndex: 8, pointerEvents: "none",
        }}>
          Haz click en una marca para reconectar "{selectedNode.name}"
        </div>
      )}

      {/* ═══ Info toast ═══ */}
      {infoMsg && (
        <div style={{
          position: "absolute", bottom: 48, left: "50%", transform: "translateX(-50%)",
          padding: "6px 18px", borderRadius: 100,
          background: "rgba(6,214,160,0.18)", border: "1px solid rgba(6,214,160,0.4)",
          fontSize: 12, color: "#06d6a0", zIndex: 12, pointerEvents: "none",
        }}>
          {infoMsg}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

/** v56 — etiqueta legible del tipo de nodo para la ficha. */
const GRAPH_KIND_LABELS: Record<string, string> = {
  workspace: "Workspace",
  brand: "Marca",
  category: "Categoría",
  template: "Template",
  asset: "Asset",
  frame: "Frame",
  note: "Second Brain",
};

/** Rama viva: la etiqueta sale del noteKind, no del kind genérico. */
const GRAPH_NOTE_LABELS: Record<string, string> = {
  marca: "Marca",
  ds: "Design System",
  plantillas: "Plantillas",
  archivos: "Archivos",
  crm: "CRM",
  estrategia: "Estrategia de Marca",
  copywriting: "Copywriting",
  persona: "Persona sintética",
  archivo: "Archivo",
};

type GraphNodeInfo = {
  id: string; name: string; kind: string; color: string;
  templateId?: string; obsidianLink?: string; campaign?: string;
  brandName?: string; brandId?: string;
  noteKind?: string; noteSlug?: string; personaIndex?: number;
  orphan?: boolean;
};

/**
 * Ficha del nodo del grafo (Second Brain, v61) en el InspectorDrawer sin
 * velo: la NOTA VIVA de la entidad en dos zonas — generada (se reconstruye
 * de las tablas fuente cada vez que abres) y humana (Markdown libre dentro
 * del bloque human, que ninguna regeneración toca). Los [[wikilinks]]
 * navegan el grafo; abajo viven los backlinks. Sirve para toda rama:
 * marca, CRM, Design System, Plantillas, Archivos, Estrategia, Copywriting,
 * personas y cada archivo.
 */
function GraphNodeDrawer({
  node,
  brands,
  workspaceId,
  onClose,
  onOpenTemplate,
  onReconnect,
  onReassign,
  onDelete,
  onNavigateSlug,
}: {
  node: GraphNodeInfo;
  brands: Array<{ id: string; name: string }>;
  workspaceId: string | null;
  onClose: () => void;
  onOpenTemplate: (templateId: string) => void;
  onReconnect: () => void;
  onReassign: (templateId: string, brandId: string) => void;
  onDelete: (templateId: string) => void;
  onNavigateSlug: (slug: string) => void;
}) {
  type EntityNoteResponse = {
    note: { slug: string; title: string; bodyMd: string } | null;
    backlinks: Array<{ slug: string; title: string }>;
    slug: string;
  };
  const [noteData, setNoteData] = useState<EntityNoteResponse | null>(null);
  const [noteError, setNoteError] = useState("");
  const [loadingNote, setLoadingNote] = useState(false);
  const [editingHuman, setEditingHuman] = useState(false);
  const [humanDraft, setHumanDraft] = useState("");
  const [savingHuman, setSavingHuman] = useState(false);
  const kindLabel = GRAPH_NOTE_LABELS[node.noteKind || ""] || GRAPH_KIND_LABELS[node.kind] || node.kind;

  // Lazy vault: leer REGENERA la nota desde las tablas fuente (idempotente)
  // y la crea si todavía no existe. Lo humano siempre sobrevive.
  useEffect(() => {
    setEditingHuman(false);
    setNoteError("");
    if (!workspaceId || !node.noteKind
      || (node.noteKind === "archivo" ? !node.templateId : !node.brandId)) {
      setNoteData(null);
      return;
    }
    let cancelled = false;
    setLoadingNote(true);
    const params = new URLSearchParams({
      workspaceId,
      kind: node.noteKind!,
      ...(node.noteKind === "archivo"
        ? { templateId: node.templateId! }
        : { brandId: node.brandId! }),
      ...(node.noteKind === "persona" ? { personaIndex: String(node.personaIndex ?? 0) } : {}),
    });
    apiFetch<{ success: boolean; data?: EntityNoteResponse }>(`/api/brain-notes/entity?${params}`)
      .then((res) => { if (!cancelled) setNoteData(res.data ?? null); })
      .catch((e) => { if (!cancelled) setNoteError(e instanceof Error ? e.message : "No se pudo cargar la nota viva."); })
      .finally(() => { if (!cancelled) setLoadingNote(false); });
    return () => { cancelled = true; };
  }, [workspaceId, node.noteKind, node.brandId, node.templateId, node.personaIndex]);

  const zones = splitNoteZones(noteData?.note?.bodyMd || "");
  const humanSlug = noteData?.slug || node.noteSlug || "";

  const saveHuman = async () => {
    if (!workspaceId || !humanSlug) return;
    setSavingHuman(true);
    setNoteError("");
    try {
      const res = await apiFetch<{ success: boolean; data?: { note: EntityNoteResponse["note"] } }>(
        `/api/brain-notes/${encodeURIComponent(humanSlug)}/human`,
        { method: "PUT", body: JSON.stringify({ workspaceId, humanMd: humanDraft }) },
      );
      setNoteData((prev) => (prev ? { ...prev, note: res.data?.note ?? prev.note } : prev));
      setEditingHuman(false);
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : "No se pudo guardar tu markdown.");
    } finally {
      setSavingHuman(false);
    }
  };

  return (
    <InspectorDrawer
      open
      onClose={onClose}
      ariaLabel={`Ficha de ${node.name}`}
      storageKey="graph-node-drawer-width"
      veil={false}
      eyebrow={
        <>
          <span style={{ color: node.color }} aria-hidden="true">●</span>
          {" "}{kindLabel}
          {node.brandName && node.kind !== "brand" && !node.orphan ? ` · ${node.brandName}` : ""}
          {node.orphan ? " · sin marca asignada" : ""}
        </>
      }
      title={node.name}
      actions={
        node.templateId ? (
          <button type="button" className="workspace-button secondary" onClick={() => onOpenTemplate(node.templateId!)}>Abrir en editor</button>
        ) : undefined
      }
    >
      <div className="graph-node-notes">
        {node.campaign && <p className="graph-node-meta">Campaña: {node.campaign}</p>}
        {node.obsidianLink && (
          <p className="graph-node-meta">
            <a href={node.obsidianLink} target="_blank" rel="noopener noreferrer">Abrir en Obsidian ↗</a>
          </p>
        )}
        {!workspaceId || !node.noteKind ? (
          <p className="workspace-muted">Esta rama se organiza desde su marca: marca, CRM, Design System, Plantillas, Archivos, Estrategia, Copywriting y cada archivo abren su nota viva aquí.</p>
        ) : loadingNote ? (
          <p className="workspace-muted">Generando nota viva desde la plataforma…</p>
        ) : (
          <>
            {noteError && <p className="graph-notes-error" role="alert">{noteError}</p>}
            {noteData?.note && zones.generated && (
              <section className="graph-note-zone">
                <div className="graph-notes-head">
                  <h4>Nota <span>auto · regenerada de la plataforma</span></h4>
                </div>
                <div className="md-view">{renderMarkdown(zones.generated, onNavigateSlug)}</div>
              </section>
            )}
            {noteData?.note && zones.agent && (
              <section className="graph-note-zone">
                <div className="graph-notes-head">
                  <h4>Análisis <span>IA</span></h4>
                </div>
                <div className="md-view">{renderMarkdown(zones.agent, onNavigateSlug)}</div>
              </section>
            )}
            <section className="graph-note-zone">
              <div className="graph-notes-head">
                <h4>Tu markdown <span>humano · protegido</span></h4>
                {!editingHuman && (
                  <button type="button" className="workspace-link" onClick={() => { setHumanDraft(zones.human); setEditingHuman(true); }}>
                    {zones.human ? "Editar" : "Escribir"}
                  </button>
                )}
              </div>
              {editingHuman ? (
                <div className="graph-notes-editor">
                  <textarea
                    rows={10}
                    value={humanDraft}
                    onChange={(event) => setHumanDraft(event.target.value)}
                    aria-label="Tu markdown"
                    autoFocus
                    placeholder={"Markdown libre: briefs, decisiones, contexto del cliente…\n\nVive en tu bloque human — ninguna regeneración lo borra."}
                  />
                  <div className="graph-notes-actions">
                    <button type="button" className="workspace-button" disabled={savingHuman} onClick={() => void saveHuman()}>{savingHuman ? "Guardando…" : "Guardar"}</button>
                    <button type="button" className="workspace-button secondary" onClick={() => { setEditingHuman(false); setNoteError(""); }}>Cancelar</button>
                  </div>
                </div>
              ) : zones.human ? (
                <div className="md-view">{renderMarkdown(zones.human, onNavigateSlug)}</div>
              ) : (
                <p className="workspace-muted">Escribe aquí lo tuyo: briefs, decisiones, contexto. Es tu zona Markdown y sobrevive a cada regeneración de la nota.</p>
              )}
            </section>
            {noteData?.backlinks?.length ? (
              <section className="graph-note-zone">
                <div className="graph-notes-head">
                  <h4>Enlazan aquí <span>backlinks</span></h4>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {noteData.backlinks.map((backlink) => (
                    <button key={backlink.slug} type="button" className="workspace-button secondary" onClick={() => onNavigateSlug(backlink.slug)}>
                      {backlink.title || backlink.slug}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
        {node.templateId && (
          <div className="graph-node-actions">
            <label className="graph-node-reassign">
              <span>Asignar a marca</span>
              <select value="" onChange={(event) => { if (event.target.value) onReassign(node.templateId!, event.target.value); }}>
                <option value="">Elegir marca…</option>
                {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
              </select>
            </label>
            <button type="button" className="workspace-button secondary" onClick={onReconnect}>Reconectar a otra marca</button>
            <button type="button" className="workspace-button danger" onClick={() => onDelete(node.templateId!)}>Eliminar</button>
          </div>
        )}
      </div>
    </InspectorDrawer>
  );
}

function ContextMenuItem({ onClick, children, danger }: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "7px 14px", cursor: "pointer", fontSize: 12,
        color: danger ? "#ff4b72" : "rgba(255,255,255,0.8)",
        transition: "background 0.1s",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.06)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      {children}
    </div>
  );
}
