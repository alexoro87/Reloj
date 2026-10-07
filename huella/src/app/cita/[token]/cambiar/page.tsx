import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookingFlow } from "@/components/booking-flow";
import { ClinicHeader } from "@/components/clinic-header";
import { IconArrowLeft } from "@/components/icons";
import { getRepo } from "@/lib/db";
import { loadFlowData } from "@/lib/flow-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cambiar cita", robots: { index: false } };

export default async function ReschedulePage(props: PageProps<"/cita/[token]/cambiar">) {
  const { token } = await props.params;
  const repo = getRepo();
  const appt = await repo.getAppointmentByToken(token);
  if (!appt) notFound();
  if (appt.status !== "booked" && appt.status !== "confirmed") redirect(`/cita/${token}`);
  const clinic = (await repo.getClinic(appt.clinicId))!;
  const data = await loadFlowData(clinic);

  return (
    <main className="flex-1">
      <ClinicHeader clinic={data.clinic} />
      <div className="mx-auto w-full max-w-2xl px-4">
        <Link
          href={`/cita/${token}`}
          className="mb-4 -ml-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-soft hover:bg-sunken"
        >
          <IconArrowLeft width={18} height={18} /> Volver a mi cita
        </Link>
      </div>
      <BookingFlow
        {...data}
        mode={{
          type: "reschedule",
          token,
          serviceId: appt.serviceId,
          practitionerId: appt.practitionerId,
        }}
      />
    </main>
  );
}
