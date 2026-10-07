"use server";

import { redirect } from "next/navigation";
import { BookingError, cancelAppointment, confirmAppointment } from "@/lib/booking";
import { getRepo } from "@/lib/db";

export async function patientConfirm(token: string) {
  const appt = await getRepo().getAppointmentByToken(token);
  if (!appt) redirect("/");
  try {
    await confirmAppointment(appt);
  } catch (e) {
    if (!(e instanceof BookingError)) throw e;
  }
  redirect(`/cita/${token}?confirmada=1`);
}

export async function patientCancel(token: string) {
  const appt = await getRepo().getAppointmentByToken(token);
  if (!appt) redirect("/");
  try {
    await cancelAppointment(appt);
  } catch (e) {
    if (!(e instanceof BookingError)) throw e;
  }
  redirect(`/cita/${token}?cancelada=1`);
}
