import "server-only";
import { MemoryRepo } from "./memory";
import type { Repo } from "./repo";
import { SupabaseRepo } from "./supabase";

let repo: Repo | undefined;

/** Modo demo: sin Supabase configurado se usa una base de datos en memoria con datos de ejemplo. */
export function isDemoMode(): boolean {
  return !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function getRepo(): Repo {
  if (!repo) {
    repo = isDemoMode()
      ? new MemoryRepo()
      : new SupabaseRepo(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return repo;
}
