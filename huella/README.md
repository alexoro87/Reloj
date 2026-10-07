# Huella · Agenda para podólogos

SaaS de reservas para clínicas de podología:

- **QR → agenda**: el paciente escanea, elige podólogo (o «primer disponible»), servicio, día y hora, desde el celular y sin instalar nada.
- **Google Calendar**: cada cita se crea en el calendario del podólogo y la recepción recibe la invitación. Lo que esté ocupado en Google también bloquea la agenda.
- **WhatsApp**: confirmación al reservar y recordatorio (24 h antes, configurable) con botones **Confirmar / Cancelar / Cambiar fecha**. Las respuestas actualizan la cita y el calendario.
- **Seguimientos**: al marcar una cita como atendida, si el servicio lo pide (pie diabético cada 4 semanas, quiropodia cada 6…) se programa la revisión y el paciente recibe un WhatsApp para reservarla en un clic.
- **Panel de recepción**: agenda del día por podólogo, alta de citas por teléfono, estado de confirmación, historial de mensajes, QR y cartel imprimible.

## Probarlo en 1 minuto (modo demo)

```bash
npm install
npm run dev
```

- Paciente: http://localhost:3000/c/pie-sano
- Panel: http://localhost:3000/panel (`recepcion@piesano.demo` / `demo1234`)

Sin variables de entorno, la app usa una base de datos en memoria con datos de ejemplo, y WhatsApp/Google quedan **simulados**: los mensajes aparecen en *Panel → Mensajes* y sus botones permiten responder como si fueras el paciente.

## Arquitectura

| Capa | Tecnología |
|---|---|
| Web + API | Next.js 16 (App Router, Server Actions), React 19, Tailwind 4 |
| Datos | Supabase/Postgres (`src/lib/db/supabase.ts`) o memoria (`src/lib/db/memory.ts`) tras la interfaz `Repo` |
| Mensajería | WhatsApp Cloud API de Meta (`src/lib/integrations/whatsapp.ts`) |
| Calendario | Google Calendar API v3 vía OAuth (`src/lib/integrations/google.ts`) |
| Tareas | `GET /api/cron/reminders` cada 15 min (Vercel Cron o cualquier cron) |

Código clave:

- `src/lib/availability.ts`: cálculo de huecos libres (con pruebas, incluye cambios de horario de verano).
- `src/lib/booking.ts`: reglas de negocio (reservar, cambiar, confirmar, cancelar, recordatorios, seguimientos, respuestas de WhatsApp).
- `supabase/migrations/0001_init.sql`: esquema multi-clínica. Una **restricción de exclusión** impide en la base de datos que un podólogo tenga dos citas solapadas, aunque dos pacientes reserven a la vez.

Seguridad:
- Todo el acceso a datos ocurre en el servidor con la service-role key. RLS está activado sin políticas públicas.
- Cada consulta del panel se acota por la clínica del usuario.
- El paciente gestiona su cita con un token aleatorio en el enlace (sin cuenta).
- El webhook de WhatsApp verifica la firma `X-Hub-Signature-256`.
- La disponibilidad siempre se recalcula en el servidor antes de guardar.

## Puesta en producción

1. **Supabase**: crea un proyecto, ejecuta `supabase/migrations/0001_init.sql` y, si quieres datos de ejemplo, `supabase/seed.sql`. Cambia la contraseña de ejemplo (`node scripts/hash-password.mjs "nueva"`).
2. **Variables**: copia `.env.example` → `.env.local` (o configúralas en Vercel). Como mínimo: `APP_URL`, `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.
3. **Despliegue**: Vercel (`vercel.json` ya define el cron cada 15 min; requiere plan Pro para esa frecuencia) o cualquier hosting de Node con un cron externo que llame a `/api/cron/reminders` con `Authorization: Bearer $CRON_SECRET`.

### WhatsApp (Meta)

1. Crea una app en developers.facebook.com con el producto *WhatsApp* y verifica el *Meta Business*. Para dar de alta clínicas a escala, regístrate como *Tech Provider* o usa un BSP (360dialog, Twilio).
2. Registra el número de la clínica y copia su **Phone number ID** en *Panel → Ajustes*.
3. Crea un token de *System User* → `WHATSAPP_ACCESS_TOKEN`. App Secret → `WHATSAPP_APP_SECRET`.
4. Webhook: `{APP_URL}/api/whatsapp/webhook`, con el token de verificación `WHATSAPP_VERIFY_TOKEN`, suscrito a `messages`.
5. En WhatsApp Manager crea estas plantillas (categoría **Utilidad**, idioma `es_MX`):

| Nombre | Cuerpo | Botones |
|---|---|---|
| `cita_agendada` | Hola {{1}}, tu cita en {{2}} quedó agendada: {{3}} con {{4}} el {{5}} a las {{6}}. Te enviaremos un recordatorio antes. | URL «Ver o cambiar mi cita» → `{APP_URL}/cita/{{1}}` |
| `recordatorio_cita` | Hola {{1}}, te recordamos tu cita en {{2}}: {{3}} con {{4}} el {{5}} a las {{6}}. ¿Nos confirmas tu asistencia? | Respuesta rápida «Confirmar», respuesta rápida «Cancelar», URL «Cambiar fecha» → `{APP_URL}/cita/{{1}}` |
| `seguimiento_revision` | Hola {{1}}, en {{2}} ya toca tu revisión de {{3}} con {{4}}. Agenda en un clic para mantener tus pies sanos. | URL «Agendar revisión» → `{APP_URL}/c/{{1}}` |

### Google Calendar

1. En Google Cloud Console habilita *Google Calendar API* y crea credenciales OAuth de tipo *Aplicación web*.
2. URI de redirección: `{APP_URL}/api/google/callback`. Scopes: `calendar.events` y `calendar.freebusy`.
3. Copia `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Cada clínica pulsa *Conectar con Google* en Ajustes.
4. Para que cada podólogo tenga su calendario, compártelo con la cuenta conectada y guarda su ID en `practitioners.google_calendar_id`.
5. ⚠️ Los scopes de Calendar son «sensibles»: para salir del modo de prueba (100 usuarios), Google exige **verificar la app**. El trámite tarda semanas; conviene iniciarlo pronto.

## Scripts

```bash
npm run dev        # desarrollo
npm run build      # build de producción
npm test           # pruebas unitarias (vitest)
npm run lint
npm run typecheck
```

## Pendiente para siguientes versiones

- Alta de clínicas en autoservicio y cobro de suscripción (Stripe / Mercado Pago).
- Editor de podólogos, servicios y horarios en el panel (hoy se gestionan en la base de datos).
- Ausencias/vacaciones desde el panel (la tabla `time_off` ya existe y se respeta).
- Ficha podológica con fotos antes/después.
- Cifrar `google_refresh_token` con Supabase Vault.
- Baja de avisos («STOP») y aviso de privacidad por clínica.
