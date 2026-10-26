import { db } from "@/lib/db";
import { availabilityRules, billingRates, projectTypes, schedulingPrefs, settings } from "@/lib/db/schema";

/** Default configuration for a structural engineering practice. Editable in Settings. */
export const DEFAULT_PROJECT_TYPES = [
  {
    name: "Residential addition / remodel",
    description: "Structural design for additions, remodels, and bearing-wall removals.",
    defaultScope: "Gravity and lateral design for the altered portion of the structure, framing plans, details, and calculations for permit.",
    defaultTasks: [
      { phase: "Design", name: "Site visit and existing conditions", hours: 2 },
      { phase: "Design", name: "Gravity design", hours: 4 },
      { phase: "Design", name: "Lateral design", hours: 4 },
      { phase: "Drawings", name: "Framing plans and details", hours: 6 },
      { phase: "Submittal", name: "Calculation package and permit response", hours: 2 },
    ],
    defaultFeeType: "fixed" as const,
    defaultHours: "18",
    defaultFee: "2700",
  },
  {
    name: "New single-family residence",
    description: "Complete structural design for a new house.",
    defaultScope: "Foundation, gravity, and lateral design; structural plans, details, and calculations for permit.",
    defaultTasks: [
      { phase: "Design", name: "Loads and framing layout", hours: 6 },
      { phase: "Design", name: "Gravity design", hours: 8 },
      { phase: "Design", name: "Lateral design", hours: 10 },
      { phase: "Design", name: "Foundation design", hours: 6 },
      { phase: "Drawings", name: "Structural drawings", hours: 16 },
      { phase: "Submittal", name: "Calculations and permit response", hours: 4 },
    ],
    defaultFeeType: "fixed" as const,
    defaultHours: "50",
    defaultFee: "7500",
  },
  {
    name: "Accessory dwelling unit (ADU)",
    defaultScope: "Foundation, gravity, and lateral design for a detached or attached ADU.",
    defaultTasks: [
      { phase: "Design", name: "Gravity and foundation design", hours: 6 },
      { phase: "Design", name: "Lateral design", hours: 6 },
      { phase: "Drawings", name: "Structural drawings", hours: 10 },
      { phase: "Submittal", name: "Calculations and permit response", hours: 3 },
    ],
    defaultFeeType: "fixed" as const,
    defaultHours: "25",
    defaultFee: "3750",
  },
  {
    name: "Deck / porch / cover",
    defaultScope: "Gravity and lateral design for an exterior deck, porch, or roof cover with details for permit.",
    defaultTasks: [
      { phase: "Design", name: "Design", hours: 3 },
      { phase: "Drawings", name: "Plan and details", hours: 3 },
      { phase: "Submittal", name: "Calculations", hours: 1 },
    ],
    defaultFeeType: "fixed" as const,
    defaultHours: "7",
    defaultFee: "1050",
  },
  {
    name: "Retaining wall",
    defaultScope: "Design of a site retaining wall including stability checks and reinforcing details.",
    defaultTasks: [
      { phase: "Design", name: "Wall design and stability", hours: 4 },
      { phase: "Drawings", name: "Details", hours: 2 },
      { phase: "Submittal", name: "Calculations", hours: 1 },
    ],
    defaultFeeType: "fixed" as const,
    defaultHours: "7",
    defaultFee: "1050",
  },
  {
    name: "Seismic retrofit",
    defaultScope: "Evaluation and retrofit design for an existing structure.",
    defaultTasks: [
      { phase: "Design", name: "Site visit and evaluation", hours: 3 },
      { phase: "Design", name: "Retrofit design", hours: 6 },
      { phase: "Drawings", name: "Drawings and details", hours: 6 },
    ],
    defaultFeeType: "fixed" as const,
    defaultHours: "15",
    defaultFee: "2250",
  },
  {
    name: "Foundation repair / underpinning",
    defaultScope: "Assessment and repair design for settled or damaged foundations.",
    defaultTasks: [
      { phase: "Design", name: "Site visit and assessment", hours: 3 },
      { phase: "Design", name: "Repair design", hours: 5 },
      { phase: "Drawings", name: "Details", hours: 4 },
    ],
    defaultFeeType: "fixed" as const,
    defaultHours: "12",
    defaultFee: "1800",
  },
  {
    name: "Commercial tenant improvement",
    defaultScope: "Structural design for tenant improvements, openings, and equipment support.",
    defaultTasks: [
      { phase: "Design", name: "Design", hours: 8 },
      { phase: "Drawings", name: "Drawings", hours: 8 },
      { phase: "Submittal", name: "Calculations and review response", hours: 4 },
    ],
    defaultFeeType: "hourly" as const,
    defaultHours: "20",
  },
  {
    name: "Site observation / letter",
    defaultScope: "Site visit with a brief observation letter.",
    defaultTasks: [
      { phase: "Field", name: "Site visit", hours: 2 },
      { phase: "Report", name: "Letter", hours: 1.5 },
    ],
    defaultFeeType: "hourly" as const,
    defaultHours: "3.5",
  },
  {
    name: "Inspection / forensic report",
    defaultScope: "Investigation of a structural condition with a written report.",
    defaultTasks: [
      { phase: "Field", name: "Site investigation", hours: 4 },
      { phase: "Report", name: "Analysis and report", hours: 6 },
    ],
    defaultFeeType: "hourly" as const,
    defaultHours: "10",
  },
  {
    name: "Peer review / plan check",
    defaultScope: "Review of structural drawings and calculations prepared by others.",
    defaultTasks: [{ phase: "Review", name: "Review and comments", hours: 6 }],
    defaultFeeType: "hourly" as const,
    defaultHours: "6",
  },
  {
    name: "Other",
    defaultTasks: [],
    defaultFeeType: "hourly" as const,
  },
];

export async function seedDefaults(ownerId: number) {
  const existing = await db.select({ id: projectTypes.id }).from(projectTypes).limit(1);
  if (existing.length === 0) {
    await db.insert(projectTypes).values(DEFAULT_PROJECT_TYPES.map((t, i) => ({ ...t, sortOrder: i })));
  }
  const rates = await db.select({ id: billingRates.id }).from(billingRates).limit(1);
  if (rates.length === 0) {
    await db.insert(billingRates).values([
      { name: "Principal engineer", rate: "150", isDefault: true },
      { name: "Drafting / admin", rate: "85" },
    ]);
  }
  // Monday–Friday 8:00–5:00 with a 60 minute break.
  await db
    .insert(availabilityRules)
    .values([1, 2, 3, 4, 5].map((weekday) => ({ userId: ownerId, weekday, startMinute: 8 * 60, endMinute: 17 * 60, breakMinutes: 60 })))
    .onConflictDoNothing();
  await db.insert(schedulingPrefs).values({ userId: ownerId }).onConflictDoNothing();
  await db
    .insert(settings)
    .values({ key: "practice", value: { name: "Wisner Engineering, LLC", city: "Astoria, Oregon", timezone: "America/Los_Angeles" } })
    .onConflictDoNothing();
}
