/** Derived operations. Rates come from stored counts. A recommendation never changes a policy. */

export type MetricKind = "measured" | "unavailable";

export function measuredRate(successes: number, total: number, minimum = 5): { kind: MetricKind; sample: number; bps: number | null; note: string } {
  if (!Number.isInteger(total) || total < minimum || successes < 0 || successes > total) {
    return { kind: "unavailable", sample: Math.max(0, total), bps: null, note: `Fewer than ${minimum} comparable observations. The rate is not shown.` };
  }
  return { kind: "measured", sample: total, bps: Math.round((successes / total) * 10_000), note: "Measured from stored records. This is not a forecast." };
}

export function measuredDuration(samples: readonly number[], minimum = 5): { kind: MetricKind; sample: number; seconds: number | null; note: string } {
  const usable = samples.filter((value) => Number.isFinite(value) && value >= 0);
  if (usable.length < minimum) {
    return { kind: "unavailable", sample: usable.length, seconds: null, note: "Fewer than five finished missions. Duration is not shown." };
  }
  const seconds = Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
  return { kind: "measured", sample: usable.length, seconds, note: "Average of stored start and acceptance times. It is not a promise about the next mission." };
}

export function requirementVerdict(input: {
  agentDone: boolean;
  artifactSha: string;
  qaStatus: "passed" | "failed" | "missing";
  qaSha: string;
  accepted: boolean;
}): { complete: boolean; reason: string } {
  const matched = input.qaStatus === "passed" && input.artifactSha !== "" && input.qaSha === input.artifactSha;
  if (matched && input.accepted) {
    return { complete: true, reason: "The owner accepted a packet whose quality report names this artifact." };
  }
  if (input.agentDone) {
    return { complete: false, reason: "An agent completion report is not acceptance. The requirement stays open." };
  }
  return { complete: false, reason: "The chain is missing a matching quality report or owner acceptance." };
}

const AUTONOMOUS = new Set(["release_expired_lease", "recalculate_metrics", "diagnostic"]);
const OWNER = new Set(["deploy", "delete", "permission", "credential", "finance", "external_write", "policy", "accepted_outcome"]);

export function maintenanceClass(kind: string): { risk: "low" | "high"; autonomous: boolean } {
  if (AUTONOMOUS.has(kind)) return { risk: "low", autonomous: true };
  if (OWNER.has(kind)) return { risk: "high", autonomous: false };
  return { risk: "high", autonomous: false };
}

export function recommend(input: { qaFailBps: number | null; retries: number; blocked: number }): Array<{ text: string; changesPolicy: false }> {
  const notes: Array<{ text: string; changesPolicy: false }> = [];
  if (input.qaFailBps != null && input.qaFailBps >= 5000) {
    notes.push({ text: "Half or more of the stored quality reports failed. Read those reports before another run. The budget and the scheduler were not changed.", changesPolicy: false });
  }
  if (input.retries >= 3) {
    notes.push({ text: "Three or more retries are on record. Inspect the last error. Nothing was requeued by this recommendation.", changesPolicy: false });
  }
  if (input.blocked > 0) {
    notes.push({ text: `${input.blocked} authorized mission${input.blocked === 1 ? "" : "s"} still wait on an unaccepted dependency. Accept or remove the dependency. No new authorization was created.`, changesPolicy: false });
  }
  if (notes.length === 0) {
    notes.push({ text: "No redistribution is recommended from the current sample. Absence of a recommendation is not a performance claim.", changesPolicy: false });
  }
  return notes;
}

export function githubHealth(input: { status: string; lastSyncMs: number | null; pollMinutes: number; nowMs: number }): { connected: boolean; stale: boolean; note: string } {
  const connected = input.status === "connected";
  if (!connected) return { connected: false, stale: false, note: "GitHub is not connected. No sync health is claimed." };
  const windowMs = Math.max(1, input.pollMinutes) * 60_000;
  const stale = input.lastSyncMs == null || input.nowMs - input.lastSyncMs >= windowMs;
  return {
    connected: true,
    stale,
    note: stale ? "The last stored sync is older than the recorded interval. Nothing was fetched by this check." : "The last stored sync is inside the recorded interval. This is not continuous monitoring.",
  };
}
