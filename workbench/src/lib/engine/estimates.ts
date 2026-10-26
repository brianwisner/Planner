export type CompletedProject = {
  id: number;
  name: string;
  projectTypeId: number | null;
  complexity: "low" | "medium" | "high";
  originalEstimatedHours: number | null; // from the approved original-scope estimate
  actualHours: number;
  scopeChangeHours: number; // hours attributable to added scope
  feeAmount: number | null;
  feeType: "hourly" | "fixed" | null;
  actualCompletion: string | null;
};

export type EstimateRecommendation = {
  basis: "none" | "template" | "history";
  evidence: "none" | "weak" | "moderate" | "strong";
  comparableCount: number;
  comparables: {
    id: number;
    name: string;
    complexity: string;
    estimatedHours: number | null;
    actualHours: number;
    originalScopeHours: number;
    feeAmount: number | null;
    completed: string | null;
    differences: string[];
  }[];
  hours: { low: number; mid: number; high: number } | null;
  fee: { low: number; mid: number; high: number } | null;
  accuracy: { averageRatio: number | null; note: string }; // actual / estimated
  assumptions: string[];
  message: string;
};

const COMPLEXITY_FACTOR = { low: 0.85, medium: 1, high: 1.2 } as const;
const r1 = (n: number) => Math.round(n * 10) / 10;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function recommendEstimate(
  target: { projectTypeId: number | null; complexity: "low" | "medium" | "high"; typeName?: string | null },
  history: CompletedProject[],
  template: { defaultHours: number | null; defaultFee: number | null; defaultFeeType: "hourly" | "fixed" | null } | null,
  hourlyRate: number,
): EstimateRecommendation {
  const comps = history.filter((h) => h.projectTypeId != null && h.projectTypeId === target.projectTypeId && h.actualHours > 0);
  const assumptions: string[] = [];

  if (comps.length === 0) {
    if (template && (template.defaultHours || template.defaultFee)) {
      assumptions.push("No completed projects of this type have actual hours yet. These numbers are the project-type template defaults, not a data-driven recommendation.");
      const h = template.defaultHours ?? 0;
      const fee = template.defaultFee ?? (h ? h * hourlyRate : 0);
      return {
        basis: "template",
        evidence: "none",
        comparableCount: 0,
        comparables: [],
        hours: h ? { low: h, mid: h, high: h } : null,
        fee: fee ? { low: fee, mid: fee, high: fee } : null,
        accuracy: { averageRatio: null, note: "No history to compare estimates with actuals." },
        assumptions,
        message: `Template default for ${target.typeName ?? "this project type"}. Adjust it with your own judgment.`,
      };
    }
    return {
      basis: "none",
      evidence: "none",
      comparableCount: 0,
      comparables: [],
      hours: null,
      fee: null,
      accuracy: { averageRatio: null, note: "No history yet." },
      assumptions: ["No completed projects of this type and no template defaults. Enter the estimate manually."],
      message: "No basis for a recommendation yet. As completed projects accumulate, suggestions will appear here.",
    };
  }

  const rows = comps.map((c) => {
    const originalScopeHours = Math.max(0.5, c.actualHours - c.scopeChangeHours);
    const factor = COMPLEXITY_FACTOR[target.complexity] / COMPLEXITY_FACTOR[c.complexity];
    const differences: string[] = [];
    if (c.complexity !== target.complexity) differences.push(`Complexity ${c.complexity} vs ${target.complexity} (adjusted ×${factor.toFixed(2)})`);
    if (c.scopeChangeHours > 0) differences.push(`${r1(c.scopeChangeHours)} h of added scope excluded`);
    return { c, originalScopeHours, adjusted: originalScopeHours * factor, differences };
  });
  const adj = rows.map((r) => r.adjusted);
  const hours = { low: r1(Math.min(...adj)), mid: r1(median(adj)), high: r1(Math.max(...adj)) };
  const fees = rows.filter((r) => r.c.feeAmount != null).map((r) => r.c.feeAmount!);
  const fee = fees.length
    ? { low: Math.round(Math.min(...fees)), mid: Math.round(median(fees)), high: Math.round(Math.max(...fees)) }
    : { low: Math.round(hours.low * hourlyRate), mid: Math.round(hours.mid * hourlyRate), high: Math.round(hours.high * hourlyRate) };
  const withEst = rows.filter((r) => r.c.originalEstimatedHours && r.c.originalEstimatedHours > 0);
  const ratios = withEst.map((r) => r.originalScopeHours / r.c.originalEstimatedHours!);
  const averageRatio = ratios.length ? Math.round((ratios.reduce((s, x) => s + x, 0) / ratios.length) * 100) / 100 : null;
  const evidence = comps.length >= 6 ? "strong" : comps.length >= 3 ? "moderate" : "weak";
  if (rows.some((r) => r.differences.length)) assumptions.push("Complexity differences are adjusted with a simple factor (low ×0.85, medium ×1, high ×1.2). Treat this as a rough guide.");
  if (!fees.length) assumptions.push(`Fee range is hours × the default rate ($${hourlyRate}/h) because comparable projects have no recorded fee.`);
  assumptions.push("Added-scope hours are removed from comparables so the range reflects original scope only.");
  if (evidence === "weak") assumptions.push("Fewer than three comparable projects: the range is indicative only.");
  return {
    basis: "history",
    evidence,
    comparableCount: comps.length,
    comparables: rows.map((r) => ({
      id: r.c.id,
      name: r.c.name,
      complexity: r.c.complexity,
      estimatedHours: r.c.originalEstimatedHours,
      actualHours: r1(r.c.actualHours),
      originalScopeHours: r1(r.originalScopeHours),
      feeAmount: r.c.feeAmount,
      completed: r.c.actualCompletion,
      differences: r.differences,
    })),
    hours,
    fee,
    accuracy: {
      averageRatio,
      note:
        averageRatio == null
          ? "Comparable projects have no approved original estimate to compare against."
          : averageRatio > 1.1
            ? `On average, actual hours ran ${Math.round((averageRatio - 1) * 100)}% over the original estimate for this type.`
            : averageRatio < 0.9
              ? `On average, actual hours came in ${Math.round((1 - averageRatio) * 100)}% under the original estimate for this type.`
              : "Original estimates for this type have been close to actual hours.",
    },
    assumptions,
    message: `${comps.length} comparable completed project${comps.length === 1 ? "" : "s"} (${evidence} evidence).`,
  };
}
