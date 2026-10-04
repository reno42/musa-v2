/**
 * videoDocStore — transactional source of truth for the Video Mode timeline
 * document (REQ-035 RF-02/RF-08, Fase 1.1).
 *
 * Every mutation of `videoTimelineDoc` (audioClips / mediaClips / textClips /
 * project) flows through apply(), which records an undoable command with a
 * human label. Undo/redo is PER SEMANTIC OPERATION, not per pointermove:
 * bursts that touch the same clip merge into the top command (explicit
 * `coalesceKey`, or implicit same-clip signature within COALESCE_WINDOW_MS —
 * drags emit on every pointermove and must undo as one).
 *
 * The journal PERSISTS per template in localStorage, so after a reload the
 * editor still can undo the last operations (acceptance: "Recargar el editor
 * conserva el documento y permite deshacer la última operación"). The doc
 * itself keeps riding templates.data JSONB via the existing autosave; the
 * journal only stores full before/after snapshots (the doc is tiny — URLs and
 * numbers, never binaries), which makes reload reconciliation trivial: drop
 * trailing commands whose "after" no longer matches the persisted doc.
 *
 * React integration mirrors documentStore: useSyncExternalStore(
 *   store.subscribe, store.getSnapshot).
 */

import {
  type VideoTimelineDoc,
  emptyVideoTimelineDoc,
} from "./videoTimelineDoc";

// ── Types ──

export interface VideoDocApplyMeta {
  /** Human-readable label for the undo stack ("añadir audio"). */
  label?: string;
  /** Consecutive applies with the same key merge into one command. */
  coalesceKey?: string;
}

interface JournalCommand {
  label: string;
  at: number;
  /** Explicit coalesce key, if the caller provided one. */
  key: string | null;
  /** Implicit merge signature ("" when the caller passed an explicit key). */
  touch: string;
  /** Full doc snapshots (JSON) — undo/redo is a parse, never a diff. */
  before: string;
  after: string;
}

type JournalListener = () => void;

const MAX_COMMANDS = 40;
const MAX_JOURNAL_BYTES = 256_000;
/** Pointermove bursts arrive every ~16ms; a new gesture on the same clip
 *  after this quiet window starts a NEW undoable command. */
const COALESCE_WINDOW_MS = 700;

const journalKeyFor = (templateId: string) => `musa:videoJournal:${templateId}`;

/** Which clip(s) an apply touched — the implicit merge signature. Multi-clip
 *  ops (split, project changes) never merge implicitly. */
function touchSignature(prev: VideoTimelineDoc, next: VideoTimelineDoc): string {
  const diffIds = (
    a: Array<{ id: string }>, b: Array<{ id: string }>,
  ): boolean => {
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return true;
    return false;
  };
  const parts: string[] = [];
  if (diffIds(prev.audioClips, next.audioClips)) return "multi";
  if (diffIds(prev.mediaClips, next.mediaClips)) return "multi";
  if (diffIds(prev.textClips, next.textClips)) return "multi";
  const changed = (a: Array<{ id: string }>, b: Array<{ id: string }>, kind: string): boolean => {
    for (let i = 0; i < a.length; i++) {
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) { parts.push(`${kind}:${a[i].id}`); }
    }
    return parts.length > 0;
  };
  let touched = false;
  touched = changed(prev.audioClips, next.audioClips, "audio") || touched;
  touched = changed(prev.mediaClips, next.mediaClips, "media") || touched;
  touched = changed(prev.textClips, next.textClips, "text") || touched;
  if (JSON.stringify(prev.project) !== JSON.stringify(next.project)) parts.push("project");
  if (parts.length !== 1) return touched || parts.length > 1 ? "multi" : "";
  return parts[0];
}

// ── Store ──

export class VideoDocStore {
  private _doc: VideoTimelineDoc;
  private _templateId = "";
  private _undo: JournalCommand[] = [];
  private _redo: JournalCommand[] = [];
  private _listeners = new Set<JournalListener>();
  private _persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(initial: VideoTimelineDoc = emptyVideoTimelineDoc()) {
    this._doc = initial;
  }

  // ── Read ──

  getSnapshot = (): VideoTimelineDoc => this._doc;

  subscribe = (listener: JournalListener): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  };

  get canUndo(): boolean { return this._undo.length > 0; }
  get canRedo(): boolean { return this._redo.length > 0; }
  get undoLabel(): string | null { return this._undo.length ? this._undo[this._undo.length - 1].label : null; }
  get redoLabel(): string | null { return this._redo.length ? this._redo[this._redo.length - 1].label : null; }

  // ── Baseline / reload ──

  /**
   * Point the store at a template: loads its persisted journal and reconciles
   * it against the freshly-loaded doc, then installs the doc as baseline.
   * Silent: no notify (React hasn't mounted the mode yet), no journal entry,
   * no persistence churn.
   */
  syncFromTemplate(templateId: string, doc: VideoTimelineDoc): void {
    this._templateId = templateId;
    this._doc = doc;
    this._undo = this._loadJournal();
    // Trailing commands whose result doesn't match the persisted doc are
    // stale (autosave lagged, or the doc was edited elsewhere) — dropping
    // them loses undo depth honestly instead of corrupting state on undo.
    const docJson = JSON.stringify(doc);
    while (this._undo.length > 0 && this._undo[this._undo.length - 1].after !== docJson) {
      this._undo.pop();
    }
    this._redo = [];
    this._persist();
  }

  /** External baseline replacement (revert to version): clears history. */
  replaceBaseline(doc: VideoTimelineDoc): void {
    this._doc = doc;
    this._undo = [];
    this._redo = [];
    this._persist();
    this._notify();
  }

  // ── Write ──

  /**
   * Commit the next doc state as an undoable command. No-op when the doc
   * didn't actually change (keeps the journal free of phantom steps).
   */
  apply(next: VideoTimelineDoc, meta: VideoDocApplyMeta = {}): void {
    const prev = this._doc;
    const beforeJson = JSON.stringify(prev);
    const afterJson = JSON.stringify(next);
    if (beforeJson === afterJson) return;

    const explicitKey = meta.coalesceKey ?? null;
    const touch = explicitKey ? "" : touchSignature(prev, next);
    const now = Date.now();
    const top = this._undo[this._undo.length - 1];

    // Coalesce into the top command when: an explicit key repeats, or the
    // same single clip keeps being touched inside the quiet window (drag /
    // number typing). Never across an undo/redo boundary or a redo-able
    // state (that would rewrite history).
    const canMerge = top !== undefined && this._redo.length === 0 && (
      explicitKey !== null
        ? top.key !== null && top.key === explicitKey
        : top.key === null
          && touch !== "" && touch !== "multi"
          && top.touch === touch
          && now - top.at < COALESCE_WINDOW_MS
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
      this._redo = []; // new work invalidates redo
    }

    this._doc = next;
    this._schedulePersist();
    this._notify();
  }

  // ── Undo / Redo ──

  undo(): boolean {
    const cmd = this._undo.pop();
    if (!cmd) return false;
    try {
      this._doc = JSON.parse(cmd.before) as VideoTimelineDoc;
    } catch {
      this._undo.push(cmd); // corrupted entry: restore and refuse
      return false;
    }
    this._redo.push(cmd);
    this._schedulePersist();
    this._notify();
    return true;
  }

  redo(): boolean {
    const cmd = this._redo.pop();
    if (!cmd) return false;
    try {
      this._doc = JSON.parse(cmd.after) as VideoTimelineDoc;
    } catch {
      this._redo.push(cmd);
      return false;
    }
    this._undo.push(cmd);
    this._schedulePersist();
    this._notify();
    return true;
  }

  // ── Persistence ──

  private _loadJournal(): JournalCommand[] {
    if (!this._templateId) return [];
    try {
      const raw = localStorage.getItem(journalKeyFor(this._templateId));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { v?: number; cmds?: JournalCommand[] };
      if (parsed?.v !== 1 || !Array.isArray(parsed.cmds)) return [];
      return parsed.cmds.filter(c =>
        typeof c?.label === "string"
        && typeof c?.before === "string"
        && typeof c?.after === "string",
      ).slice(-MAX_COMMANDS);
    } catch {
      return []; // private mode / corrupted — undo simply starts empty
    }
  }

  private _schedulePersist(): void {
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persist();
    }, 300);
  }

  private _persist(): void {
    if (!this._templateId || typeof localStorage === "undefined") return;
    const key = journalKeyFor(this._templateId);
    let cmds = this._undo;
    try {
      for (;;) {
        const payload = JSON.stringify({ v: 1, cmds });
        if (payload.length <= MAX_JOURNAL_BYTES || cmds.length === 0) {
          localStorage.setItem(key, payload);
          return;
        }
        cmds = cmds.slice(1); // byte-budget trim: drop the oldest command
      }
    } catch { /* storage bloqueado — el undo en sesión sigue funcionando */ }
  }

  private _notify(): void {
    for (const listener of this._listeners) listener();
  }
}
