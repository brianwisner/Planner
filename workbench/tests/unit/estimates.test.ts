import { describe, it, expect } from "vitest";
import { recommendEstimate, type CompletedProject } from "@/lib/engine/estimates";

const hist = (o: Partial<CompletedProject>): CompletedProject => ({ id: 1, name: "H", projectTypeId: 1, complexity: "medium", originalEstimatedHours: 10, actualHours: 12, scopeChangeHours: 0, feeAmount: 1500, feeType: "fixed", actualCompletion: "2026-06-01", ...o });

describe("estimate recommendation", () => {
  it("is honest with no history and no template", () => {
    const r = recommendEstimate({ projectTypeId: 1, complexity: "medium" }, [], null, 150);
    expect(r.basis).toBe("none");
    expect(r.hours).toBeNull();
    expect(r.comparableCount).toBe(0);
  });
  it("falls back to template defaults and says so", () => {
    const r = recommendEstimate({ projectTypeId: 1, complexity: "medium", typeName: "Deck" }, [], { defaultHours: 7, defaultFee: 1050, defaultFeeType: "fixed" }, 150);
    expect(r.basis).toBe("template");
    expect(r.evidence).toBe("none");
    expect(r.hours?.mid).toBe(7);
    expect(r.assumptions[0]).toMatch(/not a data-driven/);
  });
  it("uses only same-type comparables, removes added scope, and reports accuracy", () => {
    const history = [
      hist({ id: 1, actualHours: 12, originalEstimatedHours: 10 }),
      hist({ id: 2, actualHours: 15, scopeChangeHours: 5, originalEstimatedHours: 10 }), // original scope 10
      hist({ id: 3, projectTypeId: 2, actualHours: 100 }),
    ];
    const r = recommendEstimate({ projectTypeId: 1, complexity: "medium" }, history, null, 150);
    expect(r.basis).toBe("history");
    expect(r.comparableCount).toBe(2);
    expect(r.evidence).toBe("weak");
    expect(r.hours).toEqual({ low: 10, mid: 11, high: 12 });
    expect(r.accuracy.averageRatio).toBe(1.1);
    expect(r.comparables[1].differences[0]).toMatch(/added scope/);
  });
  it("adjusts for complexity differences and labels it", () => {
    const r = recommendEstimate({ projectTypeId: 1, complexity: "high" }, [hist({ actualHours: 10, complexity: "medium" })], null, 150);
    expect(r.hours?.mid).toBe(12);
    expect(r.comparables[0].differences[0]).toMatch(/Complexity/);
  });
  it("evidence strength grows with count", () => {
    const many = Array.from({ length: 6 }, (_, i) => hist({ id: i + 1 }));
    expect(recommendEstimate({ projectTypeId: 1, complexity: "medium" }, many, null, 150).evidence).toBe("strong");
  });
});
