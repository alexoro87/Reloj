import type { PublicClinic } from "@/lib/types";
import { IconPhone, IconPin } from "./icons";

export function ClinicHeader({ clinic }: { clinic: PublicClinic }) {
  return (
    <header className="mx-auto w-full max-w-2xl px-4 pt-6 pb-6">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-lg font-bold text-white">
          {clinic.name
            .replace(/^(Clínica|Centro)\s+(Podológica|de Podología)?\s*/i, "")
            .charAt(0)}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold leading-tight">{clinic.name}</h1>
          <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-ink-mute">
            {clinic.address && (
              <span className="inline-flex items-center gap-1">
                <IconPin width={15} height={15} /> {clinic.address}
              </span>
            )}
            {clinic.phone && (
              <a href={`tel:${clinic.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 hover:text-ink">
                <IconPhone width={15} height={15} /> {clinic.phone}
              </a>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
