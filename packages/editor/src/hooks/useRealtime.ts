// packages/editor/src/hooks/useRealtime.ts
// Supabase Realtime hook for multiplayer canvas collaboration.
// Uses broadcast channels (not database changes) for low-latency sync.

import { useEffect, useRef, useCallback, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { FabricObject } from "fabric";
import * as fabric from "fabric";
import { getSupabase } from "../lib/supabase";
import type {
  CursorPosition,
  UserPresence,
  CanvasDelta,
} from "@futuraria/shared";
import { assignUserColor } from "@futuraria/shared";
import { useToast } from "../components/Toast";

// ─── Throttle helper ──────────────────────────────────────────────
function throttle<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  }) as T;
}

// ─── Types ────────────────────────────────────────────────────────
interface UseRealtimeOpts {
  /** The template/canvas id — used as channel name. */
  templateId: string;
  /** Current user info. */
  userId: string;
  userName: string;
  /** Fabric canvas ref — we attach listeners to it. */
  fabricRef: React.RefObject<fabric.Canvas | null>;
  /** Called when remote users change (for presence panel). */
  onPresenceChange?: (users: UserPresence[]) => void;
}

interface UseRealtimeReturn {
  /** Current connected users (including self). */
  users: UserPresence[];
  /** Remote cursor positions. */
  cursors: CursorPosition[];
  /** Whether realtime is active (Supabase configured + connected). */
  isOnline: boolean;
  /** Number of users in the channel (including self). */
  userCount: number;
}

export function useRealtime(opts: UseRealtimeOpts): UseRealtimeReturn {
  const {
    templateId,
    userId,
    userName,
    fabricRef,
    onPresenceChange,
  } = opts;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const [users, setUsers] = useState<UserPresence[]>([]);
  const [cursors, setCursors] = useState<CursorPosition[]>([]);
  const [isOnline, setIsOnline] = useState(false);
  const userColorRef = useRef<string>("#6366f1");
  const isRemoteUpdateRef = useRef(false);
  const usersRef = useRef<UserPresence[]>([]);
  const { addToast } = useToast();

  // Keep refs in sync
  useEffect(() => { usersRef.current = users; }, [users]);

  // ─── Broadcast a delta to the channel ───────────────────────────
  const broadcastDelta = useCallback(
    (delta: Omit<CanvasDelta, "userId" | "timestamp">) => {
      const channel = channelRef.current;
      if (!channel) return;
      const full: CanvasDelta = {
        ...delta,
        userId,
        timestamp: Date.now(),
      };
      channel.send({
        type: "broadcast",
        event: "canvas:delta",
        payload: full,
      });
    },
    [userId],
  );

  // ─── Throttled cursor broadcast (50ms) ──────────────────────────
  const throttledCursorBroadcast = useRef(
    throttle((pos: { x: number; y: number }) => {
      const channel = channelRef.current;
      if (!channel) return;
      const cursorPos: CursorPosition = {
        userId,
        userName,
        x: pos.x,
        y: pos.y,
        color: userColorRef.current,
      };
      channel.send({
        type: "broadcast",
        event: "cursor:move",
        payload: cursorPos,
      });
    }, 50),
  ).current;

  // ─── Throttled delta broadcast for object:modified (50ms) ───────
  const throttledModifiedBroadcast = useRef(
    throttle((obj: FabricObject) => {
      const layerId = (obj as any).layerId;
      if (!layerId) return;
      const serialized = obj.toObject([
        "layerId", "layerName", "frameId", "isClosedPath",
        "imageFilters", "styleId", "componentId", "isComponentInstance",
        "constraints", "autoLayout", "resizingMode",
      ]);
      const channel = channelRef.current;
      if (!channel) return;
      channel.send({
        type: "broadcast",
        event: "canvas:delta",
        payload: {
          type: "object:modified",
          objectId: layerId,
          payload: serialized,
          userId,
          timestamp: Date.now(),
        } as CanvasDelta,
      });
    }, 50),
  ).current;

  // ─── Apply a remote delta to the local canvas ───────────────────
  const applyRemoteDelta = useCallback(
    (delta: CanvasDelta) => {
      const c = fabricRef.current;
      if (!c) return;
      if (delta.userId === userId) return;

      isRemoteUpdateRef.current = true;

      switch (delta.type) {
        case "object:modified": {
          const obj = c.getObjects().find(
            (o: any) => o.layerId === delta.objectId,
          );
          if (obj && delta.payload) {
            obj.set(delta.payload);
            obj.setCoords();
            c.renderAll();
          }
          isRemoteUpdateRef.current = false;
          break;
        }
        case "object:added": {
          const exists = c.getObjects().find(
            (o: any) => o.layerId === delta.objectId,
          );
          if (exists || !delta.payload) {
            isRemoteUpdateRef.current = false;
            break;
          }
          fabric.util.enlivenObjects([delta.payload]).then(([obj]: any[]) => {
            if (obj) {
              c.add(obj);
              c.renderAll();
            }
            isRemoteUpdateRef.current = false;
          }).catch((err: any) => {
            console.error("[realtime] Failed to enliven remote object:", err);
            addToast("warning", "Realtime glitch", "A remote edit could not be applied");
            isRemoteUpdateRef.current = false;
          });
          break;
        }
        case "object:removed": {
          const obj = c.getObjects().find(
            (o: any) => o.layerId === delta.objectId,
          );
          if (obj) {
            c.remove(obj);
            c.renderAll();
          }
          isRemoteUpdateRef.current = false;
          break;
        }
        default:
          isRemoteUpdateRef.current = false;
      }
    },
    [fabricRef, userId],
  );

  // ─── Subscribe to Supabase Realtime channel ─────────────────────
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setIsOnline(false);
      return;
    }

    const channelName = `template:${templateId}`;
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { self: false },
        presence: { key: userId },
      },
    });
    channelRef.current = channel;

    // ── Presence: sync ──────────────────────────────────────────
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<UserPresence>();
      const allUsers: UserPresence[] = [];
      for (const key in state) {
        for (const pres of state[key] as unknown as UserPresence[]) {
          allUsers.push(pres);
        }
      }
      // Ensure self is in the list
      if (!allUsers.find((u) => u.userId === userId)) {
        allUsers.push({
          userId,
          userName,
          color: userColorRef.current,
          lastSeen: Date.now(),
        });
      }
      setUsers(allUsers);
      onPresenceChange?.(allUsers);
    });

    // ── Presence: leave — remove departed cursors ───────────────
    channel.on("presence", { event: "leave" }, ({ leftPresences }) => {
      const leftIds = new Set(
        (leftPresences as unknown as UserPresence[]).map((p) => p.userId),
      );
      setCursors((prev) => {
        const next = prev.filter((c) => !leftIds.has(c.userId));
        return next;
      });
    });

    // ── Cursor broadcasts ───────────────────────────────────────
    channel.on("broadcast", { event: "cursor:move" }, ({ payload }) => {
      const cursor = payload as CursorPosition;
      if (cursor.userId === userId) return;
      setCursors((prev) => {
        const idx = prev.findIndex((c) => c.userId === cursor.userId);
        const next = [...prev];
        if (idx >= 0) next[idx] = cursor;
        else next.push(cursor);
        return next;
      });
    });

    // ── Canvas delta broadcasts ─────────────────────────────────
    channel.on("broadcast", { event: "canvas:delta" }, ({ payload }) => {
      applyRemoteDelta(payload as CanvasDelta);
    });

    // ── Subscribe ───────────────────────────────────────────────
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        setIsOnline(true);
        const color = assignUserColor(userId, usersRef.current);
        userColorRef.current = color;
        await channel.track({
          userId,
          userName,
          color,
          lastSeen: Date.now(),
        } as UserPresence);
      }
    });

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
      setIsOnline(false);
      setUsers([]);
      setCursors([]);
    };
  }, [templateId, userId, userName]);

  // ─── Attach Fabric.js listeners for broadcasting local changes ──
  useEffect(() => {
    const c = fabricRef.current;
    if (!c || !isOnline) return;

    const handleModified = (e: any) => {
      if (isRemoteUpdateRef.current) return;
      const obj = e.target;
      if (!obj || (obj as any).isFrameLabel || (obj as any).isGridLine || (obj as any).isGuideLine) return;
      throttledModifiedBroadcast(obj);
    };

    const handleAdded = (e: any) => {
      if (isRemoteUpdateRef.current) return;
      const obj = e.target;
      if (!obj || (obj as any).isFrameLabel || (obj as any).isGridLine || (obj as any).isGuideLine) return;
      const layerId = (obj as any).layerId;
      if (!layerId) return;
      const serialized = obj.toObject([
        "layerId", "layerName", "frameId", "isClosedPath",
        "imageFilters", "styleId", "componentId", "isComponentInstance",
        "constraints", "autoLayout", "resizingMode",
      ]);
      broadcastDelta({
        type: "object:added",
        objectId: layerId,
        payload: serialized,
      });
    };

    const handleRemoved = (e: any) => {
      if (isRemoteUpdateRef.current) return;
      const obj = e.target;
      if (!obj || (obj as any).isFrameLabel || (obj as any).isGridLine || (obj as any).isGuideLine) return;
      const layerId = (obj as any).layerId;
      if (!layerId) return;
      broadcastDelta({
        type: "object:removed",
        objectId: layerId,
      });
    };

    const handleMouseMove = (e: any) => {
      const pointer = c.getScenePoint(e.e);
      throttledCursorBroadcast({ x: pointer.x, y: pointer.y });
    };

    c.on("object:modified", handleModified);
    c.on("object:added", handleAdded);
    c.on("object:removed", handleRemoved);
    c.on("mouse:move", handleMouseMove);

    return () => {
      c.off("object:modified", handleModified);
      c.off("object:added", handleAdded);
      c.off("object:removed", handleRemoved);
      c.off("mouse:move", handleMouseMove);
    };
  }, [fabricRef, isOnline, broadcastDelta]);

  return {
    users,
    cursors,
    isOnline,
    userCount: users.length,
  };
}
