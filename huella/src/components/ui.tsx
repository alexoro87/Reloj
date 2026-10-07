import type { ComponentProps, ReactNode } from "react";
import type { AppointmentStatus } from "@/lib/types";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "whatsapp";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-strong shadow-sm disabled:bg-ink-mute/40 disabled:shadow-none",
  secondary: "bg-surface text-ink border border-line hover:border-ink-mute/50 hover:bg-sunken/40",
  ghost: "text-ink-soft hover:bg-sunken hover:text-ink",
  danger: "bg-surface text-danger border border-danger/30 hover:bg-danger-soft",
  whatsapp: "bg-whatsapp text-white hover:brightness-95 shadow-sm",
};

export function buttonClass(variant: Variant = "primary", size: "md" | "lg" | "sm" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition",
    "disabled:cursor-not-allowed active:scale-[0.98]",
    size === "lg" && "h-14 px-7 text-base",
    size === "md" && "h-11 px-5 text-sm",
    size === "sm" && "h-9 px-4 text-sm",
    variants[variant],
  );
}

export function Button({
  variant,
  size,
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: "md" | "lg" | "sm" }) {
  return <button {...props} className={cx(buttonClass(variant, size), className)} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cx("rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)]", className)}
    />
  );
}

export function Avatar({
  name,
  color,
  size = 48,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  const initials = name
    .replace(/^(Dra?\.|Lic\.|Mtro?\.|Mtra\.)\s*/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ background: color, width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}

const statusStyles: Record<AppointmentStatus, { label: string; cls: string }> = {
  booked: { label: "Por confirmar", cls: "bg-warn-soft text-warn" },
  confirmed: { label: "Confirmada", cls: "bg-ok-soft text-ok" },
  cancelled: { label: "Cancelada", cls: "bg-danger-soft text-danger" },
  completed: { label: "Atendida", cls: "bg-brand-soft text-brand-strong" },
  no_show: { label: "No asistió", cls: "bg-sunken text-ink-soft" },
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const s = statusStyles[status];
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", s.cls)}>
      {s.label}
    </span>
  );
}

export function statusLabel(status: AppointmentStatus): string {
  return statusStyles[status].label;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-sm text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-sm text-ink-mute">{hint}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "block h-12 w-full rounded-xl border border-line bg-surface px-4 text-base text-ink " +
  "placeholder:text-ink-mute/70 transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10";

export function formatPrice(cents: number | null): string | null {
  if (cents === null) return null;
  if (cents === 0) return "Sin costo";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: process.env.NEXT_PUBLIC_CURRENCY ?? "MXN",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <rect width="32" height="32" rx="10" className="fill-brand" />
        <ellipse cx="16" cy="19.5" rx="5.2" ry="7" fill="#fff" />
        <circle cx="10.2" cy="9.6" r="2" fill="#fff" />
        <circle cx="14.4" cy="7.4" r="2.2" fill="#fff" />
        <circle cx="19" cy="7.6" r="1.9" fill="#fff" />
        <circle cx="22.6" cy="10" r="1.6" fill="#fff" />
      </svg>
      <span>Huella</span>
    </span>
  );
}
