import { AlertTriangle, CheckCircle2, CircleHelp } from "lucide-react";
import type { Angle, Inspection } from "@/domain/types";

const pretty = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");

/** Latest baseline inspection, per angle: pre-existing marks, retake requests, or "needs review". */
export function BaselineSummary({ inspection, angles }: { inspection: Inspection; angles: Angle[] }) {
  const label = (id: string) => angles.find((a) => a.id === id)?.label ?? id;
  return (
    <section aria-labelledby="baseline-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="baseline-heading" className="text-lg font-semibold">
          AI baseline
        </h2>
        <p className="text-xs text-muted-foreground">
          {inspection.model} · {inspection.promptVersion}
          {inspection.mode === "REPLAY" && " · replayed AI result recorded from a live call"}
        </p>
      </div>
      <ul className="flex flex-col divide-y rounded-lg border">
        {inspection.perAngle.map((a) => (
          <li key={a.angleId} className="flex flex-col gap-1 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              {a.needsHuman ? (
                <CircleHelp className="size-4 text-amber-700" aria-hidden="true" />
              ) : !a.usable ? (
                <AlertTriangle className="size-4 text-red-700" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="size-4 text-emerald-700" aria-hidden="true" />
              )}
              {label(a.angleId)}
              <span className="font-normal text-muted-foreground">
                {a.needsHuman ? "— needs your review" : !a.usable ? "— retake photo" : `— ${a.marks?.length ? `${a.marks.length} pre-existing mark${a.marks.length > 1 ? "s" : ""}` : "no marks"}`}
              </span>
            </div>
            {a.needsHuman && <p className="text-xs text-muted-foreground">{a.error}</p>}
            {!a.needsHuman && !a.usable && a.issues.length > 0 && (
              <p className="text-xs text-muted-foreground">Photo issue: {a.issues.map(pretty).join(", ")}</p>
            )}
            {a.marks && a.marks.length > 0 && (
              <ul className="ml-6 list-disc text-xs">
                {a.marks.map((m) => (
                  <li key={m.markId}>
                    {pretty(m.damageType)} ({pretty(m.severity)}): {m.description}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
