/**
 * videoProjectStore — fuente de verdad del editor de video standalone
 * (REQ-VID11). Espejo de videoDocStore (template Video Mode) pero con el doc
 * viviendo en las tablas musa_video_* vía la REST /api/video-projects.
 *
 * · Undo/redo POR OPERACIÓN SEMÁNTICA: snapshots before/after del doc con
 *   coalescing explícito (drags emiten con coalesceKey `gesto:segmento`) y
 *   ventana de gracia para toques repetidos del mismo segmento. El journal
 *   persiste en localStorage por projectId y se reconcilia contra el doc del
 *   server al cargar (se descartan comandos cuyo "after" ya no coincide).
 * · El doc está NORMALIZADO (sin timestamps ni duration_us derivado): hace
 *   estables los snapshots y el diff de autosave.
 * · Autosave: tras 600 ms de quietud, diffTreeOps(lastSaved → doc) se ejecuta
 *   en orden (materials → tracks → segments) contra la REST. Los adds llegan
 *   al store YA con id real (el POST resuelve antes del apply), así el undo
 *   de un delete re-crea el MISMO id (los add* del service aceptan id
 *   explícito con prefijo válido).
 * · Integración React: useSyncExternalStore(store.subscribe, store.getSnapshot)
 *   (mismo patrón que documentStore/videoDocStore).
 */

import { apiFetch } from "./supabase";
import { diffTreeOps, type VideoSaveOp } from "./videoTimelineMath";

// ── Tipos (filas snake_case tal como las devuelve la API) ───────────────────

export interface VideoProjectDocProject {
  id: string;
  workspace_id: string;
  name: string;
  fps: number;
  canvas_w: number;
  canvas_h: number;
  ratio: string;
  is_template: boolean;
}

export interface VideoSegment {
  id: string;
  track_id: string;
  material_id: string;
  target_start_us: number;
  target_dur_us: number;
  source_start_us: number | null;
  source_dur_us: number | null;
  speed: number;
  clip: Record<string, unknown> | null;
  extra_refs: string[];
}

export interface VideoTrack {
  id: string;
  project_id: string;
  type: string;
  z_order: number;
  segments: VideoSegment[];
}

export interface VideoMaterial {
  id: string;
  project_id: string;
  kind: string;
  payload: Record<string, unknown>;
  slot: Record<string, unknown> | null;
}

export interface VideoProjectDoc {
  project: VideoProjectDocProject;
  tracks: VideoTrack[];
  materials: VideoMaterial[];
}

export type SaveStatus = "idle" | "pending" | "saving" | "error";

export interface SaveState {
  status: SaveStatus;
  error: string | null;
}

// ── Normalización ───────────────────────────────────────────────────────────

/** Doc canónico: quita campos volátiles/derivados para que los snapshots del
 *  journal y el diff de autosave sean estables entre loads. */
export function normalizeTree(raw: any): VideoProjectDoc {
  const segments: VideoSegment[] = (raw.tracks ?? []).flatMap((t: any) => (t.segments ?? []).map((s: any) => ({
    id: String(s.id),
    track_id: String(s.track_id),
    material_id: String(s.material_id),
    target_start_us: Number(s.target_start_us),
    target_dur_us: Number(s.target_dur_us),
    source_start_us: s.source_start_us === null || s.source_start_us === undefined ? null : Number(s.source_start_us),
    source_dur_us: s.source_dur_us === null || s.source_dur_us === undefined ? null : Number(s.source_dur_us),
    speed: Number(s.speed) || 1,
    clip: (s.clip ?? null) as Record<string, unknown> | null,
    extra_refs: Array.isArray(s.extra_refs) ? s.extra_refs.map(String) : [],
  })));
  return {
    project: {
      id: String(raw.project.id),
      workspace_id: String(raw.project.workspace_id),
      name: String(raw.project.name),
      fps: Number(raw.project.fps) || 30,
      canvas_w: Number(raw.project.canvas_w) || 1080,
      canvas_h: Number(raw.project.canvas_h) || 1920,
      ratio: String(raw.project.ratio ?? "9:16"),
      is_template: Boolean(raw.project.is_template),
    },
    // z_order ascendente = de abajo hacia arriba (CapCut); el timeline pinta
    // la capa superior arriba, así que la fila visual invierte el orden.
    tracks: (raw.tracks ?? []).map((t: any) => ({
      id: String(t.id),
      project_id: String(t.project_id),
      type: String(t.type),
      z_order: Number(t.z_order) || 0,
      segments: segments.filter((s) => s.track_id === String(t.id))
        .sort((a, b) => a.target_start_us - b.target_start_us),
    })),
    materials: (raw.materials ?? []).map((m: any) => ({
      id: String(m.id),
      project_id: String(m.project_id),
      kind: String(m.kind),
      payload: (m.payload ?? {}) as Record<string, unknown>,
      slot: (m.slot ?? null) as Record<string, unknown> | null,
    })).sort((a: VideoMaterial, b: VideoMaterial) => a.id.localeCompare(b.id)),
  };
}

// ── Journal ─────────────────────────────────────────────────────────────────

export interface VideoApplyMeta {
  label?: string;
  coalesceKey?: string;
}

interface JournalCommand {
  label: string;
  at: number;
  key: string | null;
  /** Firma de toque implícita ("" cuando hay key explícita). */
  touch: string;
  before: string;
  after: string;
}

const MAX_COMMANDS = 40;
const COALESCE_WINDOW_MS = 700;
const AUTOSAVE_DEBOUNCE_MS = 600;

const journalKeyFor = (projectId: string) => `musa:videoProjectJournal:${projectId}`;

function touchSignature(prev: VideoProjectDoc, next: VideoProjectDoc): string {
  const pa = prev.tracks.flatMap((t) => t.segments);
  const na = next.tracks.flatMap((t) => t.segments);
  if (pa.length !== na.length) return "multi";
  const changedSegs = pa.filter((s, i) => JSON.stringify(s) !== JSON.stringify(na[i]));
  if (changedSegs.length !== 1) return changedSegs.length > 1 ? "multi" : "";
  const prevById = new Map(pa.map((s) => [s.id, s]));
  return prevById.has(changedSegs[0].id) ? `seg:${changedSegs[0].id}` : "multi";
}

// ── Store ───────────────────────────────────────────────────────────────────

type Listener = () => void;

export class VideoProjectStore {
  private _doc: VideoProjectDoc;
  private _projectId = "";
  private _lastSaved: VideoProjectDoc | null = null;
  private _undo: JournalCommand[] = [];
  private _redo: JournalCommand[] = [];
  private _listeners = new Set<Listener>();
  private _saveState: SaveState = { status: "idle", error: null };
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _saveChain: Promise<void> = Promise.resolve();
  private _warnedOrphans = new Set<string>();

  constructor(initial: VideoProjectDoc) {
    this._doc = initial;
    this._lastSaved = initial;
  }

  // ── Lectura ──

  getSnapshot = (): VideoProjectDoc => this._doc;
  getSaveSnapshot = (): SaveState => this._saveState;
  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  };
  get canUndo(): boolean { return this._undo.length > 0; }
  get canRedo(): boolean { return this._redo.length > 0; }
  get undoLabel(): string | null { return this._undo.length ? this._undo[this._undo.length - 1].label : null; }
  get redoLabel(): string | null { return this._redo.length ? this._redo[this._redo.length - 1].label : null; }

  // ── Baseline ──

  /** Apunta el store a un project: baseline + journal reconciliado. Silencioso
   *  (React aún no monta) y SIN autoguardado del baseline. */
  syncFromServer(tree: VideoProjectDoc): void {
    this._projectId = tree.project.id;
    this._doc = tree;
    this._lastSaved = tree;
    this._undo = this._loadJournal();
    const docJson = JSON.stringify(tree);
    while (this._undo.length > 0 && this._undo[this._undo.length - 1].after !== docJson) {
      this._undo.pop();
    }
    this._redo = [];
    this._saveState = { status: "idle", error: null };
    this._persist();
  }

  // ── Escritura ──

  /** Commit del siguiente estado como comando undoable. No-op si no cambió. */
  apply(next: VideoProjectDoc, meta: VideoApplyMeta = {}): void {
    const prev = this._doc;
    const beforeJson = JSON.stringify(prev);
    const afterJson = JSON.stringify(next);
    if (beforeJson === afterJson) return;

    const explicitKey = meta.coalesceKey ?? null;
    const touch = explicitKey ? "" : touchSignature(prev, next);
    const now = Date.now();
    const top = this._undo[this._undo.length - 1];
    const canMerge = top !== undefined && this._redo.length === 0 && (
      explicitKey !== null
        ? top.key !== null && top.key === explicitKey
        : top.key === null && touch !== "" && touch !== "multi"
          && top.touch === touch && now - top.at < COALESCE_WINDOW_MS
    );

    if (canMerge) {
      top.after = afterJson;
      top.at = now;
    } else {
      this._undo.push({
        label: meta.label || "editar timeline",
        at: now,
        key: explicitKey,
        touch,
        before: beforeJson,
        after: afterJson,
      });
      if (this._undo.length > MAX_COMMANDS) this._undo.shift();
      this._redo = [];
    }

    this._doc = next;
    this._schedulePersist();
    this._scheduleSave();
    this._notify();
  }

  undo(): boolean {
    const cmd = this._undo.pop();
    if (!cmd) return false;
    let doc: VideoProjectDoc;
    try {
      doc = JSON.parse(cmd.before) as VideoProjectDoc;
    } catch {
      this._undo.push(cmd);
      return false;
    }
    this._redo.push(cmd);
    this._doc = doc;
    this._schedulePersist();
    this._scheduleSave();
    this._notify();
    return true;
  }

  redo(): boolean {
    const cmd = this._redo.pop();
    if (!cmd) return false;
    let doc: VideoProjectDoc;
    try {
      doc = JSON.parse(cmd.after) as VideoProjectDoc;
    } catch {
      this._redo.push(cmd);
      return false;
    }
    this._undo.push(cmd);
    this._doc = doc;
    this._schedulePersist();
    this._scheduleSave();
    this._notify();
    return true;
  }

  // ── Autosave (diffTreeOps → REST, coalescedo y serial) ──

  private _scheduleSave(): void {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveState = { status: "pending", error: null };
    this._notify();
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveChain = this._saveChain.then(() => this._runSave()).catch(() => { /* _runSave ya maneja */ });
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private async _runSave(): Promise<void> {
    if (!this._projectId || !this._lastSaved) return;
    let ops = diffTreeOps(this._lastSaved, this._doc);
    if (ops.length === 0) {
      this._lastSaved = this._doc;
      if (this._saveState.status !== "idle") {
        this._saveState = { status: "idle", error: null };
        this._notify();
      }
      return;
    }
    this._saveState = { status: "saving", error: null };
    this._notify();
    const base = this._projectId;
    for (;;) {
      const target = this._doc;
      try {
        for (const op of ops) {
          await this._execOp(base, op);
        }
      } catch (cause) {
        this._saveState = {
          status: "error",
          error: cause instanceof Error ? cause.message : "No se pudo guardar el timeline",
        };
        this._notify();
        return; // reintento con el próximo cambio del usuario
      }
      if (this._doc === target) {
        this._lastSaved = target;
        this._saveState = { status: "idle", error: null };
        this._notify();
        return;
      }
      // Llegaron cambios durante el guardado: otra pasada hacia el doc vivo.
      ops = diffTreeOps(this._lastSaved, this._doc);
      if (ops.length === 0) {
        this._lastSaved = this._doc;
        this._saveState = { status: "idle", error: null };
        this._notify();
        return;
      }
    }
  }

  private async _execOp(projectId: string, op: VideoSaveOp): Promise<void> {
    const pid = encodeURIComponent(projectId);
    if (op.type === "material.add") {
      await apiFetch(`/api/video-projects/${pid}/materials`, { method: "POST", body: JSON.stringify(op.body) });
      return;
    }
    if (op.type === "material.patch") {
      await apiFetch(`/api/video-projects/${pid}/materials/${encodeURIComponent(op.materialId)}`, { method: "PATCH", body: JSON.stringify(op.body) });
      return;
    }
    if (op.type === "track.add") {
      await apiFetch(`/api/video-projects/${pid}/tracks`, { method: "POST", body: JSON.stringify(op.body) });
      return;
    }
    if (op.type === "segment.add") {
      await apiFetch(`/api/video-projects/${pid}/segments`, { method: "POST", body: JSON.stringify(op.body) });
      return;
    }
    if (op.type === "segment.patch") {
      await apiFetch(`/api/video-projects/${pid}/segments/${encodeURIComponent(op.segmentId)}`, { method: "PATCH", body: JSON.stringify(op.body) });
      return;
    }
    await apiFetch(`/api/video-projects/${pid}/segments/${encodeURIComponent(op.segmentId)}`, { method: "DELETE" });
  }

  /** Server-first (VID12/14): el caller ya persistió TODOS los cambios de
   *  `tree` vía REST (POST de material/segmento/efecto) y los aplicó al doc.
   *  Absorbe el árbol como baseline para que el autosave NO re-POSTee esas
   *  filas (fallarían por id duplicado). Si el doc vivo ya cambió (edita
   *  entre medio), no hace nada: gana el diff normal. */
  absorbSaved(tree: VideoProjectDoc): void {
    if (JSON.stringify(this._doc) !== JSON.stringify(tree)) return;
    this._lastSaved = tree;
  }

  /** Aviso único por entidad huérfana (undo de track/material sin endpoint). */
  warnOrphanOnce(key: string): void {
    if (this._warnedOrphans.has(key)) return;
    this._warnedOrphans.add(key);
    console.warn(`[videoProjectStore] ${key} quedó como huérfano en el server (undo sin endpoint de borrado). El reload lo vuelve a mostrar.`);
  }

  /** Tracks/materials de la línea base ausentes en el doc actual: el undo de
   *  su add no tiene endpoint de borrado y deja la fila en el server. */
  missingBaselineEntities(): string[] {
    if (!this._lastSaved) return [];
    const keys: string[] = [];
    const docTracks = new Set(this._doc.tracks.map((t) => t.id));
    for (const t of this._lastSaved.tracks) {
      if (!docTracks.has(t.id)) keys.push(`track ${t.id}`);
    }
    const docMaterials = new Set(this._doc.materials.map((m) => m.id));
    for (const m of this._lastSaved.materials) {
      if (!docMaterials.has(m.id)) keys.push(`material ${m.id}`);
    }
    return keys;
  }

  // ── Persistencia del journal ──

  private _loadJournal(): JournalCommand[] {
    if (!this._projectId || typeof localStorage === "undefined") return [];
    try {
      const raw = localStorage.getItem(journalKeyFor(this._projectId));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { v?: number; cmds?: JournalCommand[] };
      if (parsed?.v !== 1 || !Array.isArray(parsed.cmds)) return [];
      return parsed.cmds.filter((c) => typeof c?.label === "string" && typeof c?.before === "string" && typeof c?.after === "string")
        .map((c) => ({ ...c, touch: typeof c.touch === "string" ? c.touch : "" }))
        .slice(-MAX_COMMANDS);
    } catch {
      return [];
    }
  }

  private _schedulePersist(): void {
    // El journal comparte el mismo timer de autosave: un solo tick posterior
    // a la quietud persiste y guarda — menos churn en storage.
    if (!this._saveTimer) this._scheduleSave();
  }

  private _persist(): void {
    if (!this._projectId || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(journalKeyFor(this._projectId), JSON.stringify({ v: 1, cmds: this._undo.slice(-MAX_COMMANDS) }));
    } catch { /* storage bloqueado — el undo en sesión sigue funcionando */ }
  }

  private _notify(): void {
    for (const listener of this._listeners) listener();
  }
}
