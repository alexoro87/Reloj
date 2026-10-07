"use client";

import { useActionState } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { saveSettingsAction } from "../../actions";

interface Values {
  name: string;
  phone: string;
  address: string;
  receptionEmail: string;
  reminderHoursBefore: number;
  minNoticeMinutes: number;
  bookingHorizonDays: number;
  whatsappPhoneNumberId: string;
  googleCalendarId: string;
}

export function SettingsForm({ clinic, canEdit }: { clinic: Values; canEdit: boolean }) {
  const [result, action, pending] = useActionState(saveSettingsAction, null);
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Datos de la clínica</h2>
      <form action={action} className="mt-5 grid gap-5 sm:grid-cols-2">
        <fieldset disabled={!canEdit} className="contents">
          <div className="sm:col-span-2">
            <Field label="Nombre">
              <input name="name" defaultValue={clinic.name} className={inputClass} required />
            </Field>
          </div>
          <Field label="Teléfono">
            <input name="phone" defaultValue={clinic.phone} className={inputClass} />
          </Field>
          <Field label="Correo de recepción" hint="Recibe la invitación de cada cita en Google Calendar.">
            <input name="receptionEmail" type="email" defaultValue={clinic.receptionEmail} className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Dirección">
              <input name="address" defaultValue={clinic.address} className={inputClass} />
            </Field>
          </div>
          <Field label="Recordatorio (horas antes)">
            <input
              name="reminderHoursBefore"
              type="number"
              min={1}
              max={168}
              defaultValue={clinic.reminderHoursBefore}
              className={inputClass}
            />
          </Field>
          <Field label="Antelación mínima (minutos)" hint="No se puede reservar con menos margen.">
            <input
              name="minNoticeMinutes"
              type="number"
              min={0}
              defaultValue={clinic.minNoticeMinutes}
              className={inputClass}
            />
          </Field>
          <Field label="Reservas hasta (días)">
            <input
              name="bookingHorizonDays"
              type="number"
              min={1}
              max={180}
              defaultValue={clinic.bookingHorizonDays}
              className={inputClass}
            />
          </Field>
          <Field label="WhatsApp · Phone number ID" hint="Lo da Meta al registrar el número de la clínica.">
            <input name="whatsappPhoneNumberId" defaultValue={clinic.whatsappPhoneNumberId} className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Calendario de Google por defecto"
              hint="Si un podólogo no tiene calendario propio, sus citas van aquí. Vacío = calendario principal."
            >
              <input
                name="googleCalendarId"
                defaultValue={clinic.googleCalendarId}
                placeholder="primary"
                className={inputClass}
              />
            </Field>
          </div>
        </fieldset>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending || !canEdit}>
            {pending ? "Guardando…" : "Guardar cambios"}
          </Button>
          {result === "ok" && <span className="text-sm font-medium text-ok">Guardado</span>}
          {result && result !== "ok" && <span className="text-sm text-danger">{result}</span>}
          {!canEdit && <span className="text-sm text-ink-mute">Solo el administrador puede editar.</span>}
        </div>
      </form>
    </Card>
  );
}
