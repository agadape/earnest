import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { Status } from "@/lib/tanda-jadi";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed";

const BUTTON_VARIANTS = {
  primary:
    "bg-accent text-white hover:bg-accent-strong disabled:bg-stone-200 disabled:text-stone-500",
  secondary:
    "border border-stone-300 bg-white text-stone-900 hover:border-stone-400 hover:bg-stone-50 disabled:border-stone-200 disabled:bg-stone-50 disabled:text-stone-400",
  quiet: "text-accent underline hover:text-accent-strong disabled:text-stone-400",
};

const BUTTON_SIZES = {
  md: "h-11 px-5 text-sm",
  sm: "h-9 px-3.5 text-sm",
};

/** Class names for something that should look like a button but is a link. */
export function buttonClass(
  variant: keyof typeof BUTTON_VARIANTS = "primary",
  size: keyof typeof BUTTON_SIZES = "md",
): string {
  // A quiet button sits inside a sentence and takes its size from the text around it.
  const sizing = variant === "quiet" ? "" : BUTTON_SIZES[size];
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${sizing}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  /** Shows a spinner and blocks further clicks while its action is on the way. */
  busy?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${buttonClass(variant, size)} ${className}`}
    >
      {busy && (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      )}
      {children}
    </button>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-stone-200 bg-white p-5 sm:p-6 ${className}`}>
      {children}
    </section>
  );
}

const STATUS_LABELS: Record<Status, string> = {
  funding: "Taking pledges",
  building: "Being built",
  failed: "Didn't fill",
  braked: "Stopped by backers",
  completed: "Completed",
};

const STATUS_STYLES: Record<Status, string> = {
  funding: "border-accent-line bg-accent-soft text-accent-ink",
  building: "border-accent bg-accent text-white",
  failed: "border-stone-300 bg-stone-100 text-stone-700",
  braked: "border-stone-300 bg-stone-100 text-stone-700",
  completed: "border-stone-800 bg-stone-800 text-white",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function Tag({
  tone = "plain",
  children,
}: {
  tone?: "plain" | "accent";
  children: ReactNode;
}) {
  const style =
    tone === "accent"
      ? "border-accent-line bg-accent-soft text-accent-ink"
      : "border-stone-200 bg-stone-50 text-stone-600";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${style}`}>
      {children}
    </span>
  );
}

/** A horizontal bar filled to `value / max`. `label` is what a screen reader announces. */
export function Bar({
  value,
  max,
  label,
  tone = "accent",
}: {
  value: number;
  max: number;
  label: string;
  tone?: "accent" | "muted";
}) {
  const share = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className="h-2 w-full overflow-hidden rounded-full bg-stone-200"
    >
      <div
        className={`h-full rounded-full ${tone === "accent" ? "bg-accent" : "bg-stone-500"}`}
        style={{ width: `${share * 100}%` }}
      />
    </div>
  );
}

/** A note inside the page: something is missing, loading or went wrong. */
export function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
      <p className="font-medium text-stone-900">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-stone-600">{children}</div>}
    </div>
  );
}
