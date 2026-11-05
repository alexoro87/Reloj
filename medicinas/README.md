# MediHora 💊

App web instalable (PWA) para recordar tomar tus medicinas a tiempo, inspirada en apps como MyTherapy.

## Funciones
- **Hoy**: tomas del día agrupadas por hora, anillo de progreso y tira semanal con puntos de cumplimiento.
- **Registrar tomas**: tomada, tomada a otra hora, posponer, omitir o deshacer.
- **Recordatorios**: notificación con botones “Tomada / Posponer”, alarma en pantalla con sonido y vibración.
- **Medicamentos**: nombre, concentración, forma, cantidad por toma, color, varios horarios,
  frecuencia (diaria, ciertos días de la semana o cada X días), fechas de inicio/fin, indicaciones y notas.
- **Inventario**: descuenta al tomar y avisa cuando quedan pocas unidades.
- **Progreso**: cumplimiento de 7 y 30 días, racha, gráfica de 14 días, cumplimiento por medicamento e historial.
- **Ajustes**: posponer 5–60 min, sonido, exportar/importar copia de seguridad.
- Funciona sin conexión. Los datos se guardan **solo en el teléfono** (localStorage).

## Cómo usarla en el celular
1. Publica el repositorio con **GitHub Pages** (Settings → Pages → rama `main`, carpeta `/root`).
2. Abre `https://<usuario>.github.io/<repo>/medicinas/` en el teléfono.
3. Menú del navegador → **Agregar a pantalla de inicio**.
4. Abre la app, agrega una medicina y acepta las notificaciones.

## Límites importantes
Una app web no puede programar alarmas del sistema como una app nativa:
- Los avisos llegan de forma confiable mientras la app está abierta o en segundo plano reciente.
  Si el sistema cierra el navegador, el aviso aparecerá al volver a abrir la app.
- En iPhone las notificaciones web requieren iOS 16.4+ y tener la app agregada a la pantalla de inicio.

Para alarmas 100 % garantizadas con la app cerrada, el siguiente paso sería empaquetarla como app nativa
(por ejemplo con Capacitor + Local Notifications) o añadir un servidor de notificaciones push.

> MediHora no sustituye el consejo de tu médico o farmacéutico.
