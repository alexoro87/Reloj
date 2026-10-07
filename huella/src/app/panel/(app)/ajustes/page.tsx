import type { Metadata } from "next";
import Link from "next/link";
import { IconCalendar, IconQr, IconWhatsApp } from "@/components/icons";
import { Button, buttonClass, Card, cx } from "@/components/ui";
import { getAppUrl } from "@/lib/app-url";
import { requireSession } from "@/lib/auth";
import { isClinicConnected, isGoogleConfigured } from "@/lib/integrations/google";
import { isWhatsAppConfigured, TEMPLATES } from "@/lib/integrations/whatsapp";
import { disconnectGoogleAction } from "../../actions";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Ajustes" };

const googleNotice: Record<string, { cls: string; text: string }> = {
  conectado: { cls: "bg-ok-soft text-ok", text: "Google Calendar conectado correctamente." },
  error: { cls: "bg-danger-soft text-danger", text: "No se pudo conectar con Google. Inténtalo de nuevo." },
  "sin-configurar": {
    cls: "bg-warn-soft text-warn",
    text: "Falta configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor.",
  },
};

export default async function SettingsPage(props: PageProps<"/panel/ajustes">) {
  const { clinic, user } = await requireSession();
  const q = await props.searchParams;
  const appUrl = await getAppUrl();
  const bookingUrl = `${appUrl}/c/${clinic.slug}`;
  const googleConnected = isClinicConnected(clinic);
  const waLive = isWhatsAppConfigured(clinic.whatsappPhoneNumberId);
  const notice = typeof q.google === "string" ? googleNotice[q.google] : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Ajustes</h1>
      {notice && <p className={cx("rounded-xl p-3 text-sm font-medium", notice.cls)}>{notice.text}</p>}

      {/* QR */}
      <Card className="grid gap-6 p-6 sm:grid-cols-[180px_1fr]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/qr/${clinic.slug}`}
          alt={`QR para reservar en ${clinic.name}`}
          className="aspect-square w-full max-w-[180px] rounded-2xl border border-line"
        />
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <IconQr className="text-brand" /> Tu QR de reservas
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Imprímelo para recepción, ponlo en tus tarjetas o compártelo en redes. Lleva directo a tu agenda.
          </p>
          <p className="mt-3 truncate rounded-xl bg-sunken px-3 py-2 font-mono text-sm">{bookingUrl}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={`/api/qr/${clinic.slug}?formato=png`} className={buttonClass("primary", "sm")}>
              Descargar QR
            </a>
            <Link href="/panel/cartel" target="_blank" className={buttonClass("secondary", "sm")}>
              Imprimir cartel
            </Link>
            <Link href={`/c/${clinic.slug}`} target="_blank" className={buttonClass("ghost", "sm")}>
              Abrir página ↗
            </Link>
          </div>
        </div>
      </Card>

      {/* Integraciones */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <IconCalendar className="text-brand" /> Google Calendar
            </h2>
            <Status ok={googleConnected} />
          </div>
          <p className="mt-2 text-sm text-ink-soft">
            Cada cita se crea en el calendario del podólogo (o en el de la clínica) y la recepción recibe la
            invitación. Lo que esté ocupado en esos calendarios bloquea la agenda en línea.
          </p>
          <div className="mt-4">
            {googleConnected ? (
              user.role === "owner" && (
                <form action={disconnectGoogleAction}>
                  <Button size="sm" variant="secondary">
                    Desconectar
                  </Button>
                </form>
              )
            ) : (
              <a href="/api/google/connect" className={buttonClass("secondary", "sm")}>
                Conectar con Google
              </a>
            )}
            {!isGoogleConfigured() && (
              <p className="mt-3 text-xs text-ink-mute">
                Requiere credenciales OAuth de Google en el servidor (ver README).
              </p>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <IconWhatsApp className="text-whatsapp" /> WhatsApp
            </h2>
            <Status ok={waLive} offLabel="Simulado" />
          </div>
          <p className="mt-2 text-sm text-ink-soft">
            Recordatorio {clinic.reminderHoursBefore} h antes con botones para confirmar, cancelar o cambiar.
            Plantillas que hay que aprobar en Meta:
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {Object.values(TEMPLATES).map((t) => (
              <li key={t.name} className="font-mono text-xs text-ink-soft">
                {t.name}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <SettingsForm
        canEdit={user.role === "owner"}
        clinic={{
          name: clinic.name,
          phone: clinic.phone ?? "",
          address: clinic.address ?? "",
          receptionEmail: clinic.receptionEmail ?? "",
          reminderHoursBefore: clinic.reminderHoursBefore,
          minNoticeMinutes: clinic.minNoticeMinutes,
          bookingHorizonDays: clinic.bookingHorizonDays,
          whatsappPhoneNumberId: clinic.whatsappPhoneNumberId ?? "",
          googleCalendarId: clinic.googleCalendarId ?? "",
        }}
      />
    </div>
  );
}

function Status({ ok, offLabel = "No conectado" }: { ok: boolean; offLabel?: string }) {
  return (
    <span
      className={cx(
        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
        ok ? "bg-ok-soft text-ok" : "bg-sunken text-ink-mute",
      )}
    >
      {ok ? "Activo" : offLabel}
    </span>
  );
}
