import assert from "node:assert/strict";
import test from "node:test";
import {
  budgetDecision,
  chooseProvider,
  contentHash,
  diffRequirements,
  holdsScheduling,
  ownerMaySetCeiling,
  reliabilityOf,
  requirementsOf,
  revalidationCovers,
  traceImpact,
} from "./control.ts";

test("a specification hash changes when the text changes and a requirement keeps its id", () => {
  const body = "Invoices are drafted from a recorded job.\nTaxes stay out of this version.";
  assert.equal(contentHash(body), contentHash(`  ${body}  `));
  assert.notEqual(contentHash(body), contentHash(`${body}\nA deposit is required.`));
  const first = requirementsOf(body);
  const second = requirementsOf(`${body}\nA deposit is required before work starts.`);
  const diff = diffRequirements(first, second);
  assert.equal(diff.unchanged.length, 2);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.removed.length, 0);
  assert.equal(first[0]?.id, second[0]?.id);
});

test("only the department that contains the changed line, and work downstream of it, is marked", () => {
  const impact = traceImpact({
    removed: [{ id: "req_old", text: "Taxes stay out of this version." }],
    added: [],
    assignments: [
      { id: "research", department: "research", position: 0, brief: "Find the constraint.", artifact: "Sources listed.", status: "DONE" },
      { id: "product", department: "product", position: 1, brief: "Write the spec.", artifact: "Taxes stay out of this version.", status: "DONE" },
      { id: "build", department: "engineering", position: 2, brief: "Implement the spec.", artifact: "Page.", status: "DONE" },
    ],
  });
  assert.deepEqual(impact.affectedIds, ["product", "build"]);
  assert.deepEqual(impact.untouchedIds, ["research"]);
  assert.equal(holdsScheduling("awaiting_owner"), true);
  assert.equal(holdsScheduling("authorized"), false);
});

test("a passing report for an older specification does not cover the new one", () => {
  assert.equal(revalidationCovers({
    state: "revalidated", specVersion: 1, expectedVersion: 2, deliverableHash: "a".repeat(64), artifactHash: "a".repeat(64), result: "passed",
  }), false);
  assert.equal(revalidationCovers({
    state: "revalidated", specVersion: 2, expectedVersion: 2, deliverableHash: "a".repeat(64), artifactHash: "b".repeat(64), result: "passed",
  }), false);
});

test("a ceiling and a mission budget are enforced, and an estimate does not spend", () => {
  assert.equal(budgetDecision({
    ceilingCents: 1000, missionBudgetCents: 400, departmentBudgetCents: null,
    companySpent: 700, companyReserved: 200, missionSpent: 100, missionReserved: 0,
    departmentSpent: 0, departmentReserved: 0, amountCents: 200, kind: "charge",
  }).allow, false);
  const reserved = budgetDecision({
    ceilingCents: 1000, missionBudgetCents: 400, departmentBudgetCents: null,
    companySpent: 100, companyReserved: 0, missionSpent: 300, missionReserved: 50,
    departmentSpent: 0, departmentReserved: 0, amountCents: 100, kind: "reserve",
  });
  assert.equal(reserved.allow, false);
  assert.equal(reserved.reason.includes("mission"), true);
  const estimate = budgetDecision({
    ceilingCents: 1000, missionBudgetCents: 400, departmentBudgetCents: null,
    companySpent: 1000, companyReserved: 0, missionSpent: 400, missionReserved: 0,
    departmentSpent: 0, departmentReserved: 0, amountCents: 50, kind: "estimate",
  });
  assert.equal(estimate.allow, true);
  const open = budgetDecision({
    ceilingCents: null, missionBudgetCents: null, departmentBudgetCents: null,
    companySpent: 10, companyReserved: 0, missionSpent: 0, missionReserved: 0,
    departmentSpent: 0, departmentReserved: 0, amountCents: 10, kind: "charge",
  });
  assert.equal(open.allow, true);
  assert.equal(open.remainingCents, null);
  assert.equal(ownerMaySetCeiling("member"), false);
  assert.equal(ownerMaySetCeiling("owner"), true);
});

test("provider rates stay hidden until enough outcomes exist, and confidentiality still wins", () => {
  const thin = reliabilityOf([
    { outcome: "timeout", durationMs: 1000, at: "2026-11-01T00:00:00.000Z" },
    { outcome: "withheld", durationMs: null, at: "2026-11-02T00:00:00.000Z" },
  ]);
  assert.equal(thin.measured, false);
  assert.equal(thin.successRate, null);
  assert.equal(thin.attempts, 1);
  assert.equal(thin.withheld, 1);
  const none = reliabilityOf([]);
  assert.match(none.note, /not evidence the provider is available/);
  const choice = chooseProvider({ classification: "confidential", disclosure: "public", preferred: "pollinations" });
  assert.equal(choice.send, false);
  assert.equal(choice.provider, "local");
});
