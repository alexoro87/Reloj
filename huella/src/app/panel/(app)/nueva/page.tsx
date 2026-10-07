import type { Metadata } from "next";
import { BookingFlow } from "@/components/booking-flow";
import { requireSession } from "@/lib/auth";
import { loadFlowData } from "@/lib/flow-data";

export const metadata: Metadata = { title: "Nueva cita" };

export default async function NewAppointmentPage() {
  const { clinic } = await requireSession();
  const data = await loadFlowData(clinic);
  return (
    <div>
      <div className="mx-auto mb-6 max-w-2xl px-4">
        <p className="text-sm font-semibold text-ink-mute">Recepción</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Nueva cita</h1>
        <p className="mt-1 text-ink-soft">
          Para pacientes que llaman o vienen en persona. Usa la misma disponibilidad que la reserva en línea.
        </p>
      </div>
      <BookingFlow {...data} mode={{ type: "reception" }} />
    </div>
  );
}
