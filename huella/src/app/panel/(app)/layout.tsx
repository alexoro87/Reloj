import Link from "next/link";
import { IconLogout } from "@/components/icons";
import { Logo } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { getRepo, isDemoMode } from "@/lib/db";
import { todayIn } from "@/lib/time";
import { logoutAction } from "../actions";
import { PanelNav } from "./nav";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: LayoutProps<"/panel">) {
  const { clinic, user } = await requireSession();
  const followUps = await getRepo().listFollowUps(clinic.id);
  const due = followUps.filter((f) => f.status === "pending" && f.dueDate <= todayIn(clinic.timezone)).length;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 gap-8 px-4 py-5 lg:px-6">
      <aside className="sticky top-5 hidden h-[calc(100vh-2.5rem)] w-60 shrink-0 flex-col lg:flex">
        <Link href="/" className="mb-8 px-3">
          <Logo className="text-lg" />
        </Link>
        <PanelNav variant="sidebar" badges={{ "/panel/seguimientos": due }} />
        <div className="mt-auto space-y-3 px-3">
          {isDemoMode() && (
            <p className="rounded-xl bg-accent-soft p-3 text-xs text-accent">
              <b>Modo demo.</b> Datos en memoria; se reinician al reiniciar el servidor.
            </p>
          )}
          <div className="text-sm">
            <p className="truncate font-semibold">{clinic.name}</p>
            <p className="truncate text-ink-mute">{user.name}</p>
          </div>
          <form action={logoutAction}>
            <button className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-ink">
              <IconLogout width={18} height={18} /> Salir
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1 pb-24 lg:pb-8">
        <div className="mb-5 flex items-center justify-between lg:hidden">
          <Logo />
          <form action={logoutAction}>
            <button className="inline-flex items-center gap-1.5 text-sm text-ink-soft" aria-label="Salir">
              <IconLogout width={18} height={18} />
            </button>
          </form>
        </div>
        {children}
      </div>
      <PanelNav variant="bottom" badges={{ "/panel/seguimientos": due }} />
    </div>
  );
}
