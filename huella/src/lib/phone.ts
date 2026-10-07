/**
 * Normaliza un teléfono a formato internacional sin "+" (lo que espera la API
 * de WhatsApp). Si el número no trae lada de país se usa la de la clínica.
 */
export function normalizePhone(input: string, countryCode: string): string | null {
  const trimmed = input.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") || trimmed.startsWith("00")) {
    digits = digits.replace(/^00/, "");
  } else if (!digits.startsWith(countryCode) || digits.length <= 10) {
    digits = countryCode + digits.replace(/^0+/, "");
  }
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

/** "525512345678" → "+52 55 1234 5678" (formato aproximado, solo para mostrar). */
export function formatPhone(phone: string): string {
  const local = phone.slice(-10);
  const cc = phone.slice(0, -10);
  return `+${cc} ${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
}
