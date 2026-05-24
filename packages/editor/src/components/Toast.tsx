import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from "react";

export type ToastType = "error" | "warning" | "success" | "info";

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  detail?: string;
  duration?: number;
}

interface ToastContextValue {
  addToast: (type: ToastType, message: string, detail?: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  addToast: () => {},
  removeToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

const TYPE_STYLES: Record<ToastType, { bg: string; border: string; icon: string }> = {
  error:   { bg: "#2d1111", border: "#ef4444", icon: "✕" },
  warning: { bg: "#2d2011", border: "#f59e0b", icon: "⚠" },
  success: { bg: "#112d13", border: "#22c55e", icon: "✓" },
  info:    { bg: "#111a2d", border: "#3b82f6", icon: "ℹ" },
};

let toastIdCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback(
    (type: ToastType, message: string, detail?: string, duration?: number) => {
      const id = `toast_${++toastIdCounter}`;
      setToasts((prev) => [...prev, { id, type, message, detail, duration }]);
    },
    [],
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div className="toast-container">
        {toasts.map((toast) => (
          <ToastMessage key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastMessage({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);
  const s = TYPE_STYLES[toast.type];

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, toast.duration || 5000);
    return () => clearTimeout(t);
  }, [toast.id]);

  return (
    <div
      className={`toast-item ${visible ? "toast-visible" : ""}`}
      style={{
        background: s.bg,
        borderLeft: `3px solid ${s.border}`,
      }}
      onClick={() => onDismiss(toast.id)}
    >
      <span className="toast-icon">{s.icon}</span>
      <div className="toast-content">
        <div className="toast-message">{toast.message}</div>
        {toast.detail && <div className="toast-detail">{toast.detail}</div>}
      </div>
      <button className="toast-close" onClick={(e) => { e.stopPropagation(); onDismiss(toast.id); }}>
        ×
      </button>
    </div>
  );
}
