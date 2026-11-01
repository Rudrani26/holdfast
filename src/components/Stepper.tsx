import { Check } from "lucide-react";
import type { RentalStatus } from "@/domain/types";
import { workspaceSteps } from "@/lib/workspaceSteps";

/** Workspace progress (PRD §10 S6). Horizontal scroll on phones, vertical list on wide screens. */
export function Stepper({ status }: { status: RentalStatus }) {
  const steps = workspaceSteps(status);
  return (
    // min-w-0: as a grid item, let the step list scroll instead of widening the page on phones.
    <nav aria-label="Rental progress" className="min-w-0">
      <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {steps.map((s, i) => (
          <li
            key={s.key}
            aria-current={s.state === "current" ? "step" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              s.state === "current" ? "bg-primary/10 font-semibold" : s.state === "done" ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                s.state === "done" ? "border-primary bg-primary text-primary-foreground" : s.state === "current" ? "border-primary" : ""
              }`}
              aria-hidden="true"
            >
              {s.state === "done" ? <Check className="size-3.5" /> : i + 1}
            </span>
            {s.label}
            <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "current" ? " (current step)" : ""}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
