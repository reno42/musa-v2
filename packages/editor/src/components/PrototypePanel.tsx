import { useState, useCallback } from "react";
import type {
  PrototypeInteraction,
  PrototypeAction,
  PrototypeTrigger,
  PrototypeTransition,
  TransitionType,
  TransitionDirection,
  EasingType,
} from "@futuraria/shared";
import type { PrototypeActions } from "../hooks/usePrototype";
import type { FrameInfo } from "../hooks/useCanvas";

// ─── Constants ───────────────────────────────────────────────────

const TRIGGER_OPTIONS: { value: PrototypeTrigger; label: string; icon: string }[] = [
  { value: "click", label: "On Click", icon: "👆" },
  { value: "hover", label: "On Hover", icon: "🫳" },
  { value: "press", label: "On Press", icon: "✊" },
  { value: "drag", label: "On Drag", icon: "↔️" },
  { value: "afterDelay", label: "After Delay", icon: "⏱️" },
];

const ACTION_TYPES: { value: PrototypeAction["type"]; label: string }[] = [
  { value: "navigate", label: "Navigate to Frame" },
  { value: "openOverlay", label: "Open Overlay" },
  { value: "closeOverlay", label: "Close Overlay" },
  { value: "swapOverlay", label: "Swap Overlay" },
  { value: "changeTo", label: "Change To" },
];

const TRANSITION_TYPES: { value: TransitionType; label: string }[] = [
  { value: "instant", label: "Instant" },
  { value: "dissolve", label: "Dissolve" },
  { value: "moveIn", label: "Move In" },
  { value: "moveOut", label: "Move Out" },
  { value: "push", label: "Push" },
  { value: "slideIn", label: "Slide In" },
];

const DIRECTION_OPTIONS: { value: TransitionDirection; label: string }[] = [
  { value: "left", label: "← Left" },
  { value: "right", label: "Right →" },
  { value: "top", label: "↑ Top" },
  { value: "bottom", label: "↓ Bottom" },
];

const EASING_OPTIONS: { value: EasingType; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "easeIn", label: "Ease In" },
  { value: "easeOut", label: "Ease Out" },
  { value: "easeInOut", label: "Ease In Out" },
];

// ─── Props ───────────────────────────────────────────────────────

interface Props {
  selectedLayerId: string | null;
  frames: FrameInfo[];
  prototype: PrototypeActions;
  onStartPreview: () => void;
}

// ─── Component ───────────────────────────────────────────────────

export function PrototypePanel({
  selectedLayerId,
  frames,
  prototype,
  onStartPreview,
}: Props) {
  const [, setTick] = useState(0);
  const force = () => setTick((n) => n + 1);

  const interactions = selectedLayerId
    ? prototype.getLayerInteractions(selectedLayerId)
    : [];

  const handleAddInteraction = useCallback(() => {
    if (!selectedLayerId) return;
    prototype.addInteraction(selectedLayerId, "click");
    force();
  }, [selectedLayerId, prototype]);

  if (!selectedLayerId) {
    return (
      <div className="prototype-panel">
        <div className="sidebar-header">
          <span>Prototype</span>
        </div>
        <div className="empty-state">
          Select a layer to configure<br />prototype interactions
        </div>
        <div className="proto-flows-section">
          <FlowsList frames={frames} prototype={prototype} onStartPreview={onStartPreview} />
        </div>
      </div>
    );
  }

  return (
    <div className="prototype-panel">
      <div className="sidebar-header">
        <span>Prototype</span>
        <span className="obj-type">{interactions.length} interaction{interactions.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Interactions list */}
      <div className="proto-interactions-list">
        {interactions.map((interaction) => (
          <InteractionCard
            key={interaction.id}
            layerId={selectedLayerId}
            interaction={interaction}
            frames={frames}
            prototype={prototype}
            onUpdate={force}
          />
        ))}

        <button className="proto-add-btn" onClick={handleAddInteraction}>
          + Add Interaction
        </button>
      </div>

      {/* Flows section */}
      <div className="proto-flows-section">
        <FlowsList frames={frames} prototype={prototype} onStartPreview={onStartPreview} />
      </div>
    </div>
  );
}

// ─── Interaction Card ────────────────────────────────────────────

function InteractionCard({
  layerId,
  interaction,
  frames,
  prototype,
  onUpdate,
}: {
  layerId: string;
  interaction: PrototypeInteraction;
  frames: FrameInfo[];
  prototype: PrototypeActions;
  onUpdate: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="proto-interaction-card">
      <div className="proto-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="proto-card-arrow">{expanded ? "▼" : "▶"}</span>
        <span className="proto-card-trigger">
          {TRIGGER_OPTIONS.find((t) => t.value === interaction.trigger)?.icon}{" "}
          {TRIGGER_OPTIONS.find((t) => t.value === interaction.trigger)?.label}
        </span>
        <button
          className="proto-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            prototype.removeInteraction(layerId, interaction.id);
            onUpdate();
          }}
          title="Remove interaction"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="proto-card-body">
          {/* Trigger selector */}
          <div className="proto-field">
            <label className="proto-label">Trigger</label>
            <select
              className="proto-select"
              value={interaction.trigger}
              onChange={(e) => {
                prototype.updateInteraction(layerId, interaction.id, {
                  trigger: e.target.value as PrototypeTrigger,
                });
                onUpdate();
              }}
            >
              {TRIGGER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="proto-field">
            <label className="proto-label">Actions</label>
            {interaction.actions.map((action: PrototypeAction, idx: number) => (
              <ActionRow
                key={idx}
                layerId={layerId}
                interactionId={interaction.id}
                actionIndex={idx}
                action={action}
                frames={frames}
                prototype={prototype}
                onUpdate={onUpdate}
              />
            ))}
            <button
              className="proto-add-action-btn"
              onClick={() => {
                prototype.addAction(layerId, interaction.id);
                onUpdate();
              }}
            >
              + Add Action
            </button>
          </div>

          {/* Transition */}
          <TransitionEditor
            layerId={layerId}
            interactionId={interaction.id}
            transition={interaction.transition}
            prototype={prototype}
            onUpdate={onUpdate}
          />
        </div>
      )}
    </div>
  );
}

// ─── Action Row ──────────────────────────────────────────────────

function ActionRow({
  layerId,
  interactionId,
  actionIndex,
  action,
  frames,
  prototype,
  onUpdate,
}: {
  layerId: string;
  interactionId: string;
  actionIndex: number;
  action: PrototypeAction;
  frames: FrameInfo[];
  prototype: PrototypeActions;
  onUpdate: () => void;
}) {
  return (
    <div className="proto-action-row">
      <select
        className="proto-select proto-action-type"
        value={action.type}
        onChange={(e) => {
          prototype.updateAction(layerId, interactionId, actionIndex, {
            type: e.target.value as PrototypeAction["type"],
          });
          onUpdate();
        }}
      >
        {ACTION_TYPES.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {action.type !== "closeOverlay" && (
        <select
          className="proto-select proto-action-target"
          value={action.targetFrameId || ""}
          onChange={(e) => {
            prototype.updateAction(layerId, interactionId, actionIndex, {
              targetFrameId: e.target.value || undefined,
            });
            onUpdate();
          }}
        >
          <option value="">Select frame...</option>
          {frames.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      )}

      {action.type === "openOverlay" && (
        <div className="proto-overlay-pos">
          <input
            type="number"
            className="proto-input-sm"
            placeholder="X"
            value={action.overlayPosition?.x ?? ""}
            onChange={(e) => {
              prototype.updateAction(layerId, interactionId, actionIndex, {
                overlayPosition: {
                  x: Number(e.target.value) || 0,
                  y: action.overlayPosition?.y || 0,
                },
              });
              onUpdate();
            }}
          />
          <input
            type="number"
            className="proto-input-sm"
            placeholder="Y"
            value={action.overlayPosition?.y ?? ""}
            onChange={(e) => {
              prototype.updateAction(layerId, interactionId, actionIndex, {
                overlayPosition: {
                  x: action.overlayPosition?.x || 0,
                  y: Number(e.target.value) || 0,
                },
              });
              onUpdate();
            }}
          />
        </div>
      )}

      <div className="proto-delay-row">
        <span className="proto-label-sm">delay</span>
        <input
          type="number"
          className="proto-input-sm"
          placeholder="0"
          value={action.delay ?? ""}
          min={0}
          step={100}
          onChange={(e) => {
            prototype.updateAction(layerId, interactionId, actionIndex, {
              delay: Number(e.target.value) || undefined,
            });
            onUpdate();
          }}
        />
        <span className="proto-label-sm">ms</span>
      </div>

      <button
        className="proto-delete-btn-sm"
        onClick={() => {
          prototype.removeAction(layerId, interactionId, actionIndex);
          onUpdate();
        }}
        title="Remove action"
      >
        ✕
      </button>
    </div>
  );
}

// ─── Transition Editor ───────────────────────────────────────────

function TransitionEditor({
  layerId,
  interactionId,
  transition,
  prototype,
  onUpdate,
}: {
  layerId: string;
  interactionId: string;
  transition: PrototypeTransition;
  prototype: PrototypeActions;
  onUpdate: () => void;
}) {
  const needsDirection = ["moveIn", "moveOut", "push", "slideIn"].includes(transition.type);

  return (
    <div className="proto-transition-section">
      <label className="proto-label">Transition</label>

      <select
        className="proto-select"
        value={transition.type}
        onChange={(e) => {
          prototype.updateTransition(layerId, interactionId, {
            type: e.target.value as TransitionType,
          });
          onUpdate();
        }}
      >
        {TRANSITION_TYPES.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {needsDirection && (
        <select
          className="proto-select"
          value={transition.direction || "right"}
          onChange={(e) => {
            prototype.updateTransition(layerId, interactionId, {
              direction: e.target.value as TransitionDirection,
            });
            onUpdate();
          }}
        >
          {DIRECTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}

      <div className="proto-transition-row">
        <span className="proto-label-sm">duration</span>
        <input
          type="range"
          className="proto-range"
          min={50}
          max={2000}
          step={50}
          value={transition.duration}
          onChange={(e) => {
            prototype.updateTransition(layerId, interactionId, {
              duration: Number(e.target.value),
            });
            onUpdate();
          }}
        />
        <span className="proto-range-val">{transition.duration}ms</span>
      </div>

      <select
        className="proto-select"
        value={transition.easing}
        onChange={(e) => {
          prototype.updateTransition(layerId, interactionId, {
            easing: e.target.value as EasingType,
          });
          onUpdate();
        }}
      >
        {EASING_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Flows List ──────────────────────────────────────────────────

function FlowsList({
  frames,
  prototype,
  onStartPreview,
}: {
  frames: FrameInfo[];
  prototype: PrototypeActions;
  onStartPreview: () => void;
}) {
  const flows = prototype.flowsRef.current;
  const [showAdd, setShowAdd] = useState(false);
  const [flowName, setFlowName] = useState("");
  const [flowStart, setFlowStart] = useState("");

  const handleAdd = () => {
    if (!flowStart) return;
    prototype.addFlow(flowName || `Flow ${flows.length + 1}`, flowStart);
    setFlowName("");
    setFlowStart("");
    setShowAdd(false);
  };

  return (
    <div className="proto-flows">
      <div className="proto-flows-header">
        <span className="proto-label">Flows</span>
        <button
          className="proto-icon-btn"
          onClick={() => setShowAdd(!showAdd)}
          title="Add flow"
        >
          +
        </button>
      </div>

      {showAdd && (
        <div className="proto-flow-add">
          <input
            className="proto-input"
            placeholder="Flow name"
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
          />
          <select
            className="proto-select"
            value={flowStart}
            onChange={(e) => setFlowStart(e.target.value)}
          >
            <option value="">Start frame...</option>
            {frames.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button className="proto-add-btn-sm" onClick={handleAdd}>
            Create
          </button>
        </div>
      )}

      {flows.map((flow) => (
        <div key={flow.id} className="proto-flow-item">
          <span className="proto-flow-name">{flow.name}</span>
          <span className="proto-flow-frame">
            {frames.find((f) => f.id === flow.startFrameId)?.name || "—"}
          </span>
          <div className="proto-flow-actions">
            <button
              className="proto-play-btn"
              onClick={() => {
                prototype.startPreview(flow.id);
                onStartPreview();
              }}
              title="Preview this flow"
            >
              ▶
            </button>
            <button
              className="proto-delete-btn-sm"
              onClick={() => prototype.removeFlow(flow.id)}
              title="Delete flow"
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      {flows.length === 0 && !showAdd && (
        <div className="proto-empty-hint">
          No flows yet. Add a flow to define a prototype path.
        </div>
      )}

      {flows.length > 0 && (
        <button
          className="proto-preview-all-btn"
          onClick={() => {
            prototype.startPreview();
            onStartPreview();
          }}
        >
          ▶ Preview Prototype
        </button>
      )}
    </div>
  );
}
