import { createHash } from "node:crypto";
import { providerDecision, type DataClass } from "./company.ts";

export const REVALIDATION_STATES = [
  "current",
  "change_detected",
  "impact_required",
  "awaiting_owner",
  "authorized",
  "in_progress",
  "revalidated",
  "superseded",
] as const;

export type RevalidationState = (typeof REVALIDATION_STATES)[number];

export type Requirement = { id: string; text: string };

export function contentHash(body: string): string {
  return createHash("sha256").update(body.replace(/\s+/g, " ").trim()).digest("hex");
}

export function requirementsOf(body: string): Requirement[] {
  const seen = new Set<string>();
  const requirements: Requirement[] = [];
  for (const line of body.split("\n")) {
    const text = line.replace(/\s+/g, " ").trim();
    if (text.length < 8) continue;
    const id = `req_${contentHash(text).slice(0, 12)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    requirements.push({ id, text });
  }
  return requirements;
}

export function diffRequirements(before: readonly Requirement[], after: readonly Requirement[]): {
  added: Requirement[];
  removed: Requirement[];
  unchanged: Requirement[];
} {
  const afterIds = new Set(after.map((item) => item.id));
  const beforeIds = new Set(before.map((item) => item.id));
  return {
    added: after.filter((item) => !beforeIds.has(item.id)),
    removed: before.filter((item) => !afterIds.has(item.id)),
    unchanged: after.filter((item) => beforeIds.has(item.id)),
  };
}

export type AssignmentTrace = {
  id: string;
  department: string;
  position: number;
  brief: string;
  artifact: string;
  status: string;
};

export function traceImpact(input: {
  added: readonly Requirement[];
  removed: readonly Requirement[];
  assignments: readonly AssignmentTrace[];
}): { affectedIds: string[]; untouchedIds: string[]; departments: string[] } {
  const changed = [...input.added, ...input.removed].map((item) => item.text.toLowerCase());
  const direct = input.assignments.filter((row) => {
    const haystack = `${row.brief}\n${row.artifact}`.toLowerCase();
    return changed.some((line) => haystack.includes(line));
  });
  const earliest = direct.reduce((min, row) => Math.min(min, row.position), Number.POSITIVE_INFINITY);
  const affected = input.assignments.filter((row) => direct.some((item) => item.id === row.id) || (Number.isFinite(earliest) && row.position > earliest && row.status === "DONE"));
  const affectedIds = affected.map((row) => row.id);
  return {
    affectedIds,
    untouchedIds: input.assignments.filter((row) => !affectedIds.includes(row.id)).map((row) => row.id),
    departments: [...new Set(affected.map((row) => row.department))],
  };
}

export function holdsScheduling(state: string | null): boolean {
  return state === "change_detected" || state === "impact_required" || state === "awaiting_owner";
}

export function revalidationCovers(input: {
  state: string;
  specVersion: number;
  expectedVersion: number;
  deliverableHash: string;
  artifactHash: string;
  result: string;
}): boolean {
  return input.state === "revalidated"
    && input.specVersion === input.expectedVersion
    && input.result === "passed"
    && input.deliverableHash.length === 64
    && input.deliverableHash === input.artifactHash;
}

export type BudgetKind = "charge" | "reserve" | "estimate";

export function budgetDecision(input: {
  ceilingCents: number | null;
  missionBudgetCents: number | null;
  departmentBudgetCents: number | null;
  companySpent: number;
  companyReserved: number;
  missionSpent: number;
  missionReserved: number;
  departmentSpent: number;
  departmentReserved: number;
  amountCents: number;
  kind: BudgetKind;
}): { allow: boolean; reason: string; remainingCents: number | null; utilization: number | null } {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { allow: false, reason: "The amount is not a positive number of cents.", remainingCents: null, utilization: null };
  }
  const spent = input.companySpent + input.companyReserved;
  const utilization = input.ceilingCents != null && input.ceilingCents > 0 ? spent / input.ceilingCents : null;
  const remainingCents = input.ceilingCents == null ? null : input.ceilingCents - spent;
  if (input.kind === "estimate") {
    return { allow: true, reason: "An estimate is recorded and does not consume the budget.", remainingCents, utilization };
  }
  if (input.ceilingCents != null && spent + input.amountCents > input.ceilingCents) {
    return { allow: false, reason: "That amount is above the spending ceiling.", remainingCents, utilization };
  }
  if (input.missionBudgetCents != null && input.missionSpent + input.missionReserved + input.amountCents > input.missionBudgetCents) {
    return { allow: false, reason: "That amount is above the mission budget.", remainingCents, utilization };
  }
  if (input.departmentBudgetCents != null && input.departmentSpent + input.departmentReserved + input.amountCents > input.departmentBudgetCents) {
    return { allow: false, reason: "That amount is above the department allocation.", remainingCents, utilization };
  }
  if (input.ceilingCents == null) {
    return { allow: true, reason: "No spending ceiling is set. The amount is recorded. Remaining budget is unavailable.", remainingCents: null, utilization: null };
  }
  return { allow: true, reason: "Within the authorized ceiling.", remainingCents: input.ceilingCents - spent - input.amountCents, utilization };
}

export function ownerMaySetCeiling(role: string): boolean {
  return role === "owner";
}

export type Observation = {
  outcome: "succeeded" | "failed" | "timeout" | "withheld" | "unspecified";
  durationMs: number | null;
  at: string;
};

export function reliabilityOf(rows: readonly Observation[], minimum = 5): {
  attempts: number;
  withheld: number;
  unspecified: number;
  successRate: number | null;
  failureRate: number | null;
  timeoutRate: number | null;
  averageMs: number | null;
  p95Ms: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  lastOutcome: string | null;
  measured: boolean;
  note: string;
} {
  const attempts = rows.filter((row) => row.outcome === "succeeded" || row.outcome === "failed" || row.outcome === "timeout");
  const withheld = rows.filter((row) => row.outcome === "withheld").length;
  const unspecified = rows.filter((row) => row.outcome === "unspecified").length;
  const ordered = [...rows].sort((a, b) => a.at.localeCompare(b.at));
  const durations = attempts.map((row) => row.durationMs).filter((value): value is number => value != null && value >= 0).sort((a, b) => a - b);
  const measured = attempts.length >= minimum;
  const succeeded = attempts.filter((row) => row.outcome === "succeeded").length;
  const failed = attempts.filter((row) => row.outcome === "failed").length;
  const timeouts = attempts.filter((row) => row.outcome === "timeout").length;
  if (rows.length === 0) {
    return {
      attempts: 0, withheld: 0, unspecified: 0, successRate: null, failureRate: null, timeoutRate: null,
      averageMs: null, p95Ms: null, periodStart: null, periodEnd: null, lastOutcome: null, measured: false,
      note: "No dispatches are recorded. That is not evidence the provider is available.",
    };
  }
  return {
    attempts: attempts.length,
    withheld,
    unspecified,
    successRate: measured ? succeeded / attempts.length : null,
    failureRate: measured ? failed / attempts.length : null,
    timeoutRate: measured ? timeouts / attempts.length : null,
    averageMs: measured && durations.length >= minimum ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    p95Ms: measured && durations.length >= minimum ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] ?? null : null,
    periodStart: ordered[0]?.at ?? null,
    periodEnd: ordered[ordered.length - 1]?.at ?? null,
    lastOutcome: ordered[ordered.length - 1]?.outcome ?? null,
    measured,
    note: measured
      ? "Rates use recorded attempts only. Withheld calls and rows without an outcome are not treated as uptime."
      : `Fewer than ${minimum} attempts with an outcome. Rates are not shown.`,
  };
}

export function chooseProvider(input: {
  classification: DataClass;
  disclosure: "local" | "public";
  preferred: "pollinations" | "local";
}): { send: boolean; provider: "pollinations" | "local"; reason: string } {
  const decision = providerDecision({ classification: input.classification, disclosure: input.disclosure });
  if (!decision.send) {
    return { ...decision, reason: `${decision.reason} A reliability preference for ${input.preferred} does not override that.` };
  }
  return decision;
}
