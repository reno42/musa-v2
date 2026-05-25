import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../lib/supabase";
import { listTemplates, saveLocal } from "../lib/templateApi";
import type { DesignTemplate } from "@futuraria/shared";

interface DashboardProps {
  userId: string;
  onSelectTemplate: (templateId: string) => void;
  onCreateNew: () => void;
}

interface TemplateCard {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  thumbnail?: string;
  layerCount: number;
}

export function Dashboard({ userId, onSelectTemplate, onCreateNew }: DashboardProps) {
  const [templates, setTemplates] = useState<TemplateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listTemplates(50, 0);
      const cards: TemplateCard[] = res.data.map((t: any) => ({
        id: t.id,
        name: t.name,
        updatedAt: t.metadata?.updatedAt || t.updatedAt || "",
        createdAt: t.metadata?.createdAt || t.createdAt || "",
        layerCount: t.layers?.length || t.canvas?.objects?.length || 0,
      }));
      setTemplates(cards);
    } catch (err: any) {
      setError((err as Error).message || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleCreateNew = useCallback(async () => {
    const name = `Untitled ${new Date().toLocaleDateString()}`;
    try {
      const res = await apiFetch<{ data: DesignTemplate }>("/api/templates", {
        method: "POST",
        body: JSON.stringify({ name, width: 1080, height: 1080 }),
      });
      onSelectTemplate(res.data.id);
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("fetch") || msg.includes("NetworkError") || msg.includes("Failed to fetch") || msg.includes("500")) {
        // Offline: create local template and navigate directly
        const id = `tpl_local_${Date.now()}`;
        saveLocal(id, {
          name,
          canvas: { objects: [], viewport: { zoom: 1, x: 0, y: 0 } },
          metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          width: 1080,
          height: 1080,
          pages: [{ id: "page1", name: "Page 1", frames: [] }],
          frames: [],
        });
        onSelectTemplate(id);
      } else {
        setError(msg || "Failed to create template");
      }
    }
  }, [onSelectTemplate]);

  const handleDelete = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!confirm("Delete this template? This cannot be undone.")) return;
      try {
        await apiFetch(`/api/templates/${id}`, { method: "DELETE" });
        setTemplates((prev) => prev.filter((t) => t.id !== id));
      } catch (err: any) {
        setError(err.message || "Failed to delete template");
      }
    },
    []
  );

  const handleDuplicate = useCallback(
    async (id: string, name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const res = await apiFetch<{ data: DesignTemplate }>(
          `/api/templates/${id}/duplicate`,
          {
            method: "POST",
            body: JSON.stringify({ name: `${name} (copy)` }),
          }
        );
        setTemplates((prev) => [
          {
            id: res.data.id,
            name: res.data.name,
            updatedAt: res.data.metadata.updatedAt,
            createdAt: res.data.metadata.createdAt,
            layerCount: res.data.layers?.length || 0,
          },
          ...prev,
        ]);
      } catch (err: any) {
        setError(err.message || "Failed to duplicate template");
      }
    },
    []
  );

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="dashboard-brand">
          <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="8" fill="#6366f1" />
            <path d="M12 28V12h6l5 8 5-8h6v16h-5V18l-6 10-6-10v10z" fill="white" />
          </svg>
          <div>
            <h1 className="dashboard-title">Futuraria Design</h1>
            <p className="dashboard-subtitle">Your design templates</p>
          </div>
        </div>
        <button className="btn-new-template" onClick={handleCreateNew}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="8" y1="2" x2="8" y2="14" />
            <line x1="2" y1="8" x2="14" y2="8" />
          </svg>
          New Template
        </button>
      </div>

      {error && (
        <div className="dashboard-error">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {loading ? (
        <div className="dashboard-loading">
          <div className="spinner" />
          <span>Loading templates...</span>
        </div>
      ) : templates.length === 0 ? (
        <div className="dashboard-empty">
          <div className="empty-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#555" strokeWidth="1.5">
              <rect x="6" y="6" width="36" height="36" rx="4" />
              <line x1="24" y1="16" x2="24" y2="32" />
              <line x1="16" y1="24" x2="32" y2="24" />
            </svg>
          </div>
          <h2>No templates yet</h2>
          <p>Create your first design template to get started.</p>
          <button className="btn-new-template" onClick={handleCreateNew}>
            Create Template
          </button>
        </div>
      ) : (
        <div className="dashboard-grid">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className="template-card"
              onClick={() => onSelectTemplate(tpl.id)}
            >
              <div className="template-thumbnail">
                <div className="template-thumbnail-placeholder">
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="#555" strokeWidth="1">
                    <rect x="4" y="4" width="24" height="24" rx="2" />
                    <circle cx="12" cy="12" r="3" />
                    <path d="M4 22l6-6 4 4 6-6 8 8" />
                  </svg>
                  <span>{tpl.layerCount} element{tpl.layerCount !== 1 ? "s" : ""}</span>
                </div>
              </div>
              <div className="template-info">
                <span className="template-name">{tpl.name}</span>
                <span className="template-date">
                  Updated {formatDate(tpl.updatedAt)}
                </span>
              </div>
              <div className="template-actions">
                <button
                  className="template-action-btn"
                  title="Duplicate"
                  onClick={(e) => handleDuplicate(tpl.id, tpl.name, e)}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="1" y="3" width="8" height="8" rx="1" />
                    <path d="M3 3V2a1 1 0 011-1h7a1 1 0 011 1v7a1 1 0 01-1 1h-1" />
                  </svg>
                </button>
                <button
                  className="template-action-btn danger"
                  title="Delete"
                  onClick={(e) => handleDelete(tpl.id, e)}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 4h10M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M4 4v7a1 1 0 001 1h4a1 1 0 001-1V4" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
