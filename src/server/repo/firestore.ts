import "server-only";
import {
  FieldPath,
  Firestore,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Query,
} from "@google-cloud/firestore";
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
import { aiUsageDocId, COLLECTIONS, photoDocId, SUBCOLLECTIONS, type Repo, type Tx } from "./types";

// gRPC status ALREADY_EXISTS, returned by create() when the document exists.
const ALREADY_EXISTS = 6;
const isAlreadyExists = (e: unknown) => (e as { code?: unknown } | null)?.code === ALREADY_EXISTS;

/**
 * Firestore-backed Repo. Documents hold the domain objects as-is (times are ISO-8601 UTC strings,
 * which sort correctly as strings). Top-level collections carry FIRESTORE_COLLECTION_PREFIX;
 * rental subcollections (photos, inspections, lineItems, events) live under the rental document.
 */
export class FirestoreRepo implements Repo {
  private readonly db: Firestore;
  private readonly prefix: string;

  constructor(opts: { projectId?: string; prefix?: string; firestore?: Firestore }) {
    this.db = opts.firestore ?? new Firestore({ projectId: opts.projectId, ignoreUndefinedProperties: true });
    this.prefix = opts.prefix ?? "";
  }

  private col(name: keyof typeof COLLECTIONS): CollectionReference<DocumentData> {
    return this.db.collection(`${this.prefix}${COLLECTIONS[name]}`);
  }
  private sub(rentalId: string, name: keyof typeof SUBCOLLECTIONS): CollectionReference<DocumentData> {
    return this.col("rentals").doc(rentalId).collection(SUBCOLLECTIONS[name]);
  }
  private async one<T>(ref: DocumentReference): Promise<T | undefined> {
    const snap = await ref.get();
    return snap.exists ? (snap.data() as T) : undefined;
  }
  private async all<T>(query: Query): Promise<T[]> {
    return (await query.get()).docs.map((d) => d.data() as T);
  }

  getItem(id: string) {
    return this.one<Item>(this.col("items").doc(id));
  }
  listItems(opts: { activeOnly?: boolean } = {}) {
    const c = this.col("items");
    return this.all<Item>(opts.activeOnly ? c.where("active", "==", true) : c);
  }
  async putItem(item: Item) {
    await this.col("items").doc(item.id).set(item);
  }

  getPriceList(id: string) {
    return this.one<PriceList>(this.col("priceLists").doc(id));
  }
  async putPriceList(priceList: PriceList) {
    await this.col("priceLists").doc(priceList.id).set(priceList);
  }

  getRental(id: string) {
    return this.one<Rental>(this.col("rentals").doc(id));
  }
  listRentals(opts: { status?: RentalStatus; limit?: number } = {}) {
    let q: Query = this.col("rentals");
    if (opts.status) q = q.where("status", "==", opts.status); // needs index: status + updatedAt desc
    q = q.orderBy("updatedAt", "desc");
    if (opts.limit) q = q.limit(opts.limit);
    return this.all<Rental>(q);
  }
  async createRental(rental: Rental) {
    try {
      await this.col("rentals").doc(rental.id).create(rental);
    } catch (e) {
      if (isAlreadyExists(e)) throw new DomainError("RENTAL_EXISTS", `rental ${rental.id} exists`);
      throw e;
    }
  }

  async putPhoto(rentalId: string, photo: Photo) {
    await this.sub(rentalId, "photos").doc(photoDocId(photo)).set(photo);
  }
  listPhotos(rentalId: string, phase?: PhotoPhase) {
    const c = this.sub(rentalId, "photos");
    return this.all<Photo>(phase ? c.where("phase", "==", phase) : c);
  }

  async putInspection(rentalId: string, inspection: Inspection) {
    await this.sub(rentalId, "inspections").doc(inspection.id).set(inspection);
  }
  getInspection(rentalId: string, inspectionId: string) {
    return this.one<Inspection>(this.sub(rentalId, "inspections").doc(inspectionId));
  }
  listInspections(rentalId: string) {
    return this.all<Inspection>(this.sub(rentalId, "inspections").orderBy("createdAt"));
  }

  async putLineItem(rentalId: string, line: LineItem) {
    await this.sub(rentalId, "lineItems").doc(line.id).set(line);
  }
  getLineItem(rentalId: string, lineId: string) {
    return this.one<LineItem>(this.sub(rentalId, "lineItems").doc(lineId));
  }
  listLineItems(rentalId: string) {
    return this.all<LineItem>(this.sub(rentalId, "lineItems"));
  }

  listEvents(rentalId: string) {
    return this.all<TimelineEvent>(this.sub(rentalId, "events").orderBy("at").orderBy(FieldPath.documentId()));
  }

  getSettlement(key: string) {
    return this.one<SettlementRecord>(this.col("settlements").doc(key));
  }
  listSettlements(rentalId: string) {
    return this.all<SettlementRecord>(this.col("settlements").where("rentalId", "==", rentalId));
  }

  getWebhookEvent(id: string) {
    return this.one<WebhookEventRecord>(this.col("webhookEvents").doc(id));
  }

  async runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.runTransaction(async (t) => {
        const read = async <R>(ref: DocumentReference): Promise<R | undefined> => {
          const snap = await t.get(ref);
          return snap.exists ? (snap.data() as R) : undefined;
        };
        const tx: Tx = {
          getRental: (id) => read<Rental>(this.col("rentals").doc(id)),
          getSettlement: (key) => read<SettlementRecord>(this.col("settlements").doc(key)),
          getWebhookEvent: (id) => read<WebhookEventRecord>(this.col("webhookEvents").doc(id)),
          getAiUsage: async (day) =>
            (await read<{ calls: number }>(this.col("meta").doc(aiUsageDocId(day))))?.calls ?? 0,
          putRental: (r) => void t.set(this.col("rentals").doc(r.id), r),
          putSettlement: (s) => void t.set(this.col("settlements").doc(s.idempotencyKey), s),
          putWebhookEvent: (e) => void t.set(this.col("webhookEvents").doc(e.paypalEventId), e),
          setAiUsage: (day, calls) => void t.set(this.col("meta").doc(aiUsageDocId(day)), { calls }),
          addEvent: (rentalId, event) => void t.create(this.sub(rentalId, "events").doc(event.id), event),
        };
        return fn(tx);
      });
    } catch (e) {
      if (isAlreadyExists(e)) throw new DomainError("EVENT_EXISTS", "a timeline event with this id already exists");
      throw e;
    }
  }
}
