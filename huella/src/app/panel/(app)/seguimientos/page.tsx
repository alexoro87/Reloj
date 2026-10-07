import type { Metadata } from "next";
import { IconRepeat, IconWhatsApp } from "@/components/icons";
import { Avatar, Button, Card, cx } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { getRepo } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { addDays, formatDay, todayIn } from "@/lib/time";
import type { FollowUpStatus } from "@/lib/types";
import { dismissFollowUpAction, sendFollowUpAction } from "../../actions";

export const metadata: Metadata = { title: "Seguimientos" };

const statusChip: Record<FollowUpStatus, { label: string; cls: string }> = {
  pending: { label: "Pendiente", cls: "bg-warn-soft text-warn" },
  sent: { label: "Aviso enviado", cls: "bg-brand-soft text-brand-strong" },
  booked: { label: "Ya reservó", cls: "bg-ok-soft text-ok" },
  dismissed: { label: "Descartado", cls: "bg-sunken text-ink-mute" },
};

export default async function FollowUpsPage() {
  const { clinic } = await requireSession();
  const repo = getRepo();
  const [followUps, practitioners, services] = await Promise.all([
    repo.listFollowUps(clinic.id),
    repo.listPractitioners(clinic.id),
    repo.listServices(clinic.id),
  ]);
  const patients = await repo.listPatients(clinic.id, [...new Set(followUps.map((f) => f.patientId))]);
  const today = todayIn(clinic.timezone);

  const groups = [
    { title: "Toca hoy o está atrasado", items: followUps.filter((f) => f.status === "pending" && f.dueDate <= today) },
    {
      title: "Próximos 30 días",
      items: followUps.filter((f) => f.status === "pending" && f.dueDate > today && f.dueDate <= addDays(today, 30)),
    },
    { title: "Avisados", items: followUps.filter((f) => f.status === "sent") },
    { title: "Resueltos", items: followUps.filter((f) => f.status === "booked" || f.status === "dismissed").slice(-20) },
  ];

  const bookedRate = (() => {
    const notified = followUps.filter((f) => f.status === "sent" || f.status === "booked").length;
    const booked = followUps.filter((f) => f.status === "booked").length;
    return notified ? Math.round((booked / notified) * 100) : null;
  })();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Seguimientos</h1>
        <p className="mt-1 text-ink-soft">
          Revisiones periódicas que se programan solas al marcar una cita como atendida. El día que tocan,
          Huella envía al paciente un WhatsApp con un enlace para reservar.
        </p>
        {bookedRate !== null && (
          <p className="mt-3 inline-flex rounded-full bg-ok-soft px-3 py-1 text-sm font-semibold text-ok">
            {bookedRate}% de los avisados ya reservó su revisión
          </p>
        )}
      </div>

      {followUps.length === 0 && (
        <Card className="p-8 text-center">
          <IconRepeat className="mx-auto text-ink-mute" width={28} height={28} />
          <p className="mt-2 font-semibold">Aún no hay seguimientos</p>
          <p className="text-sm text-ink-soft">
            Configura en cada servicio cada cuántas semanas debe volver el paciente.
          </p>
        </Card>
      )}

      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.title}>
            <h2 className="mb-2 text-sm font-semibold text-ink-mute">{g.title}</h2>
            <Card className="divide-y divide-line">
              {g.items.map((f) => {
                const patient = patients.find((p) => p.id === f.patientId);
                const practitioner = practitioners.find((p) => p.id === f.practitionerId);
                const service = services.find((s) => s.id === f.serviceId);
                const chip = statusChip[f.status];
                return (
                  <div key={f.id} className="flex flex-wrap items-center gap-4 p-4">
                    {practitioner && <Avatar name={practitioner.name} color={practitioner.color} size={36} />}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{patient?.name}</p>
                      <p className="text-sm text-ink-soft">
                        {service?.name} con {practitioner?.name}
                        {patient && <span className="text-ink-mute"> · {formatPhone(patient.phone)}</span>}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cx("text-sm font-medium", f.status === "pending" && f.dueDate <= today && "text-accent")}>
                        {formatDay(f.dueDate, { day: "numeric", month: "short" })}
                      </p>
                      <span className={cx("mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold", chip.cls)}>
                        {chip.label}
                      </span>
                    </div>
                    {f.status === "pending" && (
                      <div className="flex w-full gap-2 sm:w-auto">
                        <form action={sendFollowUpAction.bind(null, f.id)}>
                          <Button size="sm" variant="whatsapp" disabled={!patient?.whatsappOptIn}>
                            <IconWhatsApp width={16} height={16} /> Avisar
                          </Button>
                        </form>
                        <form action={dismissFollowUpAction.bind(null, f.id)}>
                          <Button size="sm" variant="ghost">
                            Descartar
                          </Button>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
          </section>
        ))}
    </div>
  );
}
