import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/supabase";
import type {
  DesignGraphNode,
  DesignGraphBrand,
  DesignGraphContact,
} from "../lib/designGraph";

/**
 * GraphDataTable — live, inline-editable table view of the raw data that feeds
 * the design knowledge graph (brands, contacts, design files).
 *
 * Editing a cell persists immediately on Enter / blur through the existing
 * REST endpoints, then calls `onAfterEdit` so the parent can re-fetch the graph
 * and every connected node stays in sync.
 *
 * Endpoints used (all pre-existing):
 *   Brands    → PATCH /api/workspaces/:id/brands/:brandId
 *   Contacts  → PATCH /api/workspaces/:id/contacts/:contactId
 *   Files     → PUT    /api/meta/:templateId
 */

interface Props {
  workspaceId: string | null;
  designNodes: DesignGraphNode[];
  brandAccounts: DesignGraphBrand[];
  contacts: DesignGraphContact[];
  onAfterEdit: () => void;
}

type DatasetKey = "brands" | "contacts" | "files";

const tableWrap: React.CSSProperties = {
  height: "100%",
  overflow: "auto",
  fontFamily: "Inter, system-ui, sans-serif",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  position: "sticky",
  top: 0,
  zIndex: 2,
  background: "rgba(18,20,28,0.96)",
  backdropFilter: "blur(8px)",
  color: "rgba(255,255,255,0.45)",
  fontWeight: 500,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  color: "rgba(255,255,255,0.82)",
  whiteSpace: "nowrap",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 60,
  background: "rgba(99,102,241,0.12)",
  border: "1px solid rgba(99,102,241,0.5)",
  borderRadius: 4,
  padding: "3px 6px",
  color: "#fff",
  fontSize: 12,
  fontFamily: "inherit",
  outline: "none",
};

const subTabStyle = (active: boolean): React.CSSProperties => ({
  padding: "5px 14px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: active ? 600 : 400,
  color: active ? "#fff" : "rgba(255,255,255,0.45)",
  background: active ? "rgba(99,102,241,0.22)" : "transparent",
  border: active ? "1px solid rgba(99,102,241,0.5)" : "1px solid transparent",
  transition: "all 0.15s",
});

export function GraphDataTable({ workspaceId, designNodes, brandAccounts, contacts, onAfterEdit }: Props) {
  const [dataset, setDataset] = useState<DatasetKey>("brands");

  return (
    <div style={tableWrap}>
      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 4, padding: "10px 14px 6px", borderBottom: "1px solid rgba(255,255,255,0.06)", position: "sticky", top: 0, zIndex: 3, background: "rgba(12,14,20,0.96)", backdropFilter: "blur(8px)" }}>
        <button type="button" style={subTabStyle(dataset === "brands")} onClick={() => setDataset("brands")}>
          Marcas <Badge>{brandAccounts.length}</Badge>
        </button>
        <button type="button" style={subTabStyle(dataset === "contacts")} onClick={() => setDataset("contacts")}>
          Contactos <Badge>{contacts.length}</Badge>
        </button>
        <button type="button" style={subTabStyle(dataset === "files")} onClick={() => setDataset("files")}>
          Archivos <Badge>{designNodes.length}</Badge>
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", alignSelf: "center" }}>
          Click en una celda para editar · Enter o click afuera para guardar
        </span>
      </div>

      {dataset === "brands" && (
        <BrandsTable workspaceId={workspaceId} brands={brandAccounts} onAfterEdit={onAfterEdit} />
      )}
      {dataset === "contacts" && (
        <ContactsTable workspaceId={workspaceId} contacts={contacts} onAfterEdit={onAfterEdit} />
      )}
      {dataset === "files" && (
        <FilesTable designNodes={designNodes} onAfterEdit={onAfterEdit} />
      )}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ marginLeft: 4, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>({children})</span>
  );
}

// ── Reusable inline-editable cell ──────────────────────────────────────────

function EditableCell({
  value,
  onCommit,
  placeholder = "",
  monospace = false,
}: {
  value: string;
  onCommit: (next: string) => Promise<void>;
  placeholder?: string;
  monospace?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = useCallback(async () => {
    if (savingRef.current) return;
    const trimmed = draft.trim();
    if (trimmed === value) { setEditing(false); return; }
    savingRef.current = true;
    try {
      await onCommit(trimmed);
      setEditing(false);
    } finally {
      savingRef.current = false;
    }
  }, [draft, value, onCommit]);

  if (editing) {
    return (
      <td style={tdStyle}>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); void commit(); }
            if (e.key === "Escape") { setDraft(value); setEditing(false); }
          }}
          onBlur={() => void commit()}
          style={{ ...inputStyle, fontFamily: monospace ? "'SF Mono', monospace" : "inherit" }}
        />
      </td>
    );
  }

  return (
    <td
      style={{ ...tdStyle, cursor: "text", fontFamily: monospace ? "'SF Mono', monospace" : "inherit" }}
      onClick={() => setEditing(true)}
      title="Click para editar"
    >
      {value || <span style={{ color: "rgba(255,255,255,0.25)" }}>{placeholder}</span>}
    </td>
  );
}

// ── Read-only cell for ids / non-editable fields ──
function ReadOnlyCell({ value, monospace = true }: { value: string; monospace?: boolean }) {
  return (
    <td style={{ ...tdStyle, color: "rgba(255,255,255,0.4)", fontFamily: monospace ? "'SF Mono', monospace" : "inherit" }}>
      {value}
    </td>
  );
}

// ── Brands table ───────────────────────────────────────────────────────────

function BrandsTable({ workspaceId, brands, onAfterEdit }: {
  workspaceId: string | null;
  brands: DesignGraphBrand[];
  onAfterEdit: () => void;
}) {
  const patchBrand = useCallback(async (brandId: string, body: Record<string, unknown>) => {
    if (!workspaceId) return;
    await apiFetch(`/api/workspaces/${workspaceId}/brands/${brandId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    onAfterEdit();
  }, [workspaceId, onAfterEdit]);

  if (brands.length === 0) return <Empty message="No hay marcas registradas." />;

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>ID</th>
          <th style={thStyle}>Nombre</th>
          <th style={thStyle}>Estado</th>
        </tr>
      </thead>
      <tbody>
        {brands.map(b => (
          <tr key={b.id}>
            <ReadOnlyCell value={b.id} />
            <EditableCell
              value={b.name}
              placeholder="Sin nombre"
              onCommit={async name => patchBrand(b.id, { name })}
            />
            <EditableCell
              value={b.relationship_status || ""}
              placeholder="lead"
              onCommit={async relationshipStatus => patchBrand(b.id, { relationshipStatus })}
            />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Contacts table ─────────────────────────────────────────────────────────

function ContactsTable({ workspaceId, contacts, onAfterEdit }: {
  workspaceId: string | null;
  contacts: DesignGraphContact[];
  onAfterEdit: () => void;
}) {
  const patchContact = useCallback(async (contactId: string, body: Record<string, unknown>) => {
    if (!workspaceId) return;
    await apiFetch(`/api/workspaces/${workspaceId}/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    onAfterEdit();
  }, [workspaceId, onAfterEdit]);

  if (contacts.length === 0) return <Empty message="No hay contactos registrados." />;

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Marca</th>
          <th style={thStyle}>Nombre</th>
          <th style={thStyle}>Apellido</th>
          <th style={thStyle}>Email</th>
          <th style={thStyle}>Cargo</th>
          <th style={thStyle}>Estado</th>
        </tr>
      </thead>
      <tbody>
        {contacts.map(c => (
          <tr key={c.id}>
            <EditableCell
              value={c.brand_name || ""}
              placeholder="—"
              onCommit={async brandName => patchContact(c.id, { brandName })}
            />
            <EditableCell
              value={c.first_name || ""}
              placeholder="—"
              onCommit={async firstName => patchContact(c.id, { firstName })}
            />
            <EditableCell
              value={c.last_name || ""}
              placeholder="—"
              onCommit={async lastName => patchContact(c.id, { lastName })}
            />
            <EditableCell
              value={c.email || ""}
              placeholder="—"
              onCommit={async email => patchContact(c.id, { email })}
            />
            <EditableCell
              value={c.job_title || ""}
              placeholder="—"
              onCommit={async jobTitle => patchContact(c.id, { jobTitle })}
            />
            <EditableCell
              value={c.status || ""}
              placeholder="—"
              onCommit={async status => patchContact(c.id, { status })}
            />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Design files table ─────────────────────────────────────────────────────

function FilesTable({ designNodes, onAfterEdit }: {
  designNodes: DesignGraphNode[];
  onAfterEdit: () => void;
}) {
  const putMeta = useCallback(async (templateId: string, body: Record<string, unknown>) => {
    await apiFetch(`/api/meta/${templateId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    onAfterEdit();
  }, [onAfterEdit]);

  if (designNodes.length === 0) return <Empty message="No hay archivos de diseño." />;

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Archivo</th>
          <th style={thStyle}>Marca</th>
          <th style={thStyle}>Campaña</th>
          <th style={thStyle}>Tipo</th>
          <th style={thStyle}>Tema</th>
          <th style={thStyle}>Formato</th>
        </tr>
      </thead>
      <tbody>
        {designNodes.map(n => (
          <tr key={n.id}>
            <ReadOnlyCell value={n.name} monospace={false} />
            <EditableCell
              value={n.brand || ""}
              placeholder="—"
              onCommit={async brand => putMeta(n.id, { brand })}
            />
            <EditableCell
              value={n.campaign || ""}
              placeholder="—"
              onCommit={async campaign => putMeta(n.id, { campaign })}
            />
            <EditableCell
              value={n.asset_type || ""}
              placeholder="—"
              onCommit={async asset_type => putMeta(n.id, { asset_type })}
            />
            <EditableCell
              value={n.theme || ""}
              placeholder="—"
              onCommit={async theme => putMeta(n.id, { theme })}
            />
            <EditableCell
              value={n.format || ""}
              placeholder="—"
              onCommit={async format => putMeta(n.id, { format })}
            />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
      {message}
    </div>
  );
}
