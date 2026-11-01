import { BadgeCheck, Cog, Landmark, Sparkles, Store, User, type LucideIcon } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import type { EventActor, TimelineEvent } from "@/domain/types";
import { buildTimeline } from "@/lib/timeline";

// Provenance colours (components/Provenance.tsx): PayPal blue, Gemini violet and dashed, people in ink.
const ACTORS: Record<EventActor, { label: string; icon: LucideIcon; dot: string; name: string }> = {
  SYSTEM: { label: "Holdfast", icon: Cog, dot: "border bg-background", name: "text-foreground" },
  STAFF: { label: "Staff", icon: Store, dot: "border border-foreground/40 bg-card", name: "text-foreground" },
  RENTER: { label: "Renter", icon: User, dot: "border border-foreground/40 bg-card", name: "text-foreground" },
  AI: { label: "Gemini (AI)", icon: Sparkles, dot: "border border-dashed border-ai bg-ai-soft text-ai", name: "text-ai" },
  PAYPAL: { label: "PayPal", icon: Landmark, dot: "bg-paypal text-white", name: "text-paypal" },
};

const timeFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" });

/** Audit timeline for a rental (staff workspace and renter receipt). Renders only allowlisted fields. */
export function Timeline({ events, heading = "Timeline" }: { events: TimelineEvent[]; heading?: string }) {
  const items = buildTimeline(events);
  return (
    <section aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className="text-lg font-semibold">
        {heading}
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No events yet.</p>
      ) : (
        <ol className="mt-4 flex flex-col gap-0">
          {items.map((item) => {
            const actor = ACTORS[item.actor];
            const Icon = actor.icon;
            return (
              <li key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
                <span
                  aria-hidden="true"
                  className="absolute top-8 bottom-0 left-4 w-px bg-border [li:last-child>&]:hidden"
                />
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${actor.dot}`}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    <span className={`font-semibold ${actor.name}`}>{actor.label}</span>
                    {" · "}
                    <time dateTime={item.at}>{timeFmt.format(new Date(item.at))} UTC</time>
                  </p>
                  <p className={item.isWebhook ? "text-sm text-muted-foreground" : "text-sm"}>{item.summary}</p>
                  {(item.paypalConfirmed !== undefined || item.status) && (
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      {item.status && (
                        <span className="rounded border px-1.5 py-0.5 font-mono">
                          <span className="sr-only">PayPal status </span>
                          {item.status}
                        </span>
                      )}
                      {item.paypalConfirmed === true && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-paypal-soft px-2 py-0.5 font-semibold text-paypal ring-1 ring-paypal/30">
                          <BadgeCheck className="size-3.5" aria-hidden="true" />
                          PayPal-confirmed (verified webhook)
                        </span>
                      )}
                      {item.paypalConfirmed === false && (
                        <span className="text-muted-foreground">Awaiting PayPal webhook confirmation</span>
                      )}
                    </p>
                  )}
                  {item.paypalIds.length > 0 && (
                    <dl className="mt-1.5 flex flex-col gap-1 text-xs">
                      {item.paypalIds.map((id) => (
                        <div key={id.label} className="flex flex-wrap items-center gap-2">
                          <dt className="text-muted-foreground">{id.label}</dt>
                          <dd className="flex items-center gap-1">
                            <code className="font-mono break-all">{id.value}</code>
                            <CopyButton text={id.value} label="Copy" size="xs" ariaLabel={`Copy ${id.label} ID ${id.value}`} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
