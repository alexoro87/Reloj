# Backlog de MediHora

Ideas y pendientes acordados para próximas versiones.

## Pendientes
- **Tutorial dentro de la app** (no una página externa): recorrido de bienvenida la primera vez que se
  abre la app y una sección **Ajustes → Ayuda** con los pasos del tutorial (agregar medicina, escanear
  receta, marcar tomas, avisos repetidos, compartir con la familia, reportes).
  Referencia: tutorial publicado en https://claude.ai/artifact/2QJT9mPkMs8iF2BdeNmQuY
- **Modo adulto mayor**: botones grandes y voz que lea el recordatorio.
- **Aviso para resurtir** la medicina con opción de pedirla a la farmacia.
- **Notificaciones push** para cancelar el recordatorio en otros teléfonos cuando alguien de la familia
  ya registró la toma.
- **Cuentas con correo o Google** (necesario antes de cobrar una suscripción).

## En pausa
- **Recordatorios por WhatsApp**: el código de la app y del servidor está hecho, pero Meta exige verificar
  legalmente la empresa. Para retomarlo: verificar la empresa en Meta, crear la plantilla
  `recordatorio_medicina`, poner los secretos `WHATSAPP_*` en Supabase, llenar `WA_NUMBER` y cambiar
  `WA_ENABLED` a `true` en `medicinas/whatsapp.js`. La tarea `medihora-whatsapp` (pg_cron, cada minuto)
  sigue activa y no hace nada mientras falten los secretos. Alternativa sin verificación: bot de Telegram.

## En curso
- Escanear receta con IA (falta configurar la clave `ANTHROPIC_API_KEY` en Supabase).
