// MediHora — Lee la foto de una receta médica con Claude y devuelve las medicinas en JSON.
// Necesita el secreto ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets).
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const MAX_POR_DIA = 20; // escaneos por usuario cada 24 h (controla el costo)
const MAX_IMAGEN = 4_000_000; // ~3 MB de imagen en base64

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Formato que debe devolver el modelo (coincide con los campos del asistente de la app)
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["legible", "doctor", "fecha", "medicamentos", "avisos"],
  properties: {
    legible: { type: "boolean", description: "false si la foto no es una receta o no se puede leer" },
    doctor: { type: "string", description: "Nombre del médico tal como aparece, o vacío" },
    fecha: { type: "string", description: "Fecha de la receta en formato AAAA-MM-DD, o vacío" },
    avisos: { type: "array", items: { type: "string" }, description: "Dudas o partes ilegibles, en español, breves" },
    medicamentos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nombre", "concentracion", "forma", "cantidad", "plan", "horarios", "dias_semana", "dias", "indicacion", "notas", "seguro"],
        properties: {
          nombre: { type: "string" },
          concentracion: { type: "string", description: "Ej. 500 mg, 250 mg/5 ml; vacío si no aparece" },
          forma: { type: "string", enum: ["comprimido", "cápsula", "gota", "ml", "inyección", "inhalación", "sobre", "aplicación", "unidad"] },
          cantidad: { type: "number", description: "Cantidad por toma en la unidad de 'forma' (ej. 1 tableta, 5 ml, 10 gotas); 0 si no se indica" },
          plan: { type: "string", enum: ["h4", "h6", "h8", "h12", "h24", "d2", "d3", "custom"], description: "h8 = cada 8 horas; h24 = una vez al día; d2 = cada 2 días; custom = horarios específicos u otra pauta" },
          horarios: { type: "array", items: { type: "string" }, description: "Solo si la receta da horas concretas, en formato HH:MM 24 h" },
          dias_semana: { type: "array", items: { type: "integer", enum: [0, 1, 2, 3, 4, 5, 6] }, description: "Solo si se toma ciertos días de la semana (0 = domingo, 1 = lunes … 6 = sábado); vacío si es diario" },
          dias: { type: "integer", description: "Duración del tratamiento en días; 0 si es uso continuo o no se indica" },
          indicacion: { type: "string", enum: ["", "Antes de comer", "Con comida", "Después de comer", "En ayunas"] },
          notas: { type: "string", description: "Otras indicaciones breves de la receta (ej. 'en caso de dolor', 'agitar antes de usar')" },
          seguro: { type: "boolean", description: "false si algún dato de este medicamento es dudoso" },
        },
      },
    },
  },
};

const PROMPT = `Eres un asistente que transcribe recetas médicas (normalmente de México) para una app de recordatorios.
Lee la foto y extrae cada medicamento con su pauta, exactamente como está escrita.

Reglas:
- No inventes ni completes datos. Si algo no se lee o no aparece, deja el campo vacío / 0 y explica la duda en "avisos".
- "cada 8 horas" = h8, "cada 12 horas" = h12, "cada 24 horas" o "una vez al día" = h24, "cada tercer día" = d2.
  Pautas como "2 veces al día" = h12, "3 veces al día" = h8, "4 veces al día" = h6.
  Si dice "en caso de dolor/fiebre" o una pauta que no encaja, usa "custom" y ponlo en notas.
- Si solo se toma ciertos días ("lunes, miércoles y viernes"), usa plan "custom", llena dias_semana y pon la hora en horarios si aparece.
- "por 7 días" = dias 7; "por una semana" = 7; "por un mes" = 30; tratamiento permanente o sin duración = 0.
- La cantidad va en la unidad de "forma": "1 tableta" → comprimido 1; "5 ml" → ml 5; "10 gotas" → gota 10.
- Marca "seguro": false en cualquier medicamento con letra dudosa.
- Si la imagen no es una receta o es ilegible, devuelve legible=false y medicamentos vacío.
Escribe todo en español.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  // Quién llama (sesión de la app, también anónima)
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Sin sesión" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { count } = await admin.from("scan_usage").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).gte("at", since);
  if ((count ?? 0) >= MAX_POR_DIA) return json({ error: "Llegaste al límite de escaneos de hoy. Inténtalo mañana." }, 429);

  let image = "";
  try {
    image = (await req.json())?.image ?? "";
  } catch { /* cuerpo inválido */ }
  if (typeof image !== "string" || !image || image.length > MAX_IMAGEN) return json({ error: "Imagen no válida" }, 400);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "El servidor aún no tiene configurada la clave de IA" }, 503);
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: PROMPT },
        ],
      }],
    });

    await admin.from("scan_usage").insert({ user_id: user.id, ok: response.stop_reason !== "refusal" });

    if (response.stop_reason === "refusal") return json({ error: "No se pudo leer esta imagen" }, 422);
    if (response.stop_reason === "max_tokens") return json({ error: "La receta es demasiado larga; toma la foto por partes" }, 422);
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return json(JSON.parse(text));
  } catch (e) {
    console.error("leer-receta", e);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "El servicio está ocupado. Intenta en un minuto." }, 503);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "La clave de IA del servidor no es válida" }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: "No se pudo leer la receta. Intenta de nuevo." }, 502);
    return json({ error: "No se pudo leer la receta. Intenta de nuevo." }, 500);
  }
});
