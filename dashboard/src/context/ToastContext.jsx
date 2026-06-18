import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timerIds = useRef({});
  const nextIdRef = useRef(0);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(({ type = "info", message, duration = 4000 }) => {
    const id = ++nextIdRef.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    if (duration > 0) {
      timerIds.current[id] = setTimeout(() => {
        removeToast(id);
        delete timerIds.current[id];
      }, duration);
    }
    return id;
  }, [removeToast]);

  useEffect(() => {
    return () => { Object.values(timerIds.current).forEach(clearTimeout); };
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const typeStyles = {
  error:   "border-danger/30 bg-danger/10 text-danger",
  success: "border-savings/30 bg-savings/10 text-savings",
  warning: "border-cost/30 bg-cost/10 text-cost",
  info:    "border-accent/30 bg-[var(--accent-bg)] text-accent",
};

function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 sm:bottom-6 sm:right-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-sm items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg ${typeStyles[t.type] ?? typeStyles.info}`}
        >
          <p className="flex-1 text-sm font-medium">{t.message}</p>
          <button
            onClick={() => onDismiss(t.id)}
            className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
