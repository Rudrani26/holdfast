import "server-only";
import {
  DomainError,
  type Inspection,
  type Item,
  type LineItem,
  type Photo,
  type PhotoPhase,
  type PriceList,
  type Rental,
  type RentalStatus,
  type SettlementRecord,
  type TimelineEvent,
  type WebhookEventRecord,
} from "@/domain/types";
import { photoDocId, type Repo, type Tx } from "./types";

const clone = <T>(value: T): T => structuredClone(value);

const byEventOrder = (a: TimelineEvent, b: TimelineEvent) =>
  a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * In-memory Repo for unit tests and local runs without Firestore. Mirrors Firestore transaction
 * rules (reads before writes, atomic commit) and runs transactions one at a time, so concurrency
 * tests see the same "second caller observes the first caller's commit" behaviour.
 */
export class MemoryRepo implements Repo {
  private items = new Map<string, Item>();
  private priceLists = new Map<string, PriceList>();
  private rentals = new Map<string, Rental>();
  private photos = new Map<string, Map<string, Photo>>();
  private inspections = new Map<string, Map<string, Inspection>>();
  private lineItems = new Map<string, Map<string, LineItem>>();
  private events = new Map<string, Map<string, TimelineEvent>>();
  private settlements = new Map<string, SettlementRecord>();
  private webhookEvents = new Map<string, WebhookEventRecord>();
  private aiUsage = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();

  private sub<T>(store: Map<string, Map<string, T>>, rentalId: string): Map<string, T> {
    let m = store.get(rentalId);
    if (!m) store.set(rentalId, (m = new Map()));
    return m;
  }

  async getItem(id: string) {
    return clone(this.items.get(id));
  }
  async listItems(opts: { activeOnly?: boolean } = {}) {
    return [...this.items.values()].filter((i) => !opts.activeOnly || i.active).map(clone);
  }
  async putItem(item: Item) {
    this.items.set(item.id, clone(item));
  }

  async getPriceList(id: string) {
    return clone(this.priceLists.get(id));
  }
  async putPriceList(priceList: PriceList) {
    this.priceLists.set(priceList.id, clone(priceList));
  }

  async getRental(id: string) {
    return clone(this.rentals.get(id));
  }
  async listRentals(opts: { status?: RentalStatus; limit?: number } = {}) {
    return [...this.rentals.values()]
      .filter((r) => !opts.status || r.status === opts.status)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, opts.limit ?? Number.POSITIVE_INFINITY)
      .map(clone);
  }
  async createRental(rental: Rental) {
    await this.runTransaction(async (tx) => {
      if (await tx.getRental(rental.id)) throw new DomainError("RENTAL_EXISTS", `rental ${rental.id} exists`);
      tx.putRental(rental);
    });
  }

  async putPhoto(rentalId: string, photo: Photo) {
    this.sub(this.photos, rentalId).set(photoDocId(photo), clone(photo));
  }
  async listPhotos(rentalId: string, phase?: PhotoPhase) {
    return [...this.sub(this.photos, rentalId).values()].filter((p) => !phase || p.phase === phase).map(clone);
  }

  async putInspection(rentalId: string, inspection: Inspection) {
    this.sub(this.inspections, rentalId).set(inspection.id, clone(inspection));
  }
  async getInspection(rentalId: string, inspectionId: string) {
    return clone(this.sub(this.inspections, rentalId).get(inspectionId));
  }
  async listInspections(rentalId: string) {
    return [...this.sub(this.inspections, rentalId).values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .map(clone);
  }

  async putLineItem(rentalId: string, line: LineItem) {
    this.sub(this.lineItems, rentalId).set(line.id, clone(line));
  }
  async getLineItem(rentalId: string, lineId: string) {
    return clone(this.sub(this.lineItems, rentalId).get(lineId));
  }
  async listLineItems(rentalId: string) {
    return [...this.sub(this.lineItems, rentalId).values()].map(clone);
  }

  async listEvents(rentalId: string) {
    return [...this.sub(this.events, rentalId).values()].sort(byEventOrder).map(clone);
  }

  async getSettlement(key: string) {
    return clone(this.settlements.get(key));
  }
  async listSettlements(rentalId: string) {
    return [...this.settlements.values()].filter((s) => s.rentalId === rentalId).map(clone);
  }

  async getWebhookEvent(id: string) {
    return clone(this.webhookEvents.get(id));
  }

  runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const run = async () => {
      const writes: (() => void)[] = [];
      const pendingEventIds = new Set<string>();
      let wrote = false;
      const read = <R>(get: () => R) => {
        if (wrote) throw new Error("transaction reads must happen before writes (Firestore rule)");
        return Promise.resolve(clone(get()));
      };
      const write = (apply: () => void) => {
        wrote = true;
        writes.push(apply);
      };

      const tx: Tx = {
        getRental: (id) => read(() => this.rentals.get(id)),
        getSettlement: (key) => read(() => this.settlements.get(key)),
        getWebhookEvent: (id) => read(() => this.webhookEvents.get(id)),
        getAiUsage: (day) => read(() => this.aiUsage.get(day) ?? 0),
        putRental: (r) => write(() => this.rentals.set(r.id, clone(r))),
        putSettlement: (s) => write(() => this.settlements.set(s.idempotencyKey, clone(s))),
        putWebhookEvent: (e) => write(() => this.webhookEvents.set(e.paypalEventId, clone(e))),
        setAiUsage: (day, calls) => write(() => this.aiUsage.set(day, calls)),
        addEvent: (rentalId, event) => {
          const key = `${rentalId}/${event.id}`;
          if (pendingEventIds.has(key) || this.sub(this.events, rentalId).has(event.id)) {
            throw new DomainError("EVENT_EXISTS", `event ${event.id} already exists on rental ${rentalId}`);
          }
          pendingEventIds.add(key);
          write(() => this.sub(this.events, rentalId).set(event.id, clone(event)));
        },
      };

      const result = await fn(tx);
      for (const apply of writes) apply(); // commit atomically: only after fn resolves
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
