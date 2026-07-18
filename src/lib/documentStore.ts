/**
 * DocumentStore — transactional single source of truth for frame data.
 *
 * All frame mutations flow through begin/apply/commit. The store owns the undo/redo
 * stack, eliminating the 77 manual pushUndo calls scattered across EditorV2.tsx.
 *
 * React integration: `useSyncExternalStore(store.subscribe, store.getSnapshot)`
 * mirrors the store into React state without useState/useReducer.
 */

import type { FrameData } from "../components/DesignFrame";

// ── Types ──

export interface FramePatch {
  html?: string;
  css?: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  background?: string;
  layoutMode?: "fixed" | "responsive";
  contentHash?: string;
  lastModifiedBy?: string;
  lastModifiedAt?: string;
}

interface TxEntry {
  /** "update" replaces a frame in place. "insert" adds a new frame. "delete" removes a frame. */
  type: "update" | "insert" | "delete";
  before: FrameData;
  after: FrameData;
}

export interface Transaction {
  label: string;
  timestamp: number;
  patches: Map<string, TxEntry>;
}

export type Snapshot = readonly FrameData[];

const MAX_UNDO = 80;

// ── Store ──

export class DocumentStore {
  private _frames: FrameData[];
  private _undoStack: Transaction[] = [];
  private _redoStack: Transaction[] = [];
  private _listeners = new Set<() => void>();
  private _currentTx: Transaction | null = null;

  constructor(initialFrames: FrameData[] = []) {
    this._frames = initialFrames.map(f => ({ ...f }));
  }

  // ── Read (immutable snapshot, safe for React useSyncExternalStore) ──

  /** Current frames snapshot — always a stable reference between commits. */
  getSnapshot = (): Snapshot => this._frames;

  get frames(): Snapshot {
    return this._frames;
  }

  get canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  get isInTransaction(): boolean {
    return this._currentTx !== null;
  }

  get undoLabel(): string | null {
    return this._undoStack.length > 0
      ? this._undoStack[this._undoStack.length - 1].label
      : null;
  }

  // ── Transactional write ──

  /**
   * Start a new transaction. Must be paired with commit() or rollback().
   * Throws if a transaction is already in progress.
   */
  begin(label: string): void {
    if (this._currentTx) {
      throw new Error(
        `Transaction already in progress: "${this._currentTx.label}". ` +
        `Call commit() or rollback() before starting "${label}".`
      );
    }
    this._currentTx = { label, timestamp: Date.now(), patches: new Map() };
  }

  /**
   * Apply a patch to a frame within the current transaction.
   * The first apply per frameId records the "before" state.
   * Throws if no transaction is in progress.
   */
  apply(frameId: string, patch: FramePatch): void {
    if (!this._currentTx) {
      throw new Error("No transaction in progress. Call begin() first.");
    }
    const idx = this._frames.findIndex(f => f.id === frameId);
    if (idx === -1) return;

    // Record "before" on first apply for this frameId
    if (!this._currentTx.patches.has(frameId)) {
      this._currentTx.patches.set(frameId, {
        type: "update",
        before: { ...this._frames[idx] },
        after: null!,
      });
    }

    // Apply patch — produce a new frames array so getSnapshot() returns a
    // fresh reference and useSyncExternalStore detects the change.
    const newFrames = [...this._frames];
    newFrames[idx] = { ...newFrames[idx], ...patch };
    this._frames = newFrames;

    // Record "after"
    this._currentTx.patches.get(frameId)!.after = { ...this._frames[idx] };
  }

  /**
   * Finalize the current transaction: push to undo stack, clear redo, notify.
   * If no patches were recorded the transaction is discarded silently.
   */
  commit(): void {
    if (!this._currentTx) {
      throw new Error("No transaction in progress. Call begin() first.");
    }
    if (this._currentTx.patches.size === 0) {
      this._currentTx = null;
      return;
    }
    this._undoStack.push(this._currentTx);
    if (this._undoStack.length > MAX_UNDO) this._undoStack.shift();
    this._redoStack = [];
    this._currentTx = null;
    this._notify();
  }

  /** Discard the current transaction, reverting all apply() calls. */
  rollback(): void {
    if (!this._currentTx) return;
    for (const [, entry] of this._currentTx.patches) {
      if (entry.type === "insert") {
        // Remove the inserted frame
        this._frames = this._frames.filter(f => f.id !== entry.before.id);
      } else if (entry.type === "delete") {
        // Restore the deleted frame
        this._frames = [...this._frames, { ...entry.before }];
      } else {
        const idx = this._frames.findIndex(f => f.id === entry.before.id);
        if (idx !== -1) {
          const newFrames = [...this._frames];
          newFrames[idx] = { ...entry.before };
          this._frames = newFrames;
        }
      }
    }
    this._currentTx = null;
    this._notify();
  }

  // ── Undo / Redo ──

  /** Undo the last committed transaction. Returns true if an undo was performed. */
  undo(): boolean {
    const tx = this._undoStack.pop();
    if (!tx) return false;

    for (const [, entry] of tx.patches) {
      if (entry.type === "insert") {
        this._frames = this._frames.filter(f => f.id !== entry.before.id);
      } else if (entry.type === "delete") {
        this._frames = [...this._frames, { ...entry.before }];
      } else {
        const idx = this._frames.findIndex(f => f.id === entry.before.id);
        if (idx !== -1) {
          const newFrames = [...this._frames];
          newFrames[idx] = { ...entry.before };
          this._frames = newFrames;
        }
      }
    }
    this._redoStack.push(tx);
    this._notify();
    return true;
  }

  /** Redo the last undone transaction. Returns true if a redo was performed. */
  redo(): boolean {
    const tx = this._redoStack.pop();
    if (!tx) return false;

    for (const [, entry] of tx.patches) {
      if (entry.type === "insert") {
        this._frames = [...this._frames, { ...entry.after }];
      } else if (entry.type === "delete") {
        this._frames = this._frames.filter(f => f.id !== entry.before.id);
      } else {
        const idx = this._frames.findIndex(f => f.id === entry.after.id);
        if (idx !== -1) {
          const newFrames = [...this._frames];
          newFrames[idx] = { ...entry.after };
          this._frames = newFrames;
        }
      }
    }
    this._undoStack.push(tx);
    this._notify();
    return true;
  }

  // ── Bulk operations (non-transactional) ──

  /** Replace all frames (initial load, paste, reload from remote). */
  replaceAll(frames: FrameData[]): void {
    this._frames = frames.map(f => ({ ...f }));
    this._undoStack = [];
    this._redoStack = [];
    this._notify();
  }

  /** Add frames (paste, duplicate, batch). Wraps in a transaction when label is given. */
  addFrames(frames: FrameData[], label?: string): void {
    if (!frames.length) return;
    if (label) this.begin(label);
    this._frames = [...this._frames, ...frames.map(f => ({ ...f }))];
    if (label) {
      for (const f of frames) {
        this._currentTx!.patches.set(f.id, {
          type: "insert",
          before: { ...f },  // undo: remove this frame
          after: { ...f },   // redo: re-add this frame
        });
      }
      this.commit();
    } else {
      this._notify();
    }
  }

  /** Remove frames by id. Wraps in a transaction when label is given. */
  removeFrames(frameIds: string[], label?: string): void {
    if (!frameIds.length) return;
    if (label) this.begin(label);
    const removeSet = new Set(frameIds);
    // Record removed frames so undo can restore them
    const removed: FrameData[] = [];
    for (const f of this._frames) {
      if (removeSet.has(f.id)) removed.push({ ...f });
    }
    if (label && this._currentTx) {
      for (const f of removed) {
        this._currentTx.patches.set(f.id, {
          type: "delete",
          before: { ...f },   // undo: restore this frame
          after: null!,
        });
      }
    }
    this._frames = this._frames.filter(f => !removeSet.has(f.id));
    if (label) this.commit();
    else this._notify();
  }

  /** Move frames (canvas drag). Wraps in a transaction when label is given. */
  moveFrames(moves: { id: string; x: number; y: number }[], label?: string): void {
    if (!moves.length) return;
    if (label) this.begin(label);
    const moveMap = new Map(moves.map(m => [m.id, { x: m.x, y: m.y }]));
    const newFrames = this._frames.map(f => {
      const m = moveMap.get(f.id);
      if (!m) return f;
      if (label && this._currentTx && !this._currentTx.patches.has(f.id)) {
        this._currentTx.patches.set(f.id, {
          type: "update",
          before: { ...f },
          after: null!,
        });
      }
      const updated = { ...f, x: m.x, y: m.y };
      if (label && this._currentTx) {
        this._currentTx.patches.get(f.id)!.after = { ...updated };
      }
      return updated;
    });
    this._frames = newFrames;
    if (label) this.commit();
    else this._notify();
  }

  // ── React integration ──

  /** Subscribe to store changes. Returns unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  };

  // ── Internal ──

  private _notify(): void {
    for (const listener of this._listeners) {
      listener();
    }
  }

  /** Replace all frames, recording the full diff as an undoable transaction. */
  replaceAllWithUndo(newFrames: FrameData[], label: string): void {
    this.begin(label);
    const oldMap = new Map(this._frames.map(f => [f.id, f]));
    const newMap = new Map(newFrames.map(f => [f.id, f]));

    // Deleted frames
    for (const [id, f] of oldMap) {
      if (!newMap.has(id)) {
        this._currentTx!.patches.set(id, { type: "delete", before: { ...f }, after: null! });
      }
    }
    // Inserted or updated frames
    for (const [id, f] of newMap) {
      const old = oldMap.get(id);
      if (!old) {
        this._currentTx!.patches.set(id, { type: "insert", before: { ...f }, after: { ...f } });
      } else if (JSON.stringify(old) !== JSON.stringify(f)) {
        this._currentTx!.patches.set(id, { type: "update", before: { ...old }, after: { ...f } });
      }
    }

    this._frames = newFrames.map(f => ({ ...f }));
    this.commit();
  }

  /** Clear undo/redo history (e.g. after a remote sync). */
  clearHistory(): void {
    this._undoStack = [];
    this._redoStack = [];
  }
}

/** Singleton convenience — the app uses one store per editor session. */
export function createDocumentStore(frames: FrameData[] = []): DocumentStore {
  return new DocumentStore(frames);
}
