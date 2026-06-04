/* Toast notifications — provider + hook pattern.
   Mount <ToastProvider> at the app root. Call useToast() inside any
   component to get { show, dismiss }. Each toast auto-dismisses after
   `duration` (default 3500ms) unless explicitly dismissed.

   Toasts stack bottom-right (the canonical SaaS placement). Variants:
     default → muted ink background
     success → sage tinted
     warn    → coral tinted
     error   → strong warn tinted

   Usage:
     const toast = useToast();
     toast.show("Saved", { variant: "success" });
     toast.show("Failed to save", { variant: "error", duration: 6000 });
*/

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const ToastContext = createContext({ show: () => {}, dismiss: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message, options = {}) => {
    const id = ++idRef.current;
    const toast = {
      id,
      message,
      variant: options.variant || "default",
      duration: options.duration ?? 3500,
    };
    setToasts((cur) => [...cur, toast]);
    if (toast.duration > 0) {
      setTimeout(() => dismiss(id), toast.duration);
    }
    return id;
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      {createPortal(
        <div className="ui-toast-stack" role="region" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`ui-toast ui-toast--${t.variant}`}
              onClick={() => dismiss(t.id)}
            >
              {t.message}
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}
