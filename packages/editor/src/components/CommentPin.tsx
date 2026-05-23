import React, { memo } from "react";
import type { Comment } from "@futuraria/shared";

interface CommentPinProps {
  comment: Comment;
  zoom: number;
  viewportX: number;
  viewportY: number;
  isActive: boolean;
  onClick: (comment: Comment) => void;
}

export const CommentPin: React.FC<CommentPinProps> = memo(({
  comment,
  zoom,
  viewportX,
  viewportY,
  isActive,
  onClick,
}) => {
  const screenX = comment.x * zoom + viewportX;
  const screenY = comment.y * zoom + viewportY;

  return (
    <div
      data-comment-pin={comment.id}
      style={{
        position: "absolute",
        left: screenX - 14,
        top: screenY - 28,
        width: 28,
        height: 28,
        zIndex: 1000,
        cursor: "pointer",
        filter: comment.resolved ? "opacity(0.4) grayscale(1)" : "none",
        pointerEvents: "auto",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(comment);
      }}
      title={`${comment.author}: ${comment.text}`}
    >
      {/* Pin shape */}
      <svg width="28" height="36" viewBox="0 0 28 36" fill="none">
        <path
          d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z"
          fill={isActive ? "#818cf8" : comment.resolved ? "#6b7280" : "#6366f1"}
          stroke={isActive ? "#c7d2fe" : "#4f46e5"}
          strokeWidth="1.5"
        />
      </svg>
      {/* Author initial */}
      <span
        style={{
          position: "absolute",
          top: 4,
          left: 0,
          width: 28,
          textAlign: "center",
          fontSize: 12,
          fontWeight: 700,
          color: "#fff",
          fontFamily: "Inter, sans-serif",
          userSelect: "none",
          lineHeight: "20px",
        }}
      >
        {comment.author.charAt(0).toUpperCase()}
      </span>
      {/* Unread indicator dot (if has replies and not resolved) */}
      {!comment.resolved && comment.thread.length > 0 && (
        <span
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#ef4444",
            border: "1.5px solid #1e1b4b",
          }}
        />
      )}
    </div>
  );
});

CommentPin.displayName = "CommentPin";
