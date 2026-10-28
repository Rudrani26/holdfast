/**
 * Repo contract tests, shared by the MemoryRepo unit test and the opt-in Firestore integration test.
 * `makeRepo` must return an empty, isolated repo for each call.
 */
import { describe, expect, it } from "vitest";
import { DomainError, type Item, type Rental, type SettlementRecord, type TimelineEvent } from "@/domain/types";
import type { Repo } from "./types";

const T = (s: number) => `2026-10-28T10:00:${String(s).padStart(2, "0")}.000Z`;

export const sampleRental = (id: string, over: Partial<Rental> = {}): Rental => ({
  id,
  itemId: "headphones",
  renter: { name: "Demo Renter", email: "renter@example.com" },
  days: 2,
  depositCents: 20000,
  status: "DRAFT",
  paymentState: "NONE",
  paypal: { captures: [], refunds: [] },
  settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
  contestRound: 0,
  createdAt: T(0),
  updatedAt: T(0),
  version: 1,
  ...over,
});

const item = (id: string, active = true): Item => ({
  id,
  name: id,
  description: "",
  imagePath: `items/${id}.jpg`,
  depositCents: 20000,
  dailyRateCents: 1500,
  priceListId: "demo",
  angles: [{ id: "front", label: "Front", hint: "Whole item" }],
  active,
});

const event = (id: string, at: string): TimelineEvent => ({ id, at, actor: "SYSTEM", type: "TEST", summary: id, data: {} });

const settlement = (key: string): SettlementRecord => ({
  idempotencyKey: key,
  rentalId: "r1",
  op: "CAPTURE",
  amountCents: 3800,
  requestId: key,
  status: "PENDING",
  attempts: 1,
  createdAt: T(1),
  updatedAt: T(1),
});

export function describeRepoContract(name: string, makeRepo: () => Repo | Promise<Repo>) {
  describe(`Repo contract: ${name}`, () => {
    it("items and price lists round-trip; missing → undefined", async () => {
      const repo = await makeRepo();
      await repo.putItem(item("a"));
      await repo.putItem(item("b", false));
      expect(await repo.getItem("a")).toEqual(item("a"));
      expect(await repo.getItem("zzz")).toBeUndefined();
      expect((await repo.listItems()).map((i) => i.id).sort()).toEqual(["a", "b"]);
      expect((await repo.listItems({ activeOnly: true })).map((i) => i.id)).toEqual(["a"]);
      const pl = { id: "demo", name: "Demo", currency: "USD" as const, rules: [] };
      await repo.putPriceList(pl);
      expect(await repo.getPriceList("demo")).toEqual(pl);
    });

    it("createRental refuses an existing id; returned objects are copies", async () => {
      const repo = await makeRepo();
      await repo.createRental(sampleRental("r1"));
      await expect(repo.createRental(sampleRental("r1"))).rejects.toMatchObject({ code: "RENTAL_EXISTS" });
      const got = await repo.getRental("r1");
      got!.status = "SETTLED";
      expect((await repo.getRental("r1"))?.status).toBe("DRAFT");
    });

    it("listRentals: newest updatedAt first, status filter, limit", async () => {
      const repo = await makeRepo();
      await repo.createRental(sampleRental("old", { updatedAt: T(1), status: "AUTHORIZED" }));
      await repo.createRental(sampleRental("new", { updatedAt: T(3), status: "AUTHORIZED" }));
      await repo.createRental(sampleRental("mid", { updatedAt: T(2), status: "SETTLED" }));
      expect((await repo.listRentals()).map((r) => r.id)).toEqual(["new", "mid", "old"]);
      expect((await repo.listRentals({ status: "AUTHORIZED" })).map((r) => r.id)).toEqual(["new", "old"]);
      expect((await repo.listRentals({ limit: 1 })).map((r) => r.id)).toEqual(["new"]);
    });

    it("photos: one per (phase, angle), filterable by phase", async () => {
      const repo = await makeRepo();
      const photo = (phase: "CHECKOUT" | "CHECKIN", sha256: string) => ({
        id: `${phase}_front`,
        phase,
        angleId: "front",
        gcsPath: `rentals/r1/${phase}/front.jpg`,
        sha256,
        width: 1600,
        height: 1200,
        provenance: "LIVE_CAPTURE" as const,
        createdAt: T(1),
      });
      await repo.putPhoto("r1", photo("CHECKOUT", "aaa"));
      await repo.putPhoto("r1", photo("CHECKOUT", "bbb")); // retake replaces
      await repo.putPhoto("r1", photo("CHECKIN", "ccc"));
      expect((await repo.listPhotos("r1", "CHECKOUT")).map((p) => p.sha256)).toEqual(["bbb"]);
      expect(await repo.listPhotos("r1")).toHaveLength(2);
      expect(await repo.listPhotos("other")).toEqual([]);
    });

    it("inspections (oldest first) and line items round-trip", async () => {
      const repo = await makeRepo();
      const insp = (id: string, createdAt: string) => ({
        id,
        kind: "RETURN" as const,
        model: "gemini-3.7-flash",
        promptVersion: "hf-insp-v1",
        mode: "LIVE" as const,
        status: "OK" as const,
        perAngle: [],
        createdAt,
      });
      await repo.putInspection("r1", insp("i2", T(5)));
      await repo.putInspection("r1", insp("i1", T(2)));
      expect((await repo.listInspections("r1")).map((i) => i.id)).toEqual(["i1", "i2"]);
      expect((await repo.getInspection("r1", "i2"))?.createdAt).toBe(T(5));

      const line = {
        id: "l1",
        source: "AI" as const,
        angleId: "front",
        damageType: "CRACK" as const,
        severity: "MODERATE" as const,
        label: "Crack repair",
        amountCents: 4500,
        staffDecision: "INCLUDED" as const,
        round: 0,
      };
      await repo.putLineItem("r1", line);
      await repo.putLineItem("r1", { ...line, staffDecision: "EXCLUDED" });
      expect(await repo.getLineItem("r1", "l1")).toMatchObject({ staffDecision: "EXCLUDED" });
      expect(await repo.listLineItems("r1")).toHaveLength(1);
    });

    it("transactions commit rental, settlement, webhook, AI usage and events together", async () => {
      const repo = await makeRepo();
      await repo.createRental(sampleRental("r1"));
      await repo.runTransaction(async (tx) => {
        const r = await tx.getRental("r1");
        expect(await tx.getAiUsage("2026-10-28")).toBe(0);
        tx.putRental({ ...r!, status: "AWAITING_PAYMENT", version: r!.version + 1 });
        tx.putSettlement(settlement("settle:r1:1:capture"));
        tx.putWebhookEvent({ paypalEventId: "WH-1", eventType: "X", resourceId: "R", verified: true, receivedAt: T(2) });
        tx.setAiUsage("2026-10-28", 1);
        tx.addEvent("r1", event("e2", T(2)));
        tx.addEvent("r1", event("e1", T(2)));
        tx.addEvent("r1", event("e0", T(9)));
      });
      expect((await repo.getRental("r1"))?.status).toBe("AWAITING_PAYMENT");
      expect((await repo.getSettlement("settle:r1:1:capture"))?.status).toBe("PENDING");
      expect(await repo.listSettlements("r1")).toHaveLength(1);
      expect((await repo.getWebhookEvent("WH-1"))?.verified).toBe(true);
      expect(await repo.runTransaction((tx) => tx.getAiUsage("2026-10-28"))).toBe(1);
      // chronological by `at`, ties broken by id
      expect((await repo.listEvents("r1")).map((e) => e.id)).toEqual(["e1", "e2", "e0"]);
    });

    it("a failing transaction writes nothing", async () => {
      const repo = await makeRepo();
      await repo.createRental(sampleRental("r1"));
      await expect(
        repo.runTransaction(async (tx) => {
          await tx.getRental("r1");
          tx.putRental(sampleRental("r1", { status: "CANCELLED" }));
          tx.addEvent("r1", event("e1", T(1)));
          throw new DomainError("BOOM", "abort");
        }),
      ).rejects.toMatchObject({ code: "BOOM" });
      expect((await repo.getRental("r1"))?.status).toBe("DRAFT");
      expect(await repo.listEvents("r1")).toEqual([]);
    });

    it("events are append-only: a duplicate id fails the whole transaction", async () => {
      const repo = await makeRepo();
      await repo.createRental(sampleRental("r1"));
      await repo.runTransaction(async (tx) => tx.addEvent("r1", event("e1", T(1))));
      await expect(
        repo.runTransaction(async (tx) => {
          tx.putRental(sampleRental("r1", { status: "CANCELLED" }));
          tx.addEvent("r1", event("e1", T(5)));
        }),
      ).rejects.toMatchObject({ code: "EVENT_EXISTS" });
      expect((await repo.getRental("r1"))?.status).toBe("DRAFT");
      expect((await repo.listEvents("r1")).map((e) => e.at)).toEqual([T(1)]);
    });

    it("reads after writes are rejected (Firestore transaction rule)", async () => {
      const repo = await makeRepo();
      await expect(
        repo.runTransaction(async (tx) => {
          tx.setAiUsage("2026-10-28", 1);
          await tx.getRental("r1");
        }),
      ).rejects.toThrow();
    });

    it("settlement lock: concurrent attempts create exactly one record", async () => {
      const repo = await makeRepo();
      const key = "settle:r1:1:capture";
      const attempt = () =>
        repo.runTransaction(async (tx) => {
          if (await tx.getSettlement(key)) return "already-locked";
          tx.putSettlement(settlement(key));
          return "locked";
        });
      const results = await Promise.all([attempt(), attempt(), attempt()]);
      expect(results.filter((r) => r === "locked")).toHaveLength(1);
      expect(results.filter((r) => r === "already-locked")).toHaveLength(2);
    });

    it("webhook dedupe and AI usage counting hold under concurrency", async () => {
      const repo = await makeRepo();
      const seen = await Promise.all(
        [1, 2].map(() =>
          repo.runTransaction(async (tx) => {
            if (await tx.getWebhookEvent("WH-9")) return "duplicate";
            tx.putWebhookEvent({ paypalEventId: "WH-9", eventType: "X", resourceId: "R", verified: true, receivedAt: T(1) });
            return "processed";
          }),
        ),
      );
      expect(seen.sort()).toEqual(["duplicate", "processed"]);

      await Promise.all(
        Array.from({ length: 5 }, () =>
          repo.runTransaction(async (tx) => tx.setAiUsage("d", (await tx.getAiUsage("d")) + 1)),
        ),
      );
      expect(await repo.runTransaction((tx) => tx.getAiUsage("d"))).toBe(5);
    });
  });
}
