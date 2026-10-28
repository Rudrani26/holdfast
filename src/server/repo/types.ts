import "server-only";
import type {
  Inspection,
  Item,
  LineItem,
  Photo,
  PhotoPhase,
  PriceList,
  Rental,
  RentalStatus,
  SettlementRecord,
  TimelineEvent,
  WebhookEventRecord,
} from "@/domain/types";

/**
 * Storage port (docs/ARCHITECTURE.md §2–§3). Domain types in, domain types out: no Firestore types
 * cross this boundary. Collection names are prefixed with FIRESTORE_COLLECTION_PREFIX.
 *
 * State changes (rental status, settlement locks, webhook dedupe, AI usage counter) go through
 * `runTransaction`. As in Firestore, a transaction must do all reads before any write, and may run
 * more than once under contention, so the callback must not have side effects outside `tx`.
 */
export interface Repo {
  getItem(id: string): Promise<Item | undefined>;
  listItems(opts?: { activeOnly?: boolean }): Promise<Item[]>;
  putItem(item: Item): Promise<void>;

  getPriceList(id: string): Promise<PriceList | undefined>;
  putPriceList(priceList: PriceList): Promise<void>;

  getRental(id: string): Promise<Rental | undefined>;
  /** Newest `updatedAt` first. */
  listRentals(opts?: { status?: RentalStatus; limit?: number }): Promise<Rental[]>;
  /** Fails with DomainError RENTAL_EXISTS if the id is taken. */
  createRental(rental: Rental): Promise<void>;

  putPhoto(rentalId: string, photo: Photo): Promise<void>;
  listPhotos(rentalId: string, phase?: PhotoPhase): Promise<Photo[]>;

  putInspection(rentalId: string, inspection: Inspection): Promise<void>;
  getInspection(rentalId: string, inspectionId: string): Promise<Inspection | undefined>;
  /** Oldest first. */
  listInspections(rentalId: string): Promise<Inspection[]>;

  putLineItem(rentalId: string, line: LineItem): Promise<void>;
  getLineItem(rentalId: string, lineId: string): Promise<LineItem | undefined>;
  listLineItems(rentalId: string): Promise<LineItem[]>;

  /** Chronological by `at`, then id. Events are append-only; add them inside transactions. */
  listEvents(rentalId: string): Promise<TimelineEvent[]>;

  getSettlement(idempotencyKey: string): Promise<SettlementRecord | undefined>;
  listSettlements(rentalId: string): Promise<SettlementRecord[]>;

  getWebhookEvent(paypalEventId: string): Promise<WebhookEventRecord | undefined>;

  runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/** Transaction handle: reads first, then writes; writes apply atomically when the callback resolves. */
export interface Tx {
  getRental(id: string): Promise<Rental | undefined>;
  getSettlement(idempotencyKey: string): Promise<SettlementRecord | undefined>;
  getWebhookEvent(paypalEventId: string): Promise<WebhookEventRecord | undefined>;
  /** AI calls counted on a UTC day (`YYYY-MM-DD`); 0 if none. */
  getAiUsage(day: string): Promise<number>;

  putRental(rental: Rental): void;
  putSettlement(record: SettlementRecord): void;
  putWebhookEvent(record: WebhookEventRecord): void;
  setAiUsage(day: string, calls: number): void;
  /** Fails the transaction if an event with this id already exists for the rental. */
  addEvent(rentalId: string, event: TimelineEvent): void;
}

export const COLLECTIONS = {
  items: "items",
  priceLists: "priceLists",
  rentals: "rentals",
  settlements: "settlements",
  webhookEvents: "webhookEvents",
  meta: "meta",
} as const;

export const SUBCOLLECTIONS = {
  photos: "photos",
  inspections: "inspections",
  lineItems: "lineItems",
  events: "events",
} as const;

/** Photo document id per ARCHITECTURE.md §3: `<phase>_<angleId>`. */
export const photoDocId = (photo: Pick<Photo, "phase" | "angleId">) => `${photo.phase}_${photo.angleId}`;

export const aiUsageDocId = (day: string) => `aiUsage_${day}`;
