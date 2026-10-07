import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import { DEMO_LOGIN } from "@/lib/db/memory";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await getSession()) redirect("/panel");
  return <LoginForm demo={isDemoMode() ? DEMO_LOGIN : null} />;
}
