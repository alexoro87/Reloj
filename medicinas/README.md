# MediHora 💊

App web instalable (PWA) para recordar tomar tus medicinas a tiempo, inspirada en apps como MyTherapy.

## Funciones
- **Hoy**: tomas del día agrupadas por hora, anillo de progreso y tira semanal con puntos de cumplimiento.
- **Registrar tomas**: tomada, tomada a otra hora, posponer, omitir o deshacer.
- **Recordatorios**: notificación con botones “Tomada / Posponer” y un sonido suave de campanita (avisa sin asustar).
- **Agregar medicamento en 4 pasos**: qué medicina → **cada cuánto** (cada 4/6/8/12 horas, 1 vez al día,
  cada 2 o 3 días, u horarios a tu medida) y la hora de la primera toma → **por cuántos días** (o uso continuo)
  → extras. La app calcula y programa todas las tomas sola (ej. cada 8 horas por 7 días = 21 tomas) y
  muestra un resumen con la primera y la última toma y cuántas pastillas necesitarás.
- **Receta médica**: en cada medicamento puedes tomar o subir fotos de la receta, con el nombre del médico
  y la fecha. Se ven a pantalla completa, se pueden compartir y se incluyen (opcional) al final del PDF.
  Se guardan en el teléfono (IndexedDB), comprimidas, y van dentro de la copia de seguridad.
- **Inventario**: descuenta al tomar y avisa cuando quedan pocas unidades.
- **Progreso**: cumplimiento de 7 y 30 días, racha, gráfica de 14 días, cumplimiento por medicamento e historial.
- **Reportes**: gráfica de **hora programada vs. hora real** de cada toma (por medicamento y horario,
  7/14/30 días), porcentaje a tiempo (±30 min), desfase promedio, tomas olvidadas, tabla por día
  y descarga en CSV para compartir con tu médico.
- **Reporte en PDF** (botón 🖨 PDF en Reportes): resumen, gráfica y tabla por día de cada medicamento,
  para 7/14/30/90 días. Se puede imprimir, compartir (WhatsApp, correo…) o descargar. Funciona sin conexión.
- **Ajustes**: posponer 5–60 min, sonido, exportar/importar copia de seguridad.
- Funciona sin conexión. Los datos se guardan **solo en el teléfono** (localStorage).

## Ayuda dentro de la app
- **Recorrido de bienvenida**: 5 pantallas la primera vez que se abre la app (se puede saltar).
- **Ajustes → Ayuda y tutorial**: guías con capturas reales (agregar medicina, escanear receta, avisos,
  familia, reportes) y preguntas frecuentes. Las imágenes están en `medicinas/ayuda/`.

## Personas y familia (compartir)
- **Perfiles por persona** (Yo, Sofía, Abuela…): barra «Todos · persona» arriba de Hoy, Medicinas y Progreso;
  al agregar una medicina se elige «¿Para quién?». Los recordatorios se activan o desactivan por persona.
- **Compartir con la familia**: en el perfil → «Compartir con mi familia» → «Invitar a alguien» genera un
  código (ej. `K7P2 QX8M`, vence en 7 días). La otra persona entra a «+ Persona → Tengo un código».
- Todos ven y actualizan las mismas medicinas, tomas y recetas **en tiempo real**, y cada toma dice quién
  la dio («tomada 08:05 por Mamá»). Sin internet se sigue usando y se sincroniza al volver la señal.
- **Evita la doble dosis**: antes de registrar una toma se revisa si otra persona ya la dio.
- Servidor: proyecto Supabase «MediHora» con acceso anónimo (sin correo ni contraseña). Cada perfil solo
  lo pueden ver sus miembros (reglas de seguridad en el servidor) y las fotos van a un almacenamiento privado.

## Cómo usarla en el celular
1. Publica el repositorio con **GitHub Pages** (Settings → Pages → rama `main`, carpeta `/root`).
2. Abre `https://<usuario>.github.io/<repo>/medicinas/` en el teléfono.
3. Menú del navegador → **Agregar a pantalla de inicio**.
4. Abre la app, agrega una medicina y acepta las notificaciones.

## App de Android (alarmas garantizadas)
La carpeta `android/` empaqueta esta misma app con [Capacitor](https://capacitorjs.com). En la app nativa:
- Las alarmas las programa el sistema: **suenan aunque la app esté cerrada** y después de reiniciar el teléfono.
- Sonido suave de recordatorio, botones **✓ Tomada** y **⏱ Posponer** en la notificación.
- Reportes, PDF, copias de seguridad y recetas se comparten con el menú del teléfono.

### Descargar e instalar
1. Cada vez que se suben cambios, GitHub Actions compila el APK (pestaña **Actions** → «App Android (APK)»)
   y lo publica en **Releases** como `MediHora.apk`.
2. Abre la página de Releases desde el teléfono, descarga `MediHora.apk` y ábrelo.
   Android pedirá permitir «instalar apps de origen desconocido» para tu navegador: acéptalo.
3. Abre MediHora → agrega tus medicinas → **Activar** alarmas. En Android 12+ activa también
   «Alarmas y recordatorios» cuando la app lo pida.
4. Si tu teléfono tiene ahorro de batería agresivo (Xiaomi, Huawei, Samsung…), quita la restricción
   de batería para MediHora.

### Llave de firma
Para que cada versión nueva se instale encima de la anterior **sin perder datos**, el APK debe firmarse
siempre con la misma llave. La llave no se guarda en el repositorio: se configura en
Settings → Secrets and variables → Actions con los secretos `MEDIHORA_KEYSTORE_BASE64` (archivo .keystore en base64)
y `MEDIHORA_KEYSTORE_PASSWORD`. Sin ellos, el APK se firma con una llave temporal (sirve para probar).

### Compilar en tu computadora (opcional)
Requiere Node 22+, JDK 21 y Android Studio.
```bash
npm install
npx cap sync android
npx cap open android
```

### iPhone
Capacitor también genera la app de iOS (`npx cap add ios`), pero compilarla requiere una Mac con Xcode
y una cuenta de Apple Developer para instalarla de forma permanente.

## Límites de la versión web
Una app web no puede programar alarmas del sistema como una app nativa:
- Los avisos llegan de forma confiable mientras la app está abierta o en segundo plano reciente.
- En iPhone las notificaciones web requieren iOS 16.4+ y tener la app agregada a la pantalla de inicio.

> MediHora no sustituye el consejo de tu médico o farmacéutico.

## Créditos
- Sincronización con [supabase-js](https://github.com/supabase/supabase-js) (licencia MIT, incluida en `vendor/`).
- PDF generado con [jsPDF](https://github.com/parallax/jsPDF) (licencia MIT, incluida en `vendor/`).
- App nativa con [Capacitor](https://capacitorjs.com) (licencia MIT).
