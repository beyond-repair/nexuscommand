/** Portfolio and operational findings. Inferences are labeled. They are not facts. */

export type IntelMission = {
  id: string;
  title: string;
  status: string;
  priority: number;
  parentId: string | null;
  dependsOn: string | null;
  dependencyStatus: string | null;
  updatedAtMs: number;
  openDefects: number;
  retries: number;
  running: boolean;
};

export type IntelKnowledge = {
  id: string;
  title: string;
  state: string;
  confidence: string;
};

export type FindingDraft = {
  key: string;
  missionId: string | null;
  severity: "info" | "watch" | "blocking";
  title: string;
  evidence: string;
  recommendation: string;
  confidence: "recorded" | "inferred";
  ownerRequired: boolean;
};

const OPEN = new Set(["PROPOSED", "PLANNED", "AUTHORIZED", "EXECUTING", "AWAITING_ACCEPTANCE", "REJECTED"]);

export function clampPriority(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("Priority is a whole number from 0 to 100.");
  }
  return value;
}

export function capacityAllows(running: number, maxConcurrent: number): boolean {
  return running < maxConcurrent;
}

/** A parent is not finished while a subordinate mission is still open. */
export function childBlocksAcceptance(statuses: readonly string[]): boolean {
  return statuses.some((status) => status !== "ACCEPTED" && status !== "CANCELLED");
}

export function rankEligible(rows: ReadonlyArray<{ id: string; priority: number; updatedAtMs: number; eligible: boolean }>): string | null {
  const ready = rows.filter((row) => row.eligible);
  ready.sort((a, b) => b.priority - a.priority || a.updatedAtMs - b.updatedAtMs);
  return ready[0]?.id ?? null;
}

export function deriveFindings(input: {
  nowMs: number;
  stallMs: number;
  missions: readonly IntelMission[];
  knowledge: readonly IntelKnowledge[];
}): FindingDraft[] {
  const findings: FindingDraft[] = [];
  const titles = new Map<string, string[]>();
  for (const mission of input.missions) {
    if (mission.status === "CANCELLED") continue;
    const key = mission.title.trim().toLowerCase();
    if (key) titles.set(key, [...(titles.get(key) ?? []), mission.title]);
    const waiting = mission.dependsOn && mission.dependencyStatus !== "ACCEPTED";
    if (waiting && (mission.status === "AUTHORIZED" || mission.status === "EXECUTING")) {
      findings.push({
        key: `depend:${mission.id}`,
        missionId: mission.id,
        severity: "blocking",
        title: "A dependency is not accepted",
        evidence: `${mission.title} is ${mission.status} and waits on a mission that is ${mission.dependencyStatus ?? "missing"}.`,
        recommendation: "Accept the dependency, or remove it before this mission runs.",
        confidence: "recorded",
        ownerRequired: true,
      });
    }
    if (mission.retries >= 2) {
      findings.push({
        key: `retry:${mission.id}`,
        missionId: mission.id,
        severity: mission.retries >= 3 ? "blocking" : "watch",
        title: "A department has been retried",
        evidence: `${mission.title} has ${mission.retries} recorded attempts.`,
        recommendation: mission.retries >= 3 ? "The retry limit is exhausted. Recover it or send it back." : "Inspect the last error before another run.",
        confidence: "recorded",
        ownerRequired: mission.retries >= 3,
      });
    }
    if (mission.openDefects > 0) {
      findings.push({
        key: `defects:${mission.id}`,
        missionId: mission.id,
        severity: "watch",
        title: "Verification defects are still open",
        evidence: `${mission.title} has ${mission.openDefects} open defect${mission.openDefects === 1 ? "" : "s"}.`,
        recommendation: "Rework the department that owns the failed check. Do not accept the packet.",
        confidence: "recorded",
        ownerRequired: false,
      });
    }
    if (mission.retries >= 2 && mission.openDefects > 0) {
      findings.push({
        key: `repeat:${mission.id}`,
        missionId: mission.id,
        severity: "watch",
        title: "Retries and open defects are on the same mission",
        evidence: `${mission.title} has both ${mission.retries} attempts and ${mission.openDefects} open defects. That combination is consistent with a repeated failed check, not a separate measurement.`,
        recommendation: "Read the defect and the last error together before running the department again.",
        confidence: "inferred",
        ownerRequired: false,
      });
    }
    const idle = input.nowMs - mission.updatedAtMs;
    if ((mission.status === "AUTHORIZED" || mission.status === "EXECUTING") && !mission.running && idle > input.stallMs) {
      findings.push({
        key: `stall:${mission.id}`,
        missionId: mission.id,
        severity: "watch",
        title: "Authorized work has not moved",
        evidence: `${mission.title} is ${mission.status} and its record has not changed within the stall window.`,
        recommendation: "Run the next ready department, or recover an expired lease. The scheduler will not invent a new authorization.",
        confidence: "recorded",
        ownerRequired: false,
      });
    }
    const children = input.missions.filter((row) => row.parentId === mission.id && OPEN.has(row.status));
    if (children.length > 0 && (mission.status === "AWAITING_ACCEPTANCE" || mission.status === "ACCEPTED")) {
      findings.push({
        key: `children:${mission.id}`,
        missionId: mission.id,
        severity: "blocking",
        title: "Subordinate missions are still open",
        evidence: `${mission.title} still has open work: ${children.map((row) => row.title).join(", ")}.`,
        recommendation: "Accept or cancel the subordinate missions before treating the parent as finished.",
        confidence: "recorded",
        ownerRequired: true,
      });
    }
  }
  for (const [key, names] of titles) {
    if (names.length < 2) continue;
    findings.push({
      key: `duplicate:${key}`,
      missionId: null,
      severity: "info",
      title: "Two missions share a title",
      evidence: `${names.length} missions are titled “${names[0]}”.`,
      recommendation: "Confirm they are distinct work. Nothing is merged automatically.",
      confidence: "recorded",
      ownerRequired: false,
    });
  }
  for (const entry of input.knowledge) {
    if (entry.confidence !== "contested" || entry.state === "superseded") continue;
    findings.push({
      key: `knowledge:${entry.id}`,
      missionId: null,
      severity: "watch",
      title: "Knowledge is contested",
      evidence: `“${entry.title}” disagrees with an accepted record and was not allowed to replace it.`,
      recommendation: "Resolve the conflict explicitly. The earlier decision stays in force until you do.",
      confidence: "recorded",
      ownerRequired: true,
    });
  }
  return findings;
}
