"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCalendar, IconChat, IconPlus, IconRepeat, IconSettings } from "@/components/icons";
import { cx } from "@/components/ui";

const items = [
  { href: "/panel", label: "Agenda", icon: IconCalendar, exact: true },
  { href: "/panel/nueva", label: "Nueva cita", icon: IconPlus },
  { href: "/panel/seguimientos", label: "Seguimientos", icon: IconRepeat },
  { href: "/panel/mensajes", label: "Mensajes", icon: IconChat },
  { href: "/panel/ajustes", label: "Ajustes", icon: IconSettings },
];

export function PanelNav({
  badges,
  variant,
}: {
  badges: Record<string, number>;
  variant: "sidebar" | "bottom";
}) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href || pathname.startsWith("/panel/cita") : pathname.startsWith(href);

  if (variant === "sidebar") {
    return (
      <nav className="flex flex-col gap-1">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={cx(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
              isActive(it.href, it.exact)
                ? "bg-surface text-ink shadow-[var(--shadow-card)]"
                : "text-ink-soft hover:bg-sunken hover:text-ink",
            )}
          >
            <it.icon className={isActive(it.href, it.exact) ? "text-brand" : ""} />
            <span className="flex-1">{it.label}</span>
            {badges[it.href] ? (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white">
                {badges[it.href]}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
    );
  }

  return (
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={cx(
              "relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium",
              isActive(it.href, it.exact) ? "text-brand" : "text-ink-mute",
            )}
          >
            <it.icon />
            {it.label}
            {badges[it.href] ? (
              <span className="absolute top-1.5 right-[calc(50%-18px)] h-2 w-2 rounded-full bg-accent" />
            ) : null}
          </Link>
        ))}
      </nav>
  );
}
