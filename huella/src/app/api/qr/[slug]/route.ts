import QRCode from "qrcode";
import { getAppUrl } from "@/lib/app-url";
import { getRepo } from "@/lib/db";

/** QR que lleva a la página de reservas de la clínica. ?formato=png para descargar. */
export async function GET(req: Request, ctx: RouteContext<"/api/qr/[slug]">) {
  const { slug } = await ctx.params;
  const clinic = await getRepo().getClinicBySlug(slug);
  if (!clinic) return new Response("No encontrada", { status: 404 });

  const url = `${await getAppUrl()}/c/${clinic.slug}`;
  const opts = { margin: 2, errorCorrectionLevel: "M" as const, color: { dark: "#1d2a27", light: "#ffffff" } };
  const png = new URL(req.url).searchParams.get("formato") === "png";

  if (png) {
    const buffer = await QRCode.toBuffer(url, { ...opts, width: 1200 });
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="qr-${clinic.slug}.png"`,
      },
    });
  }
  const svg = await QRCode.toString(url, { ...opts, type: "svg" });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
}
