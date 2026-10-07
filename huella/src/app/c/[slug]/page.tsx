import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/booking-flow";
import { ClinicHeader } from "@/components/clinic-header";
import { Logo } from "@/components/ui";
import { getRepo } from "@/lib/db";
import { loadFlowData } from "@/lib/flow-data";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const clinic = await getRepo().getClinicBySlug(slug);
  return { title: clinic ? `Reservar cita en ${clinic.name}` : "Clínica no encontrada" };
}

export default async function ClinicBookingPage(props: PageProps<"/c/[slug]">) {
  const { slug } = await props.params;
  const search = await props.searchParams;
  const clinic = await getRepo().getClinicBySlug(slug);
  if (!clinic) notFound();
  const data = await loadFlowData(clinic);

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const practitionerId = one(search.podologo);
  const serviceId = one(search.servicio);

  return (
    <main className="flex-1">
      <ClinicHeader clinic={data.clinic} />
      <BookingFlow
        {...data}
        mode={{ type: "new" }}
        initial={{
          practitionerId: data.practitioners.some((p) => p.id === practitionerId) ? practitionerId : undefined,
          serviceId: data.services.some((s) => s.id === serviceId) ? serviceId : undefined,
        }}
      />
      <footer className="pb-10 text-center text-xs text-ink-mute">
        Reservas con <Logo className="ml-1 align-middle text-xs [&_svg]:h-4 [&_svg]:w-4" />
      </footer>
    </main>
  );
}
