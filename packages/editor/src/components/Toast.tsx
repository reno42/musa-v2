import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

interface Toast {
  id: string;
  message: string;
  type?: "info" | "success" | "error";
}

interface ToastContextValue {
  addToast: (message: string, type?: "info" | "success" | "error") => void;
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: "info" | "success" | "error" = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  const value = useMemo(() => ({ addToast }), [addToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 50 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{ padding: "8px 16px", marginTop: 8, background: "#333", color: "#fff", borderRadius: 4 }}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
