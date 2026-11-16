import assert from "node:assert/strict";
import test from "node:test";
import {
  capacityAllows,
  childBlocksAcceptance,
  clampPriority,
  deriveFindings,
  rankEligible,
  type IntelMission,
} from "./intelligence.ts";

function mission(patch: Partial<IntelMission> & Pick<IntelMission, "id" | "title" | "status">): IntelMission {
  return {
    priority: 50,
    parentId: null,
    dependsOn: null,
    dependencyStatus: null,
    updatedAtMs: 1_000,
    openDefects: 0,
    retries: 0,
    running: false,
    ...patch,
  };
}

test("priority is a bounded integer and capacity is a ceiling", () => {
  assert.equal(clampPriority(0), 0);
  assert.equal(clampPriority(100), 100);
  assert.throws(() => clampPriority(1.5));
  assert.throws(() => clampPriority(101));
  assert.equal(capacityAllows(0, 1), true);
  assert.equal(capacityAllows(1, 1), false);
});

test("a higher-priority eligible mission runs before an older one", () => {
  const ranked = rankEligible([
    { id: "old", priority: 10, updatedAtMs: 1, eligible: true },
    { id: "hot", priority: 90, updatedAtMs: 50, eligible: true },
    { id: "blocked", priority: 100, updatedAtMs: 1, eligible: false },
  ]);
  assert.equal(ranked, "hot");
  assert.equal(rankEligible([{ id: "a", priority: 1, updatedAtMs: 2, eligible: true }, { id: "b", priority: 1, updatedAtMs: 1, eligible: true }]), "b");
});

test("open subordinate work blocks the parent and a missing dependency is recorded, not guessed", () => {
  assert.equal(childBlocksAcceptance(["ACCEPTED", "CANCELLED"]), false);
  assert.equal(childBlocksAcceptance(["EXECUTING"]), true);
  const findings = deriveFindings({
    nowMs: 10_000,
    stallMs: 5_000,
    missions: [
      mission({ id: "parent", title: "Desk", status: "AWAITING_ACCEPTANCE" }),
      mission({ id: "child", title: "Invoices", status: "EXECUTING", parentId: "parent", dependsOn: "other", dependencyStatus: "PLANNED", retries: 2, openDefects: 1, updatedAtMs: 1_000 }),
    ],
    knowledge: [{ id: "mem_1", title: "Pricing", state: "proposed", confidence: "contested" }],
  });
  assert.ok(findings.some((item) => item.key === "children:parent" && item.confidence === "recorded" && item.ownerRequired));
  assert.ok(findings.some((item) => item.key === "depend:child" && item.confidence === "recorded"));
  assert.ok(findings.some((item) => item.key === "repeat:child" && item.confidence === "inferred"));
  assert.ok(findings.some((item) => item.key === "knowledge:mem_1" && item.ownerRequired));
  assert.ok(findings.some((item) => item.key === "stall:child"));
  assert.equal(findings.every((item) => item.evidence.length > 0 && item.recommendation.length > 0), true);
});
