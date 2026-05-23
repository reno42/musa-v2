import React, { useState, useCallback, useRef, useEffect } from "react";
import type { Comment, CommentReply } from "@futuraria/shared";

interface CommentsPanelProps {
  comments: Comment[];
  activeCommentId: string | null;
  currentAuthor: string;
  onAddComment: (x: number, y: number, text: string) => void;
  onAddReply: (commentId: string, text: string) => void;
  onResolve: (commentId: string) => void;
  onReopen: (commentId: string) => void;
  onDelete: (commentId: string) => void;
  onSelectComment: (comment: Comment | null) => void;
  onClose: () => void;
}

export function CommentsPanel({
  comments,
  activeCommentId,
  currentAuthor,
  onAddComment,
  onAddReply,
  onResolve,
  onReopen,
  onDelete,
  onSelectComment,
  onClose,
}: CommentsPanelProps) {
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});
  const replyInputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const filtered = comments.filter((c) => {
    if (filter === "open") return !c.resolved;
    if (filter === "resolved") return c.resolved;
    return true;
  });

  const activeComment = comments.find((c) => c.id === activeCommentId);

  const handleReply = useCallback(
    (commentId: string) => {
      const text = replyTexts[commentId]?.trim();
      if (!text) return;
      onAddReply(commentId, text);
      setReplyTexts((prev) => ({ ...prev, [commentId]: "" }));
    },
    [replyTexts, onAddReply],
  );

  // Focus reply input when a comment is selected
  useEffect(() => {
    if (activeCommentId && replyInputRefs.current[activeCommentId]) {
      replyInputRefs.current[activeCommentId]?.focus();
    }
  }, [activeCommentId]);

  return (
    <div
      style={{
        width: 320,
        height: "100%",
        background: "#0f0f14",
        borderLeft: "1px solid #1e1e2e",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Inter, sans-serif",
        color: "#e2e8f0",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #1e1e2e",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          💬 Comments ({comments.filter((c) => !c.resolved).length})
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            fontSize: 16,
            padding: "2px 6px",
          }}
        >
          ×
        </button>
      </div>

      {/* Filter tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid #1e1e2e",
        }}
      >
        {(["all", "open", "resolved"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              flex: 1,
              padding: "8px 0",
              fontSize: 11,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              background: filter === f ? "#1e1b4b" : "transparent",
              color: filter === f ? "#818cf8" : "#64748b",
              border: "none",
              borderBottom: filter === f ? "2px solid #6366f1" : "2px solid transparent",
              cursor: "pointer",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Comment list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#475569", fontSize: 13 }}>
            {filter === "all"
              ? "No comments yet. Press C and click on canvas to add one."
              : `No ${filter} comments.`}
          </div>
        )}
        {filtered.map((comment) => (
          <CommentThreadItem
            key={comment.id}
            comment={comment}
            isActive={comment.id === activeCommentId}
            currentAuthor={currentAuthor}
            replyText={replyTexts[comment.id] || ""}
            onReplyTextChange={(text) =>
              setReplyTexts((prev) => ({ ...prev, [comment.id]: text }))
            }
            onReply={() => handleReply(comment.id)}
            onResolve={() => onResolve(comment.id)}
            onReopen={() => onReopen(comment.id)}
            onDelete={() => onDelete(comment.id)}
            onSelect={() => onSelectComment(comment)}
            replyRef={(el) => { replyInputRefs.current[comment.id] = el; }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Single comment thread ───────────────────────────────────────

interface CommentThreadItemProps {
  comment: Comment;
  isActive: boolean;
  currentAuthor: string;
  replyText: string;
  onReplyTextChange: (text: string) => void;
  onReply: () => void;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onSelect: () => void;
  replyRef: (el: HTMLTextAreaElement | null) => void;
}

function CommentThreadItem({
  comment,
  isActive,
  currentAuthor,
  replyText,
  onReplyTextChange,
  onReply,
  onResolve,
  onReopen,
  onDelete,
  onSelect,
  replyRef,
}: CommentThreadItemProps) {
  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div
      onClick={onSelect}
      style={{
        padding: "10px 16px",
        borderBottom: "1px solid #1a1a2e",
        background: isActive ? "#1a1a2e" : "transparent",
        cursor: "pointer",
        opacity: comment.resolved ? 0.6 : 1,
      }}
    >
      {/* Author + time */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: comment.resolved ? "#374151" : "#6366f1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {comment.author.charAt(0).toUpperCase()}
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>
          {comment.author}
        </span>
        <span style={{ fontSize: 11, color: "#475569", marginLeft: "auto" }}>
          {timeAgo(comment.createdAt)}
        </span>
        {comment.resolved && (
          <span style={{ fontSize: 10, color: "#22c55e", fontWeight: 500 }}>✓</span>
        )}
      </div>

      {/* Message */}
      <p style={{ margin: "0 0 8px 0", fontSize: 13, color: "#cbd5e1", lineHeight: 1.4 }}>
        {comment.text}
      </p>

      {/* Replies (collapsed preview) */}
      {comment.thread.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {comment.thread.slice(-2).map((reply) => (
            <div
              key={reply.id}
              style={{
                padding: "6px 8px",
                marginLeft: 8,
                borderLeft: "2px solid #2d2d44",
                marginBottom: 4,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>
                {reply.author}
              </span>
              <span style={{ fontSize: 11, color: "#475569", marginLeft: 6 }}>
                {timeAgo(reply.createdAt)}
              </span>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94a3b8", lineHeight: 1.3 }}>
                {reply.text}
              </p>
            </div>
          ))}
          {comment.thread.length > 2 && (
            <span style={{ fontSize: 11, color: "#475569", marginLeft: 12 }}>
              +{comment.thread.length - 2} more replies
            </span>
          )}
        </div>
      )}

      {/* Reply input + actions (only when active) */}
      {isActive && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <textarea
              ref={replyRef}
              value={replyText}
              onChange={(e) => onReplyTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onReply();
                }
              }}
              placeholder="Reply..."
              rows={2}
              style={{
                flex: 1,
                background: "#16161e",
                border: "1px solid #2d2d44",
                borderRadius: 6,
                padding: "6px 8px",
                color: "#e2e8f0",
                fontSize: 12,
                fontFamily: "Inter, sans-serif",
                resize: "none",
                outline: "none",
              }}
            />
            <button
              onClick={(e) => { e.stopPropagation(); onReply(); }}
              disabled={!replyText.trim()}
              style={{
                background: replyText.trim() ? "#6366f1" : "#2d2d44",
                border: "none",
                borderRadius: 6,
                color: "#fff",
                padding: "0 10px",
                fontSize: 12,
                cursor: replyText.trim() ? "pointer" : "default",
                fontWeight: 600,
              }}
            >
              ↩
            </button>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 6 }}>
            {comment.resolved ? (
              <button
                onClick={(e) => { e.stopPropagation(); onReopen(); }}
                style={actionBtnStyle("#3b82f6")}
              >
                Reopen
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onResolve(); }}
                style={actionBtnStyle("#22c55e")}
              >
                ✓ Resolve
              </button>
            )}
            {comment.author === currentAuthor && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                style={actionBtnStyle("#ef4444")}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function actionBtnStyle(color: string): React.CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${color}33`,
    borderRadius: 4,
    color,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
  };
}
