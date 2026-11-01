import type { EventActor, TimelineEvent } from "@/domain/types";

// Timeline view model (TASKS T-024). Pure. Only allowlisted PayPal ids and statuses leave the event
// `data`; nothing else (and so no secret, token or personal field) is rendered.

/** Keys in event data that hold PayPal object ids, with their display labels. */
const ID_FIELDS = {
  orderId: "Order",
  authorizationId: "Authorization",
  paypalObjectId: "PayPal object",
  resourceId: "Resource",
  eventId: "Webhook event",
} as const;
type IdField = keyof typeof ID_FIELDS;

const PAYPAL_ID = /^[A-Za-z0-9-]{6,64}$/;

/** Which verified webhook types confirm which of our recorded results (sandbox E7 event names). */
function confirmingWebhookTypes(event: TimelineEvent): string[] {
  if (event.type === "DEPOSIT_AUTHORIZED") return ["PAYMENT.AUTHORIZATION.CREATED"];
  if (event.type !== "SETTLEMENT_OP_SUCCEEDED") return [];
  switch (event.data.op) {
    case "CAPTURE":
      return ["PAYMENT.CAPTURE.COMPLETED"];
    case "VOID":
      return ["PAYMENT.AUTHORIZATION.VOIDED"];
    case "REFUND":
      return ["PAYMENT.CAPTURE.REFUNDED"];
    default:
      return [];
  }
}

/** The PayPal object a result event is about (the one a webhook would name as its resource). */
function subjectId(event: TimelineEvent): string | undefined {
  const v = event.type === "DEPOSIT_AUTHORIZED" ? event.data.authorizationId : event.data.paypalObjectId;
  return typeof v === "string" ? v : undefined;
}

export interface TimelineItem {
  id: string;
  at: string;
  actor: EventActor;
  type: string;
  summary: string;
  paypalIds: { label: string; value: string }[];
  status?: string;
  /** Result events only: a verified PayPal webhook confirmed this object. */
  paypalConfirmed?: boolean;
  isWebhook: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export function buildTimeline(events: TimelineEvent[]): TimelineItem[] {
  // Parse times: PayPal's resource times have no milliseconds ("…08Z"), ours do ("…08.000Z").
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const verified = sorted
    .filter((e) => e.type === "PAYPAL_WEBHOOK_VERIFIED")
    .map((e) => ({ type: str(e.data.eventType), resourceId: str(e.data.resourceId) }));

  return sorted.map((e) => {
    const paypalIds = (Object.keys(ID_FIELDS) as IdField[])
      .map((k): { label: string; value: string | undefined } => ({ label: ID_FIELDS[k], value: str(e.data[k]) }))
      .filter((x): x is { label: string; value: string } => x.value !== undefined && PAYPAL_ID.test(x.value));
    // A void's object id is the authorization id: show it once.
    const unique = paypalIds.filter((x, i) => paypalIds.findIndex((y) => y.value === x.value) === i);

    const types = confirmingWebhookTypes(e);
    const subject = subjectId(e);
    const status = str(e.data.status);
    return {
      id: e.id,
      at: e.at,
      actor: e.actor,
      type: e.type,
      summary: e.summary,
      paypalIds: unique,
      ...(status && /^[A-Z_]{2,40}$/.test(status) ? { status } : {}),
      ...(types.length > 0 ? { paypalConfirmed: verified.some((w) => w.resourceId === subject && types.includes(w.type ?? "")) } : {}),
      isWebhook: e.type === "PAYPAL_WEBHOOK_VERIFIED",
    };
  });
}
