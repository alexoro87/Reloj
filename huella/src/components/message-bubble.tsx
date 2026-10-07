import { formatTime } from "@/lib/time";
import type { MessageLog } from "@/lib/types";
import { cx } from "./ui";

const kindLabel: Record<string, string> = {
  booked: "Confirmación de reserva",
  reminder: "Recordatorio",
  follow_up: "Aviso de revisión",
  reply: "Respuesta",
};

const statusLabel: Record<MessageLog["status"], string> = {
  sent: "Enviado",
  simulated: "Simulado (demo)",
  failed: "Error al enviar",
  received: "Recibido",
};

/** Burbuja estilo WhatsApp. En modo simulado, los botones abren la acción como si fueras el paciente. */
export function MessageBubble({ message: m, timezone }: { message: MessageLog; timezone: string }) {
  const out = m.direction === "out";
  return (
    <div className={cx("flex", out ? "justify-start" : "justify-end")}>
      <div className="max-w-[88%] sm:max-w-[70%]">
        <div
          className={cx(
            "rounded-2xl p-3 text-[15px] shadow-sm",
            out ? "rounded-tl-sm bg-white" : "rounded-tr-sm bg-[#d9fdd3]",
          )}
        >
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-ink-mute uppercase">
            {kindLabel[m.kind] ?? m.kind}
          </p>
          <p className="whitespace-pre-line">{m.body}</p>
          <p
            className={cx(
              "mt-1 text-right text-[11px]",
              m.status === "failed" ? "text-danger" : "text-ink-mute",
            )}
          >
            {statusLabel[m.status]} · {formatTime(m.createdAt, timezone)}
          </p>
          {m.error && <p className="mt-1 text-xs text-danger">{m.error}</p>}
        </div>
        {m.buttons.length > 0 && (
          <div className="mt-1 space-y-1">
            {m.buttons.map((b) =>
              b.url && m.status === "simulated" ? (
                <a
                  key={b.label}
                  href={b.url}
                  target="_blank"
                  rel="noreferrer"
                  title="Simular la respuesta del paciente"
                  className="block rounded-xl bg-white py-2 text-center text-[15px] font-medium text-[#0a7cff] shadow-sm hover:bg-white/80"
                >
                  {b.label}
                </a>
              ) : (
                <div
                  key={b.label}
                  className="rounded-xl bg-white py-2 text-center text-[15px] font-medium text-[#0a7cff] shadow-sm"
                >
                  {b.label}
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
