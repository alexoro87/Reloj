"use client";

import { useActionState } from "react";
import { Button, Card, Field, inputClass, Logo } from "@/components/ui";
import { loginAction } from "../actions";

export function LoginForm({ demo }: { demo: { email: string; password: string } | null }) {
  const [error, action, pending] = useActionState(loginAction, null);
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm animate-rise">
        <Logo className="mb-8 text-xl" />
        <Card className="p-7">
          <h1 className="text-2xl font-semibold tracking-tight">Panel de la clínica</h1>
          <p className="mt-1 text-ink-soft">Entra para ver la agenda de hoy.</p>
          <form action={action} className="mt-6 space-y-4">
            <Field label="Correo">
              <input
                name="email"
                type="email"
                autoComplete="username"
                defaultValue={demo?.email}
                className={inputClass}
                required
              />
            </Field>
            <Field label="Contraseña">
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                defaultValue={demo?.password}
                className={inputClass}
                required
              />
            </Field>
            {error && <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </Card>
        {demo && (
          <p className="mt-4 text-center text-sm text-ink-mute">
            Modo demo: los datos de acceso ya están rellenos.
          </p>
        )}
      </div>
    </main>
  );
}
