import { useState, useCallback, useRef, useEffect } from "react";
import type {
  PrototypeInteraction,
  PrototypeAction,
  PrototypeTrigger,
  PrototypeTransition,
  PrototypeFlow,
} from "@futuraria/shared";

// ─── UID ─────────────────────────────────────────────────────────
let _pid = 0;
function puid(prefix = "pi"): string {
  return `${prefix}_${Date.now()}_${++_pid}`;
}

// ─── Default transition ──────────────────────────────────────────
const defaultTransition: PrototypeTransition = {
  type: "dissolve",
  duration: 300,
  easing: "easeInOut",
};

// ─── Easing CSS map ──────────────────────────────────────────────
const EASING_CSS: Record<string, string> = {
  linear: "linear",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.2, 1)",
  easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
};

// ─── Types ───────────────────────────────────────────────────────

export interface PrototypeState {
  /** All interactions keyed by layerId. */
  interactions: Map<string, PrototypeInteraction[]>;
  /** Prototype flows for the current page. */
  flows: PrototypeFlow[];
  /** Whether preview mode is active. */
  isPreviewing: boolean;
  /** Current frame being shown in preview. */
  previewFrameId: string | null;
  /** Active overlays in preview. */
  activeOverlays: Array<{ frameId: string; position: { x: number; y: number } }>;
  /** Current device for preview. */
  previewDevice: "phone" | "tablet" | "desktop";
  /** Current flow being previewed. */
  activeFlowId: string | null;
}

export interface PrototypeActions {
  // ── Interaction CRUD ──────────────────────────────────────────
  addInteraction: (layerId: string, trigger?: PrototypeTrigger) => PrototypeInteraction;
  updateInteraction: (layerId: string, interactionId: string, updates: Partial<PrototypeInteraction>) => void;
  removeInteraction: (layerId: string, interactionId: string) => void;
  getLayerInteractions: (layerId: string) => PrototypeInteraction[];

  // ── Action CRUD ───────────────────────────────────────────────
  addAction: (layerId: string, interactionId: string, action?: Partial<PrototypeAction>) => void;
  updateAction: (layerId: string, interactionId: string, actionIndex: number, updates: Partial<PrototypeAction>) => void;
  removeAction: (layerId: string, interactionId: string, actionIndex: number) => void;

  // ── Transition ────────────────────────────────────────────────
  updateTransition: (layerId: string, interactionId: string, transition: Partial<PrototypeTransition>) => void;

  // ── Flows ─────────────────────────────────────────────────────
  addFlow: (name: string, startFrameId: string) => PrototypeFlow;
  updateFlow: (flowId: string, updates: Partial<PrototypeFlow>) => void;
  removeFlow: (flowId: string) => void;

  // ── Preview ───────────────────────────────────────────────────
  startPreview: (flowId?: string) => void;
  stopPreview: () => void;
  setPreviewDevice: (device: "phone" | "tablet" | "desktop") => void;
  navigateToFrame: (frameId: string, transition?: PrototypeTransition) => void;
  closeOverlay: (frameId: string) => void;

  // ── Execute trigger ───────────────────────────────────────────
  executeTrigger: (layerId: string, trigger: PrototypeTrigger) => void;

  // ── Serialization ─────────────────────────────────────────────
  serializeInteractions: () => Record<string, PrototypeInteraction[]>;
  deserializeInteractions: (data: Record<string, PrototypeInteraction[]>) => void;
  serializeFlows: () => PrototypeFlow[];
  deserializeFlows: (data: PrototypeFlow[]) => void;

  // ── Raw refs for external access ──────────────────────────────
  interactionsRef: React.MutableRefObject<Map<string, PrototypeInteraction[]>>;
  flowsRef: React.MutableRefObject<PrototypeFlow[]>;
  isPreviewingRef: React.MutableRefObject<boolean>;
  previewFrameIdRef: React.MutableRefObject<string | null>;
  activeOverlaysRef: React.MutableRefObject<Array<{ frameId: string; position: { x: number; y: number } }>>;
  previewDeviceRef: React.MutableRefObject<"phone" | "tablet" | "desktop">;
}

// ─── Hook ────────────────────────────────────────────────────────

export function usePrototype(opts: {
  onStateChange?: (state: Partial<PrototypeState>) => void;
  getFrameIds?: () => string[];
}): PrototypeActions {
  const interactionsRef = useRef<Map<string, PrototypeInteraction[]>>(new Map());
  const flowsRef = useRef<PrototypeFlow[]>([]);
  const isPreviewingRef = useRef(false);
  const previewFrameIdRef = useRef<string | null>(null);
  const activeOverlaysRef = useRef<Array<{ frameId: string; position: { x: number; y: number } }>>([]);
  const previewDeviceRef = useRef<"phone" | "tablet" | "desktop">("desktop");
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // State for reactivity
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((n) => n + 1), []);

  // ── Interaction CRUD ──────────────────────────────────────────

  const addInteraction = useCallback(
    (layerId: string, trigger: PrototypeTrigger = "click"): PrototypeInteraction => {
      const interaction: PrototypeInteraction = {
        id: puid("int"),
        trigger,
        actions: [],
        transition: { ...defaultTransition },
      };

      const existing = interactionsRef.current.get(layerId) || [];
      interactionsRef.current.set(layerId, [...existing, interaction]);
      forceUpdate();
      return interaction;
    },
    [forceUpdate],
  );

  const updateInteraction = useCallback(
    (layerId: string, interactionId: string, updates: Partial<PrototypeInteraction>) => {
      const existing = interactionsRef.current.get(layerId);
      if (!existing) return;
      const idx = existing.findIndex((i) => i.id === interactionId);
      if (idx === -1) return;
      existing[idx] = { ...existing[idx], ...updates };
      interactionsRef.current.set(layerId, [...existing]);
      forceUpdate();
    },
    [forceUpdate],
  );

  const removeInteraction = useCallback(
    (layerId: string, interactionId: string) => {
      const existing = interactionsRef.current.get(layerId);
      if (!existing) return;
      interactionsRef.current.set(
        layerId,
        existing.filter((i) => i.id !== interactionId),
      );
      forceUpdate();
    },
    [forceUpdate],
  );

  const getLayerInteractions = useCallback((layerId: string): PrototypeInteraction[] => {
    return interactionsRef.current.get(layerId) || [];
  }, []);

  // ── Action CRUD ───────────────────────────────────────────────

  const addAction = useCallback(
    (layerId: string, interactionId: string, action?: Partial<PrototypeAction>) => {
      const existing = interactionsRef.current.get(layerId);
      if (!existing) return;
      const interaction = existing.find((i) => i.id === interactionId);
      if (!interaction) return;
      const newAction: PrototypeAction = {
        type: "navigate",
        ...action,
      };
      interaction.actions = [...interaction.actions, newAction];
      interactionsRef.current.set(layerId, [...existing]);
      forceUpdate();
    },
    [forceUpdate],
  );

  const updateAction = useCallback(
    (layerId: string, interactionId: string, actionIndex: number, updates: Partial<PrototypeAction>) => {
      const existing = interactionsRef.current.get(layerId);
      if (!existing) return;
      const interaction = existing.find((i) => i.id === interactionId);
      if (!interaction || actionIndex >= interaction.actions.length) return;
      interaction.actions[actionIndex] = { ...interaction.actions[actionIndex], ...updates };
      interactionsRef.current.set(layerId, [...existing]);
      forceUpdate();
    },
    [forceUpdate],
  );

  const removeAction = useCallback(
    (layerId: string, interactionId: string, actionIndex: number) => {
      const existing = interactionsRef.current.get(layerId);
      if (!existing) return;
      const interaction = existing.find((i) => i.id === interactionId);
      if (!interaction) return;
      interaction.actions = interaction.actions.filter((_: PrototypeAction, i: number) => i !== actionIndex);
      interactionsRef.current.set(layerId, [...existing]);
      forceUpdate();
    },
    [forceUpdate],
  );

  // ── Transition ────────────────────────────────────────────────

  const updateTransition = useCallback(
    (layerId: string, interactionId: string, transition: Partial<PrototypeTransition>) => {
      const existing = interactionsRef.current.get(layerId);
      if (!existing) return;
      const interaction = existing.find((i) => i.id === interactionId);
      if (!interaction) return;
      interaction.transition = { ...interaction.transition, ...transition };
      interactionsRef.current.set(layerId, [...existing]);
      forceUpdate();
    },
    [forceUpdate],
  );

  // ── Flows ─────────────────────────────────────────────────────

  const addFlow = useCallback(
    (name: string, startFrameId: string): PrototypeFlow => {
      const flow: PrototypeFlow = {
        id: puid("flow"),
        name,
        startFrameId,
      };
      flowsRef.current = [...flowsRef.current, flow];
      forceUpdate();
      return flow;
    },
    [forceUpdate],
  );

  const updateFlow = useCallback(
    (flowId: string, updates: Partial<PrototypeFlow>) => {
      flowsRef.current = flowsRef.current.map((f) =>
        f.id === flowId ? { ...f, ...updates } : f,
      );
      forceUpdate();
    },
    [forceUpdate],
  );

  const removeFlow = useCallback(
    (flowId: string) => {
      flowsRef.current = flowsRef.current.filter((f) => f.id !== flowId);
      forceUpdate();
    },
    [forceUpdate],
  );

  // ── Preview ───────────────────────────────────────────────────

  const startPreview = useCallback(
    (flowId?: string) => {
      const flow = flowId
        ? flowsRef.current.find((f) => f.id === flowId)
        : flowsRef.current[0];

      if (flow) {
        previewFrameIdRef.current = flow.startFrameId;
      } else {
        // If no flow, try to use the first available frame
        const frameIds = opts.getFrameIds?.() || [];
        previewFrameIdRef.current = frameIds[0] || null;
      }

      activeOverlaysRef.current = [];
      isPreviewingRef.current = true;
      forceUpdate();
      opts.onStateChange?.({ isPreviewing: true, previewFrameId: previewFrameIdRef.current });
    },
    [forceUpdate, opts],
  );

  const stopPreview = useCallback(() => {
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    isPreviewingRef.current = false;
    previewFrameIdRef.current = null;
    activeOverlaysRef.current = [];
    forceUpdate();
    opts.onStateChange?.({ isPreviewing: false, previewFrameId: null, activeOverlays: [] });
  }, [forceUpdate, opts]);

  const setPreviewDevice = useCallback(
    (device: "phone" | "tablet" | "desktop") => {
      previewDeviceRef.current = device;
      forceUpdate();
      opts.onStateChange?.({ previewDevice: device });
    },
    [forceUpdate, opts],
  );

  const navigateToFrame = useCallback(
    (frameId: string, transition?: PrototypeTransition) => {
      if (!isPreviewingRef.current) return;
      previewFrameIdRef.current = frameId;
      activeOverlaysRef.current = [];
      forceUpdate();
      opts.onStateChange?.({ previewFrameId: frameId, activeOverlays: [] });
    },
    [forceUpdate, opts],
  );

  const closeOverlay = useCallback(
    (frameId: string) => {
      activeOverlaysRef.current = activeOverlaysRef.current.filter(
        (o) => o.frameId !== frameId,
      );
      forceUpdate();
      opts.onStateChange?.({ activeOverlays: [...activeOverlaysRef.current] });
    },
    [forceUpdate, opts],
  );

  // ── Execute trigger ───────────────────────────────────────────

  const executeTrigger = useCallback(
    (layerId: string, trigger: PrototypeTrigger) => {
      if (!isPreviewingRef.current) return;

      const interactions = interactionsRef.current.get(layerId) || [];
      const matching = interactions.filter((i) => i.trigger === trigger);
      if (matching.length === 0) return;

      for (const interaction of matching) {
        const transition = interaction.transition;

        for (const action of interaction.actions) {
          const execute = () => {
            switch (action.type) {
              case "navigate":
                if (action.targetFrameId) {
                  navigateToFrame(action.targetFrameId, transition);
                }
                break;
              case "openOverlay":
                if (action.targetFrameId) {
                  activeOverlaysRef.current = [
                    ...activeOverlaysRef.current,
                    {
                      frameId: action.targetFrameId,
                      position: action.overlayPosition || { x: 0, y: 0 },
                    },
                  ];
                  forceUpdate();
                  opts.onStateChange?.({ activeOverlays: [...activeOverlaysRef.current] });
                }
                break;
              case "closeOverlay":
                if (action.targetFrameId) {
                  closeOverlay(action.targetFrameId);
                } else {
                  // Close all overlays
                  activeOverlaysRef.current = [];
                  forceUpdate();
                  opts.onStateChange?.({ activeOverlays: [] });
                }
                break;
              case "swapOverlay":
                if (action.targetFrameId) {
                  // Replace current overlay with new one
                  if (activeOverlaysRef.current.length > 0) {
                    activeOverlaysRef.current = [
                      {
                        frameId: action.targetFrameId,
                        position: action.overlayPosition || activeOverlaysRef.current[0].position,
                      },
                    ];
                  } else {
                    activeOverlaysRef.current = [
                      {
                        frameId: action.targetFrameId,
                        position: action.overlayPosition || { x: 0, y: 0 },
                      },
                    ];
                  }
                  forceUpdate();
                  opts.onStateChange?.({ activeOverlays: [...activeOverlaysRef.current] });
                }
                break;
              case "changeTo":
                // changeTo is like navigate but can be used for state changes
                if (action.targetFrameId) {
                  navigateToFrame(action.targetFrameId, transition);
                }
                break;
            }
          };

          if (action.delay && action.delay > 0) {
            setTimeout(execute, action.delay);
          } else {
            execute();
          }
        }
      }
    },
    [navigateToFrame, closeOverlay, forceUpdate, opts],
  );

  // ── Serialization ─────────────────────────────────────────────

  const serializeInteractions = useCallback((): Record<string, PrototypeInteraction[]> => {
    const result: Record<string, PrototypeInteraction[]> = {};
    interactionsRef.current.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }, []);

  const deserializeInteractions = useCallback(
    (data: Record<string, PrototypeInteraction[]>) => {
      interactionsRef.current = new Map(Object.entries(data));
      forceUpdate();
    },
    [forceUpdate],
  );

  const serializeFlows = useCallback((): PrototypeFlow[] => {
    return [...flowsRef.current];
  }, []);

  const deserializeFlows = useCallback(
    (data: PrototypeFlow[]) => {
      flowsRef.current = [...data];
      forceUpdate();
    },
    [forceUpdate],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  return {
    addInteraction,
    updateInteraction,
    removeInteraction,
    getLayerInteractions,
    addAction,
    updateAction,
    removeAction,
    updateTransition,
    addFlow,
    updateFlow,
    removeFlow,
    startPreview,
    stopPreview,
    setPreviewDevice,
    navigateToFrame,
    closeOverlay,
    executeTrigger,
    serializeInteractions,
    deserializeInteractions,
    serializeFlows,
    deserializeFlows,
    interactionsRef,
    flowsRef,
    isPreviewingRef,
    previewFrameIdRef,
    activeOverlaysRef,
    previewDeviceRef,
  };
}

// ─── CSS Transition Helpers ──────────────────────────────────────

export function getTransitionCSS(transition: PrototypeTransition): {
  entering: React.CSSProperties;
  exiting: React.CSSProperties;
} {
  const { type, direction, duration, easing } = transition;
  const easingCSS = EASING_CSS[easing] || EASING_CSS.easeInOut;
  const dur = `${duration}ms`;

  switch (type) {
    case "instant":
      return {
        entering: { opacity: 1, transition: "none" },
        exiting: { opacity: 0, transition: "none" },
      };

    case "dissolve":
      return {
        entering: {
          opacity: 1,
          transition: `opacity ${dur} ${easingCSS}`,
        },
        exiting: {
          opacity: 0,
          transition: `opacity ${dur} ${easingCSS}`,
        },
      };

    case "moveIn": {
      const dir = direction || "right";
      const translateMap: Record<string, { from: string; to: string }> = {
        left: { from: "translateX(-100%)", to: "translateX(0)" },
        right: { from: "translateX(100%)", to: "translateX(0)" },
        top: { from: "translateY(-100%)", to: "translateY(0)" },
        bottom: { from: "translateY(100%)", to: "translateY(0)" },
      };
      const t = translateMap[dir];
      return {
        entering: {
          transform: t.to,
          transition: `transform ${dur} ${easingCSS}`,
        },
        exiting: {
          transform: t.from,
          transition: `transform ${dur} ${easingCSS}`,
        },
      };
    }

    case "moveOut": {
      const dir = direction || "left";
      const translateMap: Record<string, { from: string; to: string }> = {
        left: { from: "translateX(0)", to: "translateX(-100%)" },
        right: { from: "translateX(0)", to: "translateX(100%)" },
        top: { from: "translateY(0)", to: "translateY(-100%)" },
        bottom: { from: "translateY(0)", to: "translateY(100%)" },
      };
      const t = translateMap[dir];
      return {
        entering: {
          transform: t.from,
          transition: `transform ${dur} ${easingCSS}`,
        },
        exiting: {
          transform: t.to,
          transition: `transform ${dur} ${easingCSS}`,
        },
      };
    }

    case "push": {
      const dir = direction || "left";
      const translateMap: Record<string, { enterFrom: string; enterTo: string; exitFrom: string; exitTo: string }> = {
        left: {
          enterFrom: "translateX(100%)",
          enterTo: "translateX(0)",
          exitFrom: "translateX(0)",
          exitTo: "translateX(-100%)",
        },
        right: {
          enterFrom: "translateX(-100%)",
          enterTo: "translateX(0)",
          exitFrom: "translateX(0)",
          exitTo: "translateX(100%)",
        },
        top: {
          enterFrom: "translateY(100%)",
          enterTo: "translateY(0)",
          exitFrom: "translateY(0)",
          exitTo: "translateY(-100%)",
        },
        bottom: {
          enterFrom: "translateY(-100%)",
          enterTo: "translateY(0)",
          exitFrom: "translateY(0)",
          exitTo: "translateY(100%)",
        },
      };
      const t = translateMap[dir];
      return {
        entering: {
          transform: t.enterTo,
          transition: `transform ${dur} ${easingCSS}`,
        },
        exiting: {
          transform: t.exitTo,
          transition: `transform ${dur} ${easingCSS}`,
        },
      };
    }

    case "slideIn": {
      const dir = direction || "right";
      const translateMap: Record<string, { from: string; to: string }> = {
        left: { from: "translateX(-100%)", to: "translateX(0)" },
        right: { from: "translateX(100%)", to: "translateX(0)" },
        top: { from: "translateY(-100%)", to: "translateY(0)" },
        bottom: { from: "translateY(100%)", to: "translateY(0)" },
      };
      const t = translateMap[dir];
      return {
        entering: {
          transform: t.to,
          transition: `transform ${dur} ${easingCSS}, opacity ${dur} ${easingCSS}`,
          opacity: 1,
        },
        exiting: {
          transform: t.from,
          transition: `transform ${dur} ${easingCSS}, opacity ${dur} ${easingCSS}`,
          opacity: 0,
        },
      };
    }

    default:
      return {
        entering: { opacity: 1 },
        exiting: { opacity: 0 },
      };
  }
}

export function getDeviceDimensions(device: "phone" | "tablet" | "desktop"): {
  width: number;
  height: number;
  label: string;
} {
  switch (device) {
    case "phone":
      return { width: 390, height: 844, label: "iPhone 14" };
    case "tablet":
      return { width: 820, height: 1180, label: "iPad Air" };
    case "desktop":
      return { width: 1440, height: 900, label: "Desktop" };
  }
}
