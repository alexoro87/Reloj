import type { Metadata } from "next";
import Link from "next/link";
import { IconChat } from "@/components/icons";
import { MessageBubble } from "@/components/message-bubble";
import { Button, Card } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { getRepo } from "@/lib/db";
import { isWhatsAppConfigured } from "@/lib/integrations/whatsapp";
import { formatPhone } from "@/lib/phone";
import { capitalize, formatDay } from "@/lib/time";
import { runSchedulerAction } from "../../actions";

export const metadata: Metadata = { title: "Mensajes" };

export default async function MessagesPage() {
  const { clinic } = await requireSession();
  const repo = getRepo();
  const messages = await repo.listMessages(clinic.id, 100);
  const patients = await repo.listPatients(clinic.id, [
    ...new Set(messages.flatMap((m) => (m.patientId ? [m.patientId] : []))),
  ]);
  const live = isWhatsAppConfigured(clinic.whatsappPhoneNumberId);
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: clinic.timezone }).format(new Date(iso));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Mensajes</h1>
          <p className="mt-1 text-ink-soft">Todo lo que Huella envía y recibe por WhatsApp.</p>
        </div>
        <form action={runSchedulerAction}>
          <Button variant="secondary" size="sm">
            Enviar recordatorios pendientes ahora
          </Button>
        </form>
      </div>

      {!live && (
        <Card className="border border-accent/20 bg-accent-soft/50 p-4 text-sm">
          <b>WhatsApp en modo simulado.</b> Los mensajes se registran aquí pero no se envían. Pulsa los
          botones de un mensaje para responder como si fueras el paciente. Para enviarlos de verdad,
          configura WhatsApp en <Link href="/panel/ajustes" className="font-semibold underline">Ajustes</Link>.
        </Card>
      )}

      {messages.length === 0 ? (
        <Card className="p-8 text-center">
          <IconChat className="mx-auto text-ink-mute" width={28} height={28} />
          <p className="mt-2 font-semibold">Todavía no hay mensajes</p>
          <p className="text-sm text-ink-soft">
            Reserva una cita desde la página pública (aceptando avisos por WhatsApp) o envía los recordatorios
            pendientes.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {messages.map((m, i) => {
            const patient = patients.find((p) => p.id === m.patientId);
            const newDay = i === 0 || dayOf(messages[i - 1].createdAt) !== dayOf(m.createdAt);
            return (
              <div key={m.id}>
                {newDay && (
                  <p className="my-4 text-center text-xs font-semibold text-ink-mute">
                    {capitalize(formatDay(dayOf(m.createdAt), { weekday: "long", day: "numeric", month: "long" }))}
                  </p>
                )}
                <div className="rounded-2xl bg-[#efe8dc] p-3">
                  <p className="mb-2 px-1 text-xs font-semibold text-ink-soft">
                    {m.direction === "out" ? "Para" : "De"} {patient?.name ?? "paciente"}
                    {patient && <span className="font-normal text-ink-mute"> · {formatPhone(patient.phone)}</span>}
                    {m.appointmentId && (
                      <Link href={`/panel/cita/${m.appointmentId}`} className="ml-2 text-brand hover:underline">
                        Ver cita
                      </Link>
                    )}
                  </p>
                  <MessageBubble message={m} timezone={clinic.timezone} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
