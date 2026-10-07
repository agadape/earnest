"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ToastKind = "pending" | "success" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  /** Shows a message and returns its id, to be replaced or dismissed later. */
  show(kind: ToastKind, message: string): number;
  /** Replaces a message in place, e.g. "Sending…" with its result. */
  update(id: number, kind: ToastKind, message: string): void;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToasts(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToasts needs <ToastProvider>");
  return api;
}

const LIFETIME_MS: Record<ToastKind, number | null> = {
  pending: null,
  success: 6_000,
  error: 12_000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const api = useMemo<ToastApi>(
    () => ({
      show(kind, message) {
        const id = nextId.current++;
        setToasts((current) => [...current.slice(-3), { id, kind, message }]);
        return id;
      },
      update(id, kind, message) {
        setToasts((current) =>
          current.some((toast) => toast.id === id)
            ? current.map((toast) => (toast.id === id ? { id, kind, message } : toast))
            : [...current.slice(-3), { id, kind, message }],
        );
      },
      dismiss(id) {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      },
    }),
    [],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={api.dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const STYLES: Record<ToastKind, string> = {
  pending: "border-stone-200 bg-white text-stone-800",
  success: "border-accent-line bg-accent-soft text-accent-ink",
  error: "border-red-200 bg-red-50 text-red-900",
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const { id, kind, message } = toast;
  const dismiss = useCallback(() => onDismiss(id), [id, onDismiss]);

  useEffect(() => {
    const lifetime = LIFETIME_MS[kind];
    if (lifetime === null) return;
    const timer = setTimeout(dismiss, lifetime);
    return () => clearTimeout(timer);
  }, [kind, message, dismiss]);

  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg shadow-stone-900/5 ${STYLES[kind]}`}
    >
      <span aria-hidden className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {kind === "pending" ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700" />
        ) : (
          <span
            className={`h-2 w-2 rounded-full ${kind === "success" ? "bg-accent" : "bg-red-600"}`}
          />
        )}
      </span>
      <p className="min-w-0 flex-1 break-words leading-5">{message}</p>
      {kind !== "pending" && (
        <button
          type="button"
          onClick={dismiss}
          className="-m-1 shrink-0 rounded p-1 text-xs font-medium opacity-60 hover:opacity-100"
        >
          Close
        </button>
      )}
    </div>
  );
}
