import { useCallback, useEffect, useState } from "react";

/**
 * MobileComments — the public guest page behind share links `/c/:templateId`.
 *
 * A phone lands here straight from a link (no account, no API key). The guest
 * sees the design, taps anywhere on it to pin a comment, writes their feedback
 * and, if they want their AIs to act on it, checks the Kanban option so the
 * comment also files a `design_kanban_tasks` card (tags: comment, mobile_pin).
 *
 * Data flows through the public API `/api/comments-share/:templateId`
 * (api/src/routes/commentShare.ts): GET preview + comments, POST comment.
 * Comments land in `design_comments` with source `mobile_pin` — the same rows
 * the editor's comment layer and the Kanban tab read.
 */

type ShareComment = {
  id: string;
  body: string;
  author_name: string;
  x_pct: number;
  y_pct: number;
  status: string;
  source: string;
  kanban_task_id: string | null;
  created_at: string;
};

type ShareTemplate = {
  id: string;
  name: string;
  workspaceId: string | null;
  isBrandManual: boolean;
  thumbnail: string | null;
  width: number;
  height: number;
};

type ShareData = {
  template: ShareTemplate;
  comments: ShareComment[];
};

const clampPct = (n: number): number => Math.max(0, Math.min(100, n));

export function MobileComments({ templateId }: { templateId: string }): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [template, setTemplate] = useState<ShareTemplate | null>(null);
  const [comments, setComments] = useState<ShareComment[]>([]);
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [authorName, setAuthorName] = useState("");
  const [body, setBody] = useState("");
  const [sendToKanban, setSendToKanban] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sentKind, setSentKind] = useState<"comment" | "kanban" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/comments-share/${encodeURIComponent(templateId)}`);
      const payload = await res.json();
      if (!res.ok || !payload.success || !payload.data) {
        setLoadError(res.status === 404 ? "Este diseño no existe o ya no está compartido." : (payload.error || "No se pudo cargar el diseño."));
        return;
      }
      const data = payload.data as ShareData;
      setTemplate(data.template);
      setComments(data.comments || []);
    } catch {
      setLoadError("Error de conexión. Revisá tu internet e intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => { void load(); }, [load]);

  // Tap the preview → place (or move) the comment pin. Pct coords survive
  // any screen size: they map to the same point inside the design frames.
  const handlePreviewTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPin({
      x: clampPct(((e.clientX - rect.left) / rect.width) * 100),
      y: clampPct(((e.clientY - rect.top) / rect.height) * 100),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const text = body.trim();
    if (!text) { setFormError("Escribí un comentario antes de enviar."); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/comments-share/${encodeURIComponent(templateId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: text,
          authorName: authorName.trim() || undefined,
          xPct: pin?.x ?? 50,
          yPct: pin?.y ?? 50,
          createKanbanTask: sendToKanban,
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        setFormError(payload.error || "No se pudo guardar el comentario.");
        return;
      }
      const created = payload.data?.comment as ShareComment | undefined;
      const kanbanTaskId = payload.data?.kanbanTask?.id as string | undefined;
      if (created) {
        const withTask = kanbanTaskId ? { ...created, kanban_task_id: kanbanTaskId } : created;
        setComments(prev => [withTask, ...prev.filter(c => c.id !== created.id)]);
      }
      setBody("");
      setPin(null);
      setSentKind(kanbanTaskId ? "kanban" : "comment");
      window.setTimeout(() => setSentKind(null), 5000);
    } catch {
      setFormError("Error de conexión. Tu comentario no se guardó — intentá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="mc-page">
        <div className="mc-card mc-center">
          <p className="mc-status" role="status">Cargando diseño…</p>
        </div>
      </main>
    );
  }

  if (loadError || !template) {
    return (
      <main className="mc-page">
        <div className="mc-card mc-center">
          <p className="mc-status mc-error" role="alert">{loadError || "Diseño no disponible."}</p>
          <button type="button" className="mc-btn mc-btn-secondary" onClick={() => void load()}>Reintentar</button>
          <a className="mc-home-link" href="/">Ir a Musa by Futuraria</a>
        </div>
      </main>
    );
  }

  const pinBadges = comments.map((c, i) => ({
    ...c,
    order: i + 1,
  }));

  return (
    <main className="mc-page">
      <div className="mc-card">
        <header className="mc-header">
          <a className="mc-brand" href="/" aria-label="Musa by Futuraria">
            <span className="mc-brand-mark">F</span>
            <span>Musa by Futuraria</span>
          </a>
          <h1 className="mc-title">{template.name}</h1>
          <p className="mc-sub">Dejá tu comentario tocando el diseño. Sin cuenta, sin descargas.</p>
        </header>

        {/* ── Design preview: tap to pin ── */}
        <div
          className="mc-preview"
          style={{ aspectRatio: `${template.width} / ${template.height}` }}
          onClick={handlePreviewTap}
          role="button"
          aria-label="Tocá el diseño para colocar tu comentario"
        >
          {template.thumbnail ? (
            <img className="mc-preview-img" src={template.thumbnail} alt={template.name} />
          ) : (
            <div className="mc-preview-fallback">{template.name.charAt(0).toUpperCase()}</div>
          )}
          {pinBadges.map((c) => (
            <span
              key={c.id}
              className={`mc-pin${c.status !== "open" ? " mc-pin-resolved" : ""}`}
              style={{ left: `${c.x_pct}%`, top: `${c.y_pct}%` }}
              title={`${c.author_name}: ${c.body.slice(0, 60)}`}
            >
              <span className="mc-pin-num">{c.order}</span>
            </span>
          ))}
          {pin && (
            <span className="mc-pin mc-pin-placing" style={{ left: `${pin.x}%`, top: `${pin.y}%` }}>
              <span className="mc-pin-num">{pinBadges.length + 1}</span>
            </span>
          )}
        </div>
        <p className="mc-hint">
          {pin ? `Pin en ${Math.round(pin.x)}% / ${Math.round(pin.y)}% — tocá otro punto para moverlo.` : "Tocá la imagen para indicar a qué parte te referís."}
        </p>

        {/* ── Comment form ── */}
        <form className="mc-form" onSubmit={handleSubmit}>
          <input
            className="mc-input"
            type="text"
            placeholder="Tu nombre (opcional)"
            value={authorName}
            maxLength={60}
            onChange={(e) => setAuthorName(e.target.value)}
          />
          <textarea
            className="mc-input mc-textarea"
            placeholder="¿Qué te gustaría cambiar o agregar?"
            value={body}
            maxLength={500}
            rows={3}
            onChange={(e) => setBody(e.target.value)}
          />
          <label className="mc-kanban-toggle">
            <input
              type="checkbox"
              checked={sendToKanban}
              onChange={(e) => setSendToKanban(e.target.checked)}
            />
            <span>
              Agregar al Kanban
              <em>Tu IA aplicará este comentario como tarea.</em>
            </span>
          </label>
          {formError && <p className="mc-status mc-error" role="alert">{formError}</p>}
          <button type="submit" className="mc-btn" disabled={submitting}>
            {submitting ? "Enviando…" : pin ? "Enviar comentario" : "Enviar comentario"}
          </button>
          {sentKind === "kanban" && (
            <p className="mc-status mc-ok" role="status">Comentario guardado y agregado al Kanban. ¡La IA ya puede aplicarlo!</p>
          )}
          {sentKind === "comment" && (
            <p className="mc-status mc-ok" role="status">Comentario guardado.</p>
          )}
        </form>

        {/* ── Existing comments ── */}
        <section className="mc-list" aria-label="Comentarios existentes">
          <h2 className="mc-list-title">{comments.length > 0 ? `${comments.length} comentario${comments.length === 1 ? "" : "s"}` : "Todavía no hay comentarios — sé el primero."}</h2>
          {comments.map((c) => (
            <article key={c.id} className="mc-comment">
              <div className="mc-comment-head">
                <span className="mc-comment-author">{c.author_name}</span>
                {c.kanban_task_id && <span className="mc-badge">Kanban ✓</span>}
                {c.status !== "open" && <span className="mc-badge mc-badge-muted">{c.status === "resolved" ? "Resuelto" : "Archivado"}</span>}
                <time className="mc-comment-date">
                  {new Date(c.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}
                </time>
              </div>
              <p className="mc-comment-body">{c.body}</p>
              <p className="mc-comment-pos">x {Math.round(c.x_pct)}% · y {Math.round(c.y_pct)}%</p>
            </article>
          ))}
        </section>

        <footer className="mc-footer">
          <a href="/">Hecho con Musa by Futuraria</a>
        </footer>
      </div>
    </main>
  );
}
