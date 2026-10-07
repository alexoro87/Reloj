import "server-only";
import type { FlowPractitioner, FlowService } from "@/components/booking-flow";
import { getRepo } from "./db";
import { todayIn } from "./time";
import type { Clinic, PractitionerService, PublicClinic } from "./types";

export interface FlowData {
  clinic: PublicClinic;
  practitioners: FlowPractitioner[];
  services: FlowService[];
  links: PractitionerService[];
  today: string;
}

/** Datos públicos que necesita el flujo de reserva (sin tokens ni datos internos). */
export async function loadFlowData(clinic: Clinic): Promise<FlowData> {
  const repo = getRepo();
  const [practitioners, services, links, hours] = await Promise.all([
    repo.listPractitioners(clinic.id),
    repo.listServices(clinic.id),
    repo.listPractitionerServices(clinic.id),
    repo.listWorkingHours(clinic.id),
  ]);
  const activeP = practitioners.filter((p) => p.active);
  const activeS = services.filter((s) => s.active);
  return {
    clinic: {
      id: clinic.id,
      slug: clinic.slug,
      name: clinic.name,
      timezone: clinic.timezone,
      phone: clinic.phone,
      address: clinic.address,
      bookingHorizonDays: clinic.bookingHorizonDays,
    },
    practitioners: activeP.map((p) => ({
      id: p.id,
      name: p.name,
      title: p.title,
      bio: p.bio,
      color: p.color,
      workdays: [...new Set(hours.filter((h) => h.practitionerId === p.id).map((h) => h.weekday))],
    })),
    services: activeS.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      durationMin: s.durationMin,
      priceCents: s.priceCents,
    })),
    links: links.filter(
      (l) => activeP.some((p) => p.id === l.practitionerId) && activeS.some((s) => s.id === l.serviceId),
    ),
    today: todayIn(clinic.timezone),
  };
}
