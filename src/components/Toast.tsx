import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

interface Toast {
  id: string;
  message: string;
  type: "info" | "success" | "error";
  persistent?: boolean;
}

interface ToastContextValue {
  addToast: (message: string, type?: "info" | "success" | "error", persistent?: boolean) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  addToast: () => {},
  dismissToast: () => {},
});

const STYLES: Record<"info" | "success" | "error", React.CSSProperties> = {
  info: {
    background: "rgba(59, 130, 246, 0.92)",
    borderLeft: "3px solid #93c5fd",
  },
  success: {
    background: "rgba(34, 197, 94, 0.92)",
    borderLeft: "3px solid #86efac",
  },
  error: {
    background: "rgba(220, 38, 38, 0.95)",
    borderLeft: "3px solid #fca5a5",
  },
};

const ICONS: Record<"info" | "success" | "error", string> = {
  info: "ℹ",
  success: "✓",
  error: "✗",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: "info" | "success" | "error" = "info", persistent = false) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, message, type, persistent }]);
      if (!persistent) {
        const duration = type === "error" ? 5000 : 3000;
        setTimeout(() => dismissToast(id), duration);
      }
    },
    [dismissToast]
  );

  const value = useMemo(() => ({ addToast, dismissToast }), [addToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "10px 14px",
              borderRadius: 8,
              color: "#fff",
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "Inter, system-ui, sans-serif",
              boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
              backdropFilter: "blur(8px)",
              maxWidth: 360,
              pointerEvents: "all",
              animation: "toastIn 0.2s ease",
              ...STYLES[t.type],
            }}
          >
            <span style={{ flexShrink: 0, fontSize: 14, lineHeight: "18px" }}>{ICONS[t.type]}</span>
            <span style={{ flex: 1, lineHeight: "18px" }}>{t.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              style={{
                flexShrink: 0,
                background: "none",
                border: "none",
                color: "rgba(255,255,255,0.7)",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: "18px",
                padding: 0,
                marginLeft: 4,
              }}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
