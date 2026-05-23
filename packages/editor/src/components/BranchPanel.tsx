import { useState } from "react";
import type { Branch } from "@futuraria/shared";

interface BranchConflict {
  layerId: string;
  layerName: string;
  sourceVersion: any;
  targetVersion: any;
}

interface Props {
  branches: Branch[];
  currentBranchId: string | null;
  onCreateBranch: (name: string) => void;
  onSwitchBranch: (branchId: string) => void;
  onMergeBranch: (sourceBranchId: string) => BranchConflict[];
  onDeleteBranch: (branchId: string) => void;
  onResolveConflict: (layerId: string, useSource: boolean) => void;
  conflicts: BranchConflict[];
  onClearConflicts: () => void;
  onClose: () => void;
}

export function BranchPanel({
  branches,
  currentBranchId,
  onCreateBranch,
  onSwitchBranch,
  onMergeBranch,
  onDeleteBranch,
  onResolveConflict,
  conflicts,
  onClearConflicts,
  onClose,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [mergingFrom, setMergingFrom] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const handleCreate = () => {
    if (!newBranchName.trim()) return;
    onCreateBranch(newBranchName.trim());
    setNewBranchName("");
    setShowCreate(false);
  };

  const handleMerge = (sourceBranchId: string) => {
    const result = onMergeBranch(sourceBranchId);
    if (result.length === 0) {
      setMergingFrom(null);
    }
    // conflicts are handled via props
  };

  const handleContextMenu = (e: React.MouseEvent, branchId: string) => {
    e.preventDefault();
    setContextMenu({ id: branchId, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="branch-panel" onClick={() => setContextMenu(null)}>
      <div className="branch-panel-header">
        <span className="branch-panel-title">🌿 Branches</span>
        <button className="branch-panel-close" onClick={onClose}>✕</button>
      </div>

      {/* Current branch indicator */}
      {currentBranchId && (
        <div className="branch-current">
          <span className="branch-current-label">Current:</span>
          <span className="branch-current-name">
            {branches.find(b => b.id === currentBranchId)?.name || "main"}
          </span>
        </div>
      )}

      {/* Branch list */}
      <div className="branch-list">
        {branches.map((branch) => {
          const isCurrent = branch.id === currentBranchId;
          return (
            <div
              key={branch.id}
              className={`branch-item ${isCurrent ? "active" : ""}`}
              onClick={() => !isCurrent && onSwitchBranch(branch.id)}
              onContextMenu={(e) => handleContextMenu(e, branch.id)}
            >
              <span className="branch-icon">{isCurrent ? "●" : "○"}</span>
              <div className="branch-info">
                <span className="branch-name">{branch.name}</span>
                <span className="branch-meta">
                  {new Date(branch.createdAt).toLocaleDateString()}
                  {branch.parentBranchId && " • branched"}
                </span>
              </div>
              {!isCurrent && (
                <div className="branch-actions">
                  <button
                    className="branch-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMergingFrom(branch.id);
                    }}
                    title="Merge into current"
                  >
                    ⤓
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create branch */}
      {showCreate ? (
        <div className="branch-create-form">
          <input
            type="text"
            className="branch-create-input"
            placeholder="Branch name"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setShowCreate(false);
            }}
            autoFocus
          />
          <div className="branch-create-actions">
            <button className="branch-btn primary" onClick={handleCreate}>Create</button>
            <button className="branch-btn" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="branch-create-btn" onClick={() => setShowCreate(true)}>
          + New Branch
        </button>
      )}

      {/* Merge confirmation */}
      {mergingFrom && (
        <div className="branch-merge-confirm">
          <p>
            Merge <strong>{branches.find(b => b.id === mergingFrom)?.name}</strong> into{" "}
            <strong>{branches.find(b => b.id === currentBranchId)?.name || "main"}</strong>?
          </p>
          <div className="branch-create-actions">
            <button className="branch-btn primary" onClick={() => handleMerge(mergingFrom)}>
              Merge
            </button>
            <button className="branch-btn" onClick={() => setMergingFrom(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Conflict resolution */}
      {conflicts.length > 0 && (
        <div className="branch-conflicts">
          <h4 className="branch-conflicts-title">⚠️ Merge Conflicts</h4>
          {conflicts.map((conflict) => (
            <div key={conflict.layerId} className="branch-conflict-item">
              <span className="conflict-layer-name">{conflict.layerName}</span>
              <div className="conflict-actions">
                <button
                  className="branch-btn small"
                  onClick={() => onResolveConflict(conflict.layerId, true)}
                >
                  Keep Source
                </button>
                <button
                  className="branch-btn small"
                  onClick={() => onResolveConflict(conflict.layerId, false)}
                >
                  Keep Current
                </button>
              </div>
            </div>
          ))}
          <button className="branch-btn" onClick={onClearConflicts}>Done</button>
        </div>
      )}

      {/* Keyboard shortcut hint */}
      <div className="branch-hint">
        <span>Ctrl+Shift+B → New branch</span>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
          <button onClick={() => {
            const name = prompt("Rename branch:", branches.find(b => b.id === contextMenu.id)?.name);
            if (name) {
              // handled via parent
            }
            setContextMenu(null);
          }}>Rename</button>
          {contextMenu.id !== currentBranchId && (
            <button className="danger" onClick={() => {
              onDeleteBranch(contextMenu.id);
              setContextMenu(null);
            }}>Delete</button>
          )}
        </div>
      )}
    </div>
  );
}
