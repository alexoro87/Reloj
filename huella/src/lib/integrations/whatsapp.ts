import { createHmac, timingSafeEqual } from "node:crypto";
import type { MessageLog } from "../types";

/**
 * Cliente mínimo de la WhatsApp Cloud API (Meta).
 *
 * Los mensajes que inicia la clínica deben ser plantillas aprobadas por Meta.
 * Los textos de `TEMPLATES` son el contenido que hay que dar de alta en
 * WhatsApp Manager (categoría "Utilidad"), con los mismos parámetros y botones.
 * Sin credenciales, los envíos quedan "simulados" en el registro de mensajes.
 */

export type TemplateKind = "booked" | "reminder" | "follow_up";

export interface TemplateMessage {
  kind: TemplateKind;
  to: string;
  phoneNumberId: string | null;
  /** Parámetros {{1}}…{{6}} del cuerpo. */
  params: string[];
  /** Token de gestión de la cita (para payloads y botón URL). */
  token: string;
  /** Sufijo dinámico del botón URL (lo que va después de la URL base). */
  urlSuffix: string;
  appUrl: string;
}

interface TemplateDef {
  name: string;
  body: string;
  buttons: { type: "quick_reply"; label: string; action: "CONFIRM" | "CANCEL" }[];
  urlButton: { label: string; base: string };
}

export const TEMPLATES: Record<TemplateKind, TemplateDef> = {
  booked: {
    name: process.env.WA_TEMPLATE_BOOKED ?? "cita_agendada",
    body:
      "Hola {{1}}, tu cita en {{2}} quedó agendada: {{3}} con {{4}} el {{5}} a las {{6}}. " +
      "Te enviaremos un recordatorio antes.",
    buttons: [],
    urlButton: { label: "Ver o cambiar mi cita", base: "/cita/" },
  },
  reminder: {
    name: process.env.WA_TEMPLATE_REMINDER ?? "recordatorio_cita",
    body:
      "Hola {{1}}, te recordamos tu cita en {{2}}: {{3}} con {{4}} el {{5}} a las {{6}}. " +
      "¿Nos confirmas tu asistencia?",
    buttons: [
      { type: "quick_reply", label: "Confirmar", action: "CONFIRM" },
      { type: "quick_reply", label: "Cancelar", action: "CANCEL" },
    ],
    urlButton: { label: "Cambiar fecha", base: "/cita/" },
  },
  follow_up: {
    name: process.env.WA_TEMPLATE_FOLLOW_UP ?? "seguimiento_revision",
    body:
      "Hola {{1}}, en {{2}} ya toca tu revisión de {{3}} con {{4}}. " +
      "Agenda en un clic para mantener tus pies sanos.",
    buttons: [],
    urlButton: { label: "Agendar revisión", base: "/c/" },
  },
};

export function renderBody(kind: TemplateKind, params: string[]): string {
  return TEMPLATES[kind].body.replace(/\{\{(\d)\}\}/g, (_, i: string) => params[Number(i) - 1] ?? "");
}

export interface SendResult {
  status: MessageLog["status"];
  body: string;
  buttons: MessageLog["buttons"];
  error: string | null;
}

export function isWhatsAppConfigured(phoneNumberId: string | null): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && phoneNumberId);
}

export async function sendTemplate(msg: TemplateMessage): Promise<SendResult> {
  const def = TEMPLATES[msg.kind];
  const body = renderBody(msg.kind, msg.params);
  // Botones tal como los verá el paciente. En modo simulado enlazan a la web
  // para poder probar el flujo completo desde el panel.
  const manage = `${msg.appUrl}/cita/${msg.token}`;
  const buttons: MessageLog["buttons"] = [
    ...def.buttons.map((b) => ({
      label: b.label,
      url: `${manage}?accion=${b.action === "CONFIRM" ? "confirmar" : "cancelar"}`,
    })),
    { label: def.urlButton.label, url: `${msg.appUrl}${def.urlButton.base}${msg.urlSuffix}` },
  ];

  if (!isWhatsAppConfigured(msg.phoneNumberId)) {
    return { status: "simulated", body, buttons, error: null };
  }

  const components: object[] = [
    { type: "body", parameters: msg.params.map((text) => ({ type: "text", text })) },
    ...def.buttons.map((b, i) => ({
      type: "button",
      sub_type: "quick_reply",
      index: String(i),
      parameters: [{ type: "payload", payload: `${b.action}:${msg.token}` }],
    })),
    {
      type: "button",
      sub_type: "url",
      index: String(def.buttons.length),
      parameters: [{ type: "text", text: msg.urlSuffix }],
    },
  ];

  const error = await post(msg.phoneNumberId!, {
    messaging_product: "whatsapp",
    to: msg.to,
    type: "template",
    template: {
      name: def.name,
      language: { code: process.env.WA_TEMPLATE_LANG ?? "es_MX" },
      components,
    },
  });
  return { status: error ? "failed" : "sent", body, buttons, error };
}

/** Texto libre: solo permitido dentro de la ventana de 24 h tras un mensaje del paciente. */
export async function sendText(
  phoneNumberId: string | null,
  to: string,
  text: string,
): Promise<SendResult> {
  if (!isWhatsAppConfigured(phoneNumberId)) {
    return { status: "simulated", body: text, buttons: [], error: null };
  }
  const error = await post(phoneNumberId!, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
  return { status: error ? "failed" : "sent", body: text, buttons: [], error };
}

async function post(phoneNumberId: string, payload: object): Promise<string | null> {
  const version = process.env.WHATSAPP_API_VERSION ?? "v23.0";
  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return null;
    return `WhatsApp ${res.status}: ${(await res.text()).slice(0, 300)}`;
  } catch (e) {
    return `WhatsApp: ${(e as Error).message}`;
  }
}

// ---------------------------------------------------------------- webhook

/** Verifica la cabecera X-Hub-Signature-256 con el App Secret de Meta. */
export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(header.slice(7), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type InboundAction = "CONFIRM" | "CANCEL" | null;

export interface InboundMessage {
  from: string;
  phoneNumberId: string;
  text: string;
  action: InboundAction;
  /** Token incluido en el payload del botón, si lo hay. */
  token: string | null;
}

/** Extrae las respuestas de pacientes del payload del webhook de Meta. */
export function parseWebhook(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (payload as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { value?: WebhookValue }[] }[]) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      for (const m of value?.messages ?? []) {
        const phoneNumberId = value?.metadata?.phone_number_id ?? "";
        let text = "";
        let payloadStr: string | null = null;
        if (m.type === "button") {
          text = m.button?.text ?? "";
          payloadStr = m.button?.payload ?? null;
        } else if (m.type === "interactive") {
          text = m.interactive?.button_reply?.title ?? "";
          payloadStr = m.interactive?.button_reply?.id ?? null;
        } else if (m.type === "text") {
          text = m.text?.body ?? "";
        }
        const fromPayload = parsePayload(payloadStr);
        out.push({
          from: m.from,
          phoneNumberId,
          text,
          action: fromPayload?.action ?? actionFromText(text),
          token: fromPayload?.token ?? null,
        });
      }
    }
  }
  return out;
}

interface WebhookValue {
  metadata?: { phone_number_id?: string };
  messages?: {
    from: string;
    type: string;
    text?: { body?: string };
    button?: { text?: string; payload?: string };
    interactive?: { button_reply?: { id?: string; title?: string } };
  }[];
}

function parsePayload(p: string | null): { action: InboundAction; token: string } | null {
  const match = p?.match(/^(CONFIRM|CANCEL):(.+)$/);
  return match ? { action: match[1] as InboundAction, token: match[2] } : null;
}

export function actionFromText(text: string): InboundAction {
  const t = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  if (/^(si|sí|confirm|confirmo|confirmar|ok|vale|claro|alli estare)\b/.test(t)) return "CONFIRM";
  if (/^(no|cancel|cancelo|cancelar|no puedo|no podre)\b/.test(t)) return "CANCEL";
  return null;
}
