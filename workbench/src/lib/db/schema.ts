import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  numeric,
  uniqueIndex,
  index,
  serial,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------- Users, sessions, audit ----------

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role", { enum: ["owner", "staff"] }).notNull().default("staff"),
  passwordHash: text("password_hash").notNull(),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  userAgent: text("user_agent"),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(), // e.g. estimate.approve
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    details: jsonb("details"),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_at_idx").on(t.at)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Clients ----------

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  kind: text("kind", { enum: ["homeowner", "contractor", "architect", "developer", "agency", "other"] })
    .notNull()
    .default("other"),
  notes: text("notes"),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role"),
  email: text("email"),
  phone: text("phone"),
  isPrimary: boolean("is_primary").notNull().default(false),
});

// Notes, calls, meetings, and linked email messages for a client and/or project.
export const correspondence = pgTable(
  "correspondence",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["note", "email", "call", "meeting"] }).notNull().default("note"),
    subject: text("subject"),
    body: text("body"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    gmailMessageId: text("gmail_message_id"),
    gmailThreadId: text("gmail_thread_id"),
    linkUrl: text("link_url"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("corr_client_idx").on(t.clientId), index("corr_project_idx").on(t.projectId)],
);

// ---------- Project types (configurable, act as templates) ----------

export type TemplateTask = { name: string; phase?: string; hours: number };

export const projectTypes = pgTable("project_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  defaultScope: text("default_scope"),
  defaultTasks: jsonb("default_tasks").$type<TemplateTask[]>().notNull().default([]),
  defaultFeeType: text("default_fee_type", { enum: ["hourly", "fixed"] }).notNull().default("fixed"),
  defaultFee: numeric("default_fee", { precision: 12, scale: 2 }),
  defaultHours: numeric("default_hours", { precision: 8, scale: 2 }),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ---------- Projects ----------

export const PROJECT_STATUSES = [
  "inquiry", // opportunity, not committed
  "proposed", // estimate sent, awaiting client
  "accepted", // client accepted; committed workload, not started
  "in_progress",
  "on_hold",
  "completed",
  "declined",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const COMMITTED_STATUSES: ProjectStatus[] = ["accepted", "in_progress"];

export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    address: text("address"),
    projectTypeId: integer("project_type_id").references(() => projectTypes.id, { onDelete: "set null" }),
    scope: text("scope"),
    complexity: text("complexity", { enum: ["low", "medium", "high"] }).notNull().default("medium"),
    status: text("status", { enum: PROJECT_STATUSES }).notNull().default("inquiry"),
    priority: integer("priority").notNull().default(3), // 1 urgent, 2 high, 3 normal, 4 low
    tentativeReserve: boolean("tentative_reserve").notNull().default(false), // reserve capacity for an unaccepted opportunity
    inquiryDate: date("inquiry_date"),
    acceptanceDate: date("acceptance_date"),
    plannedStart: date("planned_start"),
    actualStart: date("actual_start"),
    targetCompletion: date("target_completion"), // internal target
    clientDueDate: date("client_due_date"), // commitment made to the client (distinct from forecast)
    actualCompletion: date("actual_completion"),
    estimatedHours: numeric("estimated_hours", { precision: 8, scale: 2 }), // from approved estimate or manual
    remainingHours: numeric("remaining_hours", { precision: 8, scale: 2 }), // manually maintained; null = derive
    feeType: text("fee_type", { enum: ["hourly", "fixed"] }),
    feeAmount: numeric("fee_amount", { precision: 12, scale: 2 }),
    hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }),
    notes: text("notes"),
    links: jsonb("links").$type<{ label: string; url: string }[]>().notNull().default([]),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("projects_client_idx").on(t.clientId), index("projects_status_idx").on(t.status)],
);

export const projectDependencies = pgTable(
  "project_dependencies",
  {
    projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    dependsOnId: integer("depends_on_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.dependsOnId] })],
);

export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phase: text("phase"),
    status: text("status", { enum: ["todo", "in_progress", "done"] }).notNull().default("todo"),
    isMilestone: boolean("is_milestone").notNull().default(false),
    dueDate: date("due_date"),
    estimatedHours: numeric("estimated_hours", { precision: 8, scale: 2 }),
    remainingHours: numeric("remaining_hours", { precision: 8, scale: 2 }),
    dependsOnTaskId: integer("depends_on_task_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tasks_project_idx").on(t.projectId)],
);

// Waiting items, blockers, and scope changes.
export const projectItems = pgTable(
  "project_items",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["waiting", "blocker", "scope_change"] }).notNull(),
    description: text("description").notNull(),
    status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
    hoursAdded: numeric("hours_added", { precision: 8, scale: 2 }),
    feeAdded: numeric("fee_added", { precision: 12, scale: 2 }),
    blocksScheduling: boolean("blocks_scheduling").notNull().default(false),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("items_project_idx").on(t.projectId)],
);

// ---------- Estimates ----------

export const billingRates = pgTable("billing_rates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 10, scale: 2 }).notNull(),
  active: boolean("active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
});

export const ESTIMATE_STATUSES = ["draft", "submitted", "approved", "rejected", "superseded"] as const;

export const estimates = pgTable(
  "estimates",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    supersedesId: integer("supersedes_id"),
    scopeKind: text("scope_kind", { enum: ["original", "added"] }).notNull().default("original"),
    status: text("status", { enum: ESTIMATE_STATUSES }).notNull().default("draft"),
    feeType: text("fee_type", { enum: ["hourly", "fixed"] }).notNull().default("fixed"),
    hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }),
    totalHours: numeric("total_hours", { precision: 8, scale: 2 }).notNull().default("0"),
    totalFee: numeric("total_fee", { precision: 12, scale: 2 }).notNull().default("0"),
    title: text("title"),
    assumptions: text("assumptions"),
    exclusions: text("exclusions"),
    notes: text("notes"),
    recommendation: jsonb("recommendation"), // snapshot of the comparable-projects recommendation when prepared
    preparedBy: integer("prepared_by").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("estimates_project_idx").on(t.projectId)],
);

export const estimateLines = pgTable("estimate_lines", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  phase: text("phase"),
  description: text("description").notNull(),
  hours: numeric("hours", { precision: 8, scale: 2 }).notNull().default("0"),
  rate: numeric("rate", { precision: 10, scale: 2 }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ---------- Time tracking ----------

export const timeEntries = pgTable(
  "time_entries",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
    entryDate: date("entry_date").notNull(), // local date in user's time zone
    startedAt: timestamp("started_at", { withTimezone: true }), // set for timer entries
    endedAt: timestamp("ended_at", { withTimezone: true }), // null while timer runs
    durationMinutes: integer("duration_minutes").notNull().default(0),
    notes: text("notes"),
    billable: boolean("billable").notNull().default(true),
    source: text("source", { enum: ["timer", "manual"] }).notNull().default("manual"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("time_user_date_idx").on(t.userId, t.entryDate),
    index("time_project_idx").on(t.projectId),
    // One running timer per user, enforced by the database.
    uniqueIndex("time_one_running_per_user")
      .on(t.userId)
      .where(sql`${t.endedAt} IS NULL AND ${t.startedAt} IS NOT NULL`),
  ],
);

// ---------- Availability & scheduling ----------

export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(), // 1=Mon ... 7=Sun (ISO)
    startMinute: integer("start_minute").notNull(), // minutes from midnight local
    endMinute: integer("end_minute").notNull(),
    breakMinutes: integer("break_minutes").notNull().default(0),
  },
  (t) => [uniqueIndex("avail_user_weekday").on(t.userId, t.weekday)],
);

export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    kind: text("kind", { enum: ["off", "custom"] }).notNull(),
    startMinute: integer("start_minute"),
    endMinute: integer("end_minute"),
    breakMinutes: integer("break_minutes"),
    note: text("note"),
  },
  (t) => [uniqueIndex("avail_exc_user_date").on(t.userId, t.date)],
);

export const schedulingPrefs = pgTable("scheduling_prefs", {
  userId: integer("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  bufferPercent: integer("buffer_percent").notNull().default(10),
  maxConcurrentProjects: integer("max_concurrent_projects").notNull().default(2),
  minBlockHours: numeric("min_block_hours", { precision: 4, scale: 2 }).notNull().default("1"),
  horizonDays: integer("horizon_days").notNull().default(42),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
});

// Approved schedule: day-level work blocks (hours) in an order, optionally pinned to a start time.
export const workBlocks = pgTable(
  "work_blocks",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    hours: numeric("hours", { precision: 5, scale: 2 }).notNull(),
    startMinute: integer("start_minute"), // set = fixed time commitment
    kind: text("kind", { enum: ["work", "commitment"] }).notNull().default("work"),
    title: text("title"), // for commitments without a project
    locked: boolean("locked").notNull().default(false),
    source: text("source", { enum: ["manual", "recommendation"] }).notNull().default("manual"),
    sortOrder: integer("sort_order").notNull().default(0),
    note: text("note"),
    googleEventId: text("google_event_id"),
    googleCalendarId: text("google_calendar_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("blocks_user_date_idx").on(t.userId, t.date)],
);

export type ProposalBlock = {
  projectId: number;
  date: string;
  hours: number;
  locked?: boolean;
  existingId?: number;
};
export type ProposalSummary = {
  horizonStart: string;
  horizonEnd: string;
  moves: { projectId: number; projectName: string; change: string; reason: string }[];
  forecasts: {
    projectId: number;
    projectName: string;
    forecastCompletion: string | null;
    previousForecast: string | null;
    clientDueDate: string | null;
    targetCompletion: string | null;
    atRisk: boolean;
    reason?: string;
  }[];
  warnings: string[];
  unscheduled: { projectId: number; projectName: string; reason: string }[];
};

export const scheduleProposals = pgTable("schedule_proposals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), // whose schedule
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  status: text("status", { enum: ["proposed", "accepted", "rejected", "superseded", "undone"] })
    .notNull()
    .default("proposed"),
  title: text("title").notNull(),
  params: jsonb("params"),
  blocks: jsonb("blocks").$type<ProposalBlock[]>().notNull(),
  summary: jsonb("summary").$type<ProposalSummary>().notNull(),
  undoSnapshot: jsonb("undo_snapshot"), // blocks replaced when accepted, for undo
  decidedBy: integer("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScenarioOverrides = {
  projects?: Record<
    string,
    { priority?: number; remainingHours?: number; clientDueDate?: string | null; include?: boolean; status?: string }
  >;
  capacity?: { bufferPercent?: number; maxConcurrentProjects?: number; extraHoursPerDay?: number };
  horizonDays?: number;
};

export const scenarios = pgTable("scenarios", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  overrides: jsonb("overrides").$type<ScenarioOverrides>().notNull().default({}),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Google integration ----------

export const googleAccounts = pgTable("google_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  googleEmail: text("google_email"),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  scopes: text("scopes").notNull().default(""),
  status: text("status", { enum: ["connected", "error", "disconnected"] }).notNull().default("disconnected"),
  lastError: text("last_error"),
  writebackCalendarId: text("writeback_calendar_id"), // null = write-back disabled
  gmailLastScanAt: timestamp("gmail_last_scan_at", { withTimezone: true }),
  gmailLastError: text("gmail_last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const calendars = pgTable(
  "calendars",
  {
    id: serial("id").primaryKey(),
    googleAccountId: integer("google_account_id").notNull().references(() => googleAccounts.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id").notNull(),
    summary: text("summary").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    accessRole: text("access_role"),
    affectsAvailability: boolean("affects_availability").notNull().default(false),
    syncToken: text("sync_token"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (t) => [uniqueIndex("calendars_account_gid").on(t.googleAccountId, t.googleCalendarId)],
);

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: serial("id").primaryKey(),
    calendarId: integer("calendar_id").notNull().references(() => calendars.id, { onDelete: "cascade" }),
    googleEventId: text("google_event_id").notNull(),
    summary: text("summary"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    busy: boolean("busy").notNull().default(true), // false when Google transparency = transparent (free)
    status: text("status").notNull().default("confirmed"),
    recurringEventId: text("recurring_event_id"),
    isAppBlock: boolean("is_app_block").notNull().default(false), // published by this app; never counts against capacity
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cal_events_unique").on(t.calendarId, t.googleEventId),
    index("cal_events_range_idx").on(t.calendarId, t.startAt, t.endAt),
  ],
);

export const gmailMessages = pgTable(
  "gmail_messages",
  {
    id: serial("id").primaryKey(),
    googleAccountId: integer("google_account_id").notNull().references(() => googleAccounts.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id"),
    fromAddress: text("from_address"),
    fromName: text("from_name"),
    toAddress: text("to_address"),
    subject: text("subject"),
    snippet: text("snippet"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    linkUrl: text("link_url"),
    suggestedClientId: integer("suggested_client_id").references(() => clients.id, { onDelete: "set null" }),
    suggestedProjectId: integer("suggested_project_id").references(() => projects.id, { onDelete: "set null" }),
    matchReason: text("match_reason"),
    relevanceScore: integer("relevance_score").notNull().default(0),
    status: text("status", { enum: ["new", "linked", "dismissed"] }).notNull().default("new"),
    linkedClientId: integer("linked_client_id").references(() => clients.id, { onDelete: "set null" }),
    linkedProjectId: integer("linked_project_id").references(() => projects.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gmail_unique").on(t.googleAccountId, t.gmailMessageId)],
);
