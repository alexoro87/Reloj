import Link from "next/link";
import {
  IconCalendar,
  IconChat,
  IconQr,
  IconRepeat,
  IconUsers,
  IconWhatsApp,
} from "@/components/icons";
import { buttonClass, Card, Logo } from "@/components/ui";

const features = [
  {
    icon: IconQr,
    title: "Reserva con un QR",
    text: "Pega el QR en recepción, en tu tarjeta o en Instagram. El paciente elige podólogo, servicio y hora desde su celular, sin instalar nada.",
  },
  {
    icon: IconCalendar,
    title: "Directo a Google Calendar",
    text: "Cada cita aparece en el calendario del podólogo y la recepción recibe la invitación. Lo que anotes en Google también bloquea la agenda.",
  },
  {
    icon: IconWhatsApp,
    title: "Recordatorio por WhatsApp",
    text: "Un día antes, la paciente recibe un mensaje con botones para confirmar, cancelar o cambiar la fecha. Menos huecos vacíos.",
  },
  {
    icon: IconRepeat,
    title: "Seguimientos que vuelven",
    text: "Pie diabético, hongos, quiropodia: Huella recuerda cuándo toca la próxima revisión y se la ofrece al paciente en un clic.",
  },
  {
    icon: IconUsers,
    title: "Varios podólogos, una agenda",
    text: "Horarios por profesional, servicios que ofrece cada uno y opción de «primer podólogo disponible» para repartir la carga.",
  },
  {
    icon: IconChat,
    title: "Panel para recepción",
    text: "Vista del día por podólogo, estado de confirmación de cada cita y registro de todos los mensajes enviados.",
  },
];

export default function Home() {
  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo className="text-lg" />
        <Link href="/panel" className={buttonClass("ghost", "sm")}>
          Entrar al panel
        </Link>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-8 pb-20 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
        <div className="animate-rise">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand-strong">
            Hecho para clínicas de podología
          </p>
          <h1 className="text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-6xl">
            Tu agenda se llena sola. Tus pacientes llegan.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-ink-soft text-pretty">
            Citas en línea por QR, sincronizadas con Google Calendar y confirmadas por WhatsApp.
            Y cuando toca la siguiente revisión, Huella se la recuerda al paciente.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/c/pie-sano" className={buttonClass("primary", "lg")}>
              Probar como paciente
            </Link>
            <Link href="/panel" className={buttonClass("secondary", "lg")}>
              Ver el panel de la clínica
            </Link>
          </div>
          <p className="mt-4 text-sm text-ink-mute">
            Demo con datos de ejemplo · usuario <b>recepcion@piesano.demo</b> · contraseña <b>demo1234</b>
          </p>
        </div>

        <PhoneMock />
      </section>

      <section className="border-t border-line bg-surface/60">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance">
            Todo lo que una clínica de podología necesita para dejar de perder citas
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <Card key={f.title} className="p-6">
                <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                  <f.icon />
                </span>
                <h3 className="text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-ink-soft">{f.text}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl items-center justify-between px-5 py-8 text-sm text-ink-mute">
        <Logo />
        <span>Agenda inteligente para podólogos</span>
      </footer>
    </main>
  );
}

function PhoneMock() {
  return (
    <div className="relative mx-auto w-full max-w-sm animate-rise [animation-delay:120ms]">
      <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-brand-soft via-canvas to-accent-soft blur-2xl" />
      <div className="rounded-[2.5rem] border-8 border-ink bg-[#e9e2d6] p-4 shadow-[var(--shadow-pop)]">
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-whatsapp/95 px-4 py-3 text-white">
          <IconWhatsApp />
          <div className="leading-tight">
            <p className="font-semibold">Pie Sano</p>
            <p className="text-xs opacity-80">Cuenta de empresa</p>
          </div>
        </div>
        <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-white p-3.5 text-[15px] shadow-sm">
          Hola María, te recordamos tu cita en <b>Pie Sano</b>: Revisión de pie diabético con Dra.
          Laura Méndez el <b>martes 14 de octubre a las 10:00</b>. ¿Nos confirmas tu asistencia?
          <p className="mt-1 text-right text-[11px] text-ink-mute">9:00</p>
        </div>
        <div className="mt-1 max-w-[88%] space-y-1">
          {["Confirmar", "Cancelar", "Cambiar fecha"].map((b) => (
            <div
              key={b}
              className="rounded-xl bg-white py-2.5 text-center text-[15px] font-medium text-[#0a7cff] shadow-sm"
            >
              {b}
            </div>
          ))}
        </div>
        <div className="mt-3 ml-auto max-w-[60%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] p-3 text-[15px] shadow-sm">
          Confirmar
          <p className="mt-1 text-right text-[11px] text-ink-mute">9:02 ✓✓</p>
        </div>
        <div className="mt-2 max-w-[88%] rounded-2xl rounded-tl-sm bg-white p-3.5 text-[15px] shadow-sm">
          ¡Gracias, María! Tu cita quedó confirmada. Te esperamos. 🦶
        </div>
      </div>
    </div>
  );
}
