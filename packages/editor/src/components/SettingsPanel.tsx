import { useState, useEffect, useCallback } from "react";
import { apiFetch, setStoredApiKey } from "../lib/supabase";

// ─── Types ───────────────────────────────────────────────────────
interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  last_used_at: string | null;
  active: boolean;
  created_at: string;
}

interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
  created_at: string;
}

interface SettingsPanelProps {
  onClose: () => void;
}

/** Alias: uses apiFetch from supabase.ts (includes stored API key). */
function authFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(url, options);
}

const WEBHOOK_EVENTS = [
  "template.created",
  "template.updated",
  "render.complete",
  "export.complete",
  "export.requested",
  "version.created",
  "comment.created",
  "layer.updated",
  "style.created",
  "component.created",
];

// ─── Settings Panel Component ────────────────────────────────────
export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<"api-keys" | "webhooks">("api-keys");

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  // Webhooks state
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loadingWebhooks, setLoadingWebhooks] = useState(true);
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>(["template.created"]);
  const [newWebhookSecret, setNewWebhookSecret] = useState("");
  const [creatingWebhook, setCreatingWebhook] = useState(false);

  // ─── Load API Keys ─────────────────────────────────────────────
  const loadApiKeys = useCallback(async () => {
    setLoadingKeys(true);
    try {
      const res = await authFetch<{ success: boolean; data: ApiKey[] }>("/api/api-keys");
      if (res.success) setApiKeys(res.data);
    } catch (err: any) {
      console.error("Failed to load API keys:", err.message);
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  // ─── Load Webhooks ─────────────────────────────────────────────
  const loadWebhooks = useCallback(async () => {
    setLoadingWebhooks(true);
    try {
      const res = await authFetch<{ success: boolean; data: Webhook[] }>("/api/webhooks");
      if (res.success) setWebhooks(res.data);
    } catch (err: any) {
      console.error("Failed to load webhooks:", err.message);
    } finally {
      setLoadingWebhooks(false);
    }
  }, []);

  useEffect(() => {
    loadApiKeys();
    loadWebhooks();
  }, [loadApiKeys, loadWebhooks]);

  // ─── Create API Key ────────────────────────────────────────────
  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const res = await authFetch<{ success: boolean; data: { id: string; key: string } }>(
        "/api/api-keys",
        {
          method: "POST",
          body: JSON.stringify({ name: newKeyName.trim() }),
        }
      );
      if (res.success) {
        // Store the key locally so subsequent requests are authenticated
        setStoredApiKey(res.data.key);
        setCreatedKey(res.data.key);
        setNewKeyName("");
        loadApiKeys();
      }
    } catch (err: any) {
      alert("Error creating key: " + err.message);
    } finally {
      setCreatingKey(false);
    }
  };

  // ─── Delete API Key ────────────────────────────────────────────
  const handleDeleteKey = async (id: string) => {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    try {
      await authFetch(`/api/api-keys/${id}`, { method: "DELETE" });
      setApiKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (err: any) {
      alert("Error deleting key: " + err.message);
    }
  };

  // ─── Create Webhook ────────────────────────────────────────────
  const handleCreateWebhook = async () => {
    if (!newWebhookUrl.trim() || newWebhookEvents.length === 0) return;
    setCreatingWebhook(true);
    try {
      const res = await authFetch<{ success: boolean; data: Webhook }>(
        "/api/webhooks",
        {
          method: "POST",
          body: JSON.stringify({
            url: newWebhookUrl.trim(),
            events: newWebhookEvents,
            secret: newWebhookSecret.trim() || undefined,
          }),
        }
      );
      if (res.success) {
        setNewWebhookUrl("");
        setNewWebhookEvents(["template.created"]);
        setNewWebhookSecret("");
        loadWebhooks();
      }
    } catch (err: any) {
      alert("Error creating webhook: " + err.message);
    } finally {
      setCreatingWebhook(false);
    }
  };

  // ─── Delete Webhook ────────────────────────────────────────────
  const handleDeleteWebhook = async (id: string) => {
    if (!confirm("Delete this webhook?")) return;
    try {
      await authFetch(`/api/webhooks/${id}`, { method: "DELETE" });
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch (err: any) {
      alert("Error deleting webhook: " + err.message);
    }
  };

  // ─── Toggle webhook event ──────────────────────────────────────
  const toggleEvent = (event: string) => {
    setNewWebhookEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  // ─── Copy to clipboard ─────────────────────────────────────────
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#1a1a2e",
          borderRadius: 12,
          width: 680,
          maxHeight: "80vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          border: "1px solid #333",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid #333",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#888"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
            <span style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>Settings</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              cursor: "pointer",
              fontSize: 18,
              padding: "4px 8px",
              borderRadius: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #333",
          }}
        >
          <button
            onClick={() => setActiveTab("api-keys")}
            style={{
              flex: 1,
              padding: "12px 16px",
              background: activeTab === "api-keys" ? "#252540" : "transparent",
              border: "none",
              borderBottom: activeTab === "api-keys" ? "2px solid #6366f1" : "2px solid transparent",
              color: activeTab === "api-keys" ? "#fff" : "#888",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              transition: "all 0.15s",
            }}
          >
            🔑 API Keys
          </button>
          <button
            onClick={() => setActiveTab("webhooks")}
            style={{
              flex: 1,
              padding: "12px 16px",
              background: activeTab === "webhooks" ? "#252540" : "transparent",
              border: "none",
              borderBottom: activeTab === "webhooks" ? "2px solid #6366f1" : "2px solid transparent",
              color: activeTab === "webhooks" ? "#fff" : "#888",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              transition: "all 0.15s",
            }}
          >
            🔔 Webhooks
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {/* ─── API Keys Tab ──────────────────────────────────── */}
          {activeTab === "api-keys" && (
            <div>
              {/* Create new key */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 20,
                  padding: 16,
                  background: "#252540",
                  borderRadius: 8,
                  border: "1px solid #333",
                }}
              >
                <input
                  type="text"
                  placeholder="Key name (e.g., 'n8n integration')"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    background: "#1a1a2e",
                    border: "1px solid #444",
                    borderRadius: 6,
                    color: "#fff",
                    fontSize: 13,
                    outline: "none",
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateKey()}
                />
                <button
                  onClick={handleCreateKey}
                  disabled={creatingKey || !newKeyName.trim()}
                  style={{
                    padding: "8px 16px",
                    background: creatingKey ? "#444" : "#6366f1",
                    border: "none",
                    borderRadius: 6,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: creatingKey ? "not-allowed" : "pointer",
                    opacity: !newKeyName.trim() ? 0.5 : 1,
                  }}
                >
                  {creatingKey ? "Creating..." : "Create Key"}
                </button>
              </div>

              {/* Created key alert */}
              {createdKey && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: 16,
                    background: "#1a3a1a",
                    border: "1px solid #2d6a2d",
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#4ade80", marginBottom: 8 }}>
                    ✅ API Key Created — Copy it now, it won't be shown again!
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      background: "#0a0a0a",
                      padding: "8px 12px",
                      borderRadius: 6,
                      fontFamily: "monospace",
                      fontSize: 12,
                      color: "#fff",
                      wordBreak: "break-all",
                    }}
                  >
                    <span style={{ flex: 1 }}>{createdKey}</span>
                    <button
                      onClick={() => copyToClipboard(createdKey)}
                      style={{
                        background: "#333",
                        border: "none",
                        borderRadius: 4,
                        padding: "4px 8px",
                        color: "#fff",
                        cursor: "pointer",
                        fontSize: 11,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Copy
                    </button>
                  </div>
                  <button
                    onClick={() => setCreatedKey(null)}
                    style={{
                      marginTop: 8,
                      background: "none",
                      border: "none",
                      color: "#888",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Keys list */}
              {loadingKeys ? (
                <div style={{ color: "#888", fontSize: 13, textAlign: "center", padding: 40 }}>
                  Loading keys...
                </div>
              ) : apiKeys.length === 0 ? (
                <div style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 40 }}>
                  No API keys yet. Create one above.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {apiKeys.map((key) => (
                    <div
                      key={key.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 16px",
                        background: "#252540",
                        borderRadius: 8,
                        border: "1px solid #333",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: "#fff", marginBottom: 4 }}>
                          {key.name}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            fontFamily: "monospace",
                            color: "#888",
                            marginBottom: 4,
                          }}
                        >
                          {key.key_prefix}...
                        </div>
                        <div style={{ fontSize: 11, color: "#666" }}>
                          Created: {new Date(key.created_at).toLocaleDateString()}
                          {key.last_used_at && (
                            <> · Last used: {new Date(key.last_used_at).toLocaleDateString()}</>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          onClick={() => handleDeleteKey(key.id)}
                          style={{
                            padding: "6px 12px",
                            background: "#3a1a1a",
                            border: "1px solid #5a2a2a",
                            borderRadius: 4,
                            color: "#f87171",
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          Revoke
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── Webhooks Tab ──────────────────────────────────── */}
          {activeTab === "webhooks" && (
            <div>
              {/* Create new webhook */}
              <div
                style={{
                  marginBottom: 20,
                  padding: 16,
                  background: "#252540",
                  borderRadius: 8,
                  border: "1px solid #333",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 12 }}>
                  Register New Webhook
                </div>
                <input
                  type="url"
                  placeholder="https://your-n8n.example.com/webhook/..."
                  value={newWebhookUrl}
                  onChange={(e) => setNewWebhookUrl(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "#1a1a2e",
                    border: "1px solid #444",
                    borderRadius: 6,
                    color: "#fff",
                    fontSize: 13,
                    outline: "none",
                    marginBottom: 12,
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Events:</div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginBottom: 12,
                  }}
                >
                  {WEBHOOK_EVENTS.map((event) => (
                    <button
                      key={event}
                      onClick={() => toggleEvent(event)}
                      style={{
                        padding: "4px 10px",
                        background: newWebhookEvents.includes(event) ? "#6366f1" : "#1a1a2e",
                        border: `1px solid ${newWebhookEvents.includes(event) ? "#6366f1" : "#444"}`,
                        borderRadius: 20,
                        color: newWebhookEvents.includes(event) ? "#fff" : "#888",
                        cursor: "pointer",
                        fontSize: 11,
                        transition: "all 0.15s",
                      }}
                    >
                      {event}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Secret (optional, for HMAC signature)"
                    value={newWebhookSecret}
                    onChange={(e) => setNewWebhookSecret(e.target.value)}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      background: "#1a1a2e",
                      border: "1px solid #444",
                      borderRadius: 6,
                      color: "#fff",
                      fontSize: 13,
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={handleCreateWebhook}
                    disabled={creatingWebhook || !newWebhookUrl.trim() || newWebhookEvents.length === 0}
                    style={{
                      padding: "8px 16px",
                      background: creatingWebhook ? "#444" : "#6366f1",
                      border: "none",
                      borderRadius: 6,
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: creatingWebhook ? "not-allowed" : "pointer",
                      opacity: !newWebhookUrl.trim() ? 0.5 : 1,
                    }}
                  >
                    {creatingWebhook ? "Creating..." : "Register"}
                  </button>
                </div>
              </div>

              {/* Webhooks list */}
              {loadingWebhooks ? (
                <div style={{ color: "#888", fontSize: 13, textAlign: "center", padding: 40 }}>
                  Loading webhooks...
                </div>
              ) : webhooks.length === 0 ? (
                <div style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 40 }}>
                  No webhooks registered yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {webhooks.map((wh) => (
                    <div
                      key={wh.id}
                      style={{
                        padding: "12px 16px",
                        background: "#252540",
                        borderRadius: 8,
                        border: "1px solid #333",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 12,
                            fontFamily: "monospace",
                            color: "#fff",
                            wordBreak: "break-all",
                            flex: 1,
                            marginRight: 12,
                          }}
                        >
                          {wh.url}
                        </div>
                        <button
                          onClick={() => handleDeleteWebhook(wh.id)}
                          style={{
                            padding: "4px 10px",
                            background: "#3a1a1a",
                            border: "1px solid #5a2a2a",
                            borderRadius: 4,
                            color: "#f87171",
                            cursor: "pointer",
                            fontSize: 11,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {wh.events.map((event) => (
                          <span
                            key={event}
                            style={{
                              padding: "2px 8px",
                              background: "#1a1a2e",
                              borderRadius: 12,
                              fontSize: 10,
                              color: "#888",
                            }}
                          >
                            {event}
                          </span>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, color: "#555", marginTop: 6 }}>
                        ID: {wh.id} · Created: {new Date(wh.created_at).toLocaleDateString()}
                        {wh.secret && " · 🔒 HMAC signed"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid #333",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 11, color: "#555" }}>
            Futuraria Design v0.3 · API & Webhook Management
          </span>
          <button
            onClick={onClose}
            style={{
              padding: "6px 16px",
              background: "#333",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
