import { describe, expect, it } from "vitest";
import { SETTLEMENT_MODES, type SettlementMode } from "@/domain/types";
import { authorizedCopy, CAPTURE_PENDING_COPY, RELEASE_EVIDENCE, settledCopy } from "./settlementCopy";

const H = 20000;
const proven: Record<SettlementMode, boolean> = {
  PARTIAL_CAPTURE_THEN_VOID: true,
  PARTIAL_CAPTURE_FINAL: true,
  CAPTURE_THEN_REFUND: true,
};

describe("evidence flags", () => {
  it("are all off until the E8 buyer-view check proves a release", () => {
    expect(Object.values(RELEASE_EVIDENCE).every((v) => v === false)).toBe(true);
  });
});

describe("settledCopy — every mode × D ∈ {0, 3800, 20000}", () => {
  const table: [SettlementMode, number, string][] = [
    ["PARTIAL_CAPTURE_THEN_VOID", 0, "$0 charged · deposit authorization voided"],
    ["PARTIAL_CAPTURE_THEN_VOID", 3800, "$38.00 captured · remaining $162.00 authorization voided"],
    ["PARTIAL_CAPTURE_THEN_VOID", 20000, "$200.00 captured (full deposit)"],
    ["PARTIAL_CAPTURE_FINAL", 0, "$0 charged · deposit authorization voided"],
    ["PARTIAL_CAPTURE_FINAL", 3800, "$38.00 captured as final capture"],
    ["PARTIAL_CAPTURE_FINAL", 20000, "$200.00 captured (full deposit)"],
    ["CAPTURE_THEN_REFUND", 0, "$0 charged · deposit authorization voided"],
    ["CAPTURE_THEN_REFUND", 3800, "$200.00 captured · $162.00 refunded"],
    ["CAPTURE_THEN_REFUND", 20000, "$200.00 captured (full deposit)"],
  ];

  it.each(table)("%s, D=%i → %s", (mode, d, expected) => {
    expect(settledCopy({ mode, depositCents: H, deductionCents: d })).toBe(expected);
  });

  it("clean return gets the 'No new damage detected' prefix", () => {
    expect(settledCopy({ mode: "PARTIAL_CAPTURE_THEN_VOID", depositCents: H, deductionCents: 0, cleanReturn: true })).toBe(
      "No new damage detected · $0 charged · deposit authorization voided",
    );
  });
});

describe("wording rules (PAYPAL_INTEGRATION.md §9)", () => {
  const allCopies = (evidence = RELEASE_EVIDENCE) =>
    SETTLEMENT_MODES.flatMap((mode) =>
      [0, 1, 3800, 19999, H].flatMap((d) =>
        [false, true].map((cleanReturn) => ({
          mode,
          d,
          text: settledCopy({ mode, depositCents: H, deductionCents: d, cleanReturn, evidence }),
        })),
      ),
    );

  it("never says 'released' without evidence", () => {
    for (const c of allCopies()) expect(c.text, `${c.mode} D=${c.d}`).not.toMatch(/releas/i);
  });

  it("never calls a void a refund", () => {
    const voidPaths = allCopies().filter((c) => c.d === 0 || c.mode === "PARTIAL_CAPTURE_THEN_VOID");
    for (const c of voidPaths) expect(c.text, `${c.mode} D=${c.d}`).not.toMatch(/refund/i);
  });

  it("only the refund fallback mentions a refund, and never 'hold released'", () => {
    for (const c of allCopies(proven)) {
      if (/refund/i.test(c.text)) expect(c.mode).toBe("CAPTURE_THEN_REFUND");
      if (c.mode === "CAPTURE_THEN_REFUND") expect(c.text).not.toMatch(/hold released/i);
    }
  });

  it("with proven evidence, release wording becomes allowed", () => {
    expect(settledCopy({ mode: "PARTIAL_CAPTURE_THEN_VOID", depositCents: H, deductionCents: 3800, evidence: proven })).toBe(
      "$38.00 captured · remaining $162.00 released",
    );
    expect(
      settledCopy({ mode: "PARTIAL_CAPTURE_THEN_VOID", depositCents: H, deductionCents: 0, cleanReturn: true, evidence: proven }),
    ).toBe("No new damage detected · $0 charged · full deposit released");
  });

  it("authorized and pending wording never claims a charge or completion", () => {
    expect(authorizedCopy(H)).toBe("$200.00 deposit authorized (hold, not a charge)");
    expect(authorizedCopy(H)).not.toMatch(/charged|paid/i);
    expect(CAPTURE_PENDING_COPY).not.toMatch(/complete/i);
  });
});
