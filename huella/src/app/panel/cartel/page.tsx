import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cartel QR" };

/** Cartel imprimible (A5/carta) con el QR de reservas para la recepción. */
export default async function PosterPage() {
  const { clinic } = await requireSession();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-white p-8 print:p-0">
      <div className="flex w-full max-w-md flex-col items-center rounded-[2rem] border-2 border-brand p-10 text-center print:border-0">
        <p className="text-sm font-semibold tracking-widest text-brand uppercase">{clinic.name}</p>
        <h1 className="mt-4 text-4xl leading-tight font-semibold tracking-tight text-balance">
          Agenda tu próxima cita
        </h1>
        <p className="mt-3 text-lg text-ink-soft">Escanea el código con la cámara de tu celular</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/qr/${clinic.slug}`} alt="" className="my-8 w-64" />
        <ol className="space-y-1 text-left text-ink-soft">
          <li>1. Elige a tu podólogo</li>
          <li>2. Escoge el día y la hora</li>
          <li>3. Te recordamos tu cita por WhatsApp</li>
        </ol>
        {clinic.phone && <p className="mt-6 text-sm text-ink-mute">¿Dudas? Llámanos al {clinic.phone}</p>}
      </div>
      <PrintButton />
    </main>
  );
}
