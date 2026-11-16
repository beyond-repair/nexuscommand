import assert from "node:assert/strict";
import test from "node:test";
import { githubHealth, maintenanceClass, measuredDuration, measuredRate, recommend, requirementVerdict } from "./operate.ts";

test("a rate stays hidden under five observations and an agent cannot close a requirement", () => {
  assert.equal(measuredRate(4, 4).kind, "unavailable");
  assert.equal(measuredRate(4, 4).bps, null);
  const measured = measuredRate(8, 10);
  assert.equal(measured.kind, "measured");
  assert.equal(measured.bps, 8000);
  assert.equal(measuredDuration([10, 20, 30]).seconds, null);
  assert.equal(measuredDuration([10, 20, 30, 40, 50]).seconds, 30);
  const claimed = requirementVerdict({ agentDone: true, artifactSha: "abc", qaStatus: "missing", qaSha: "", accepted: false });
  assert.equal(claimed.complete, false);
  assert.match(claimed.reason, /not acceptance/);
  const mismatched = requirementVerdict({ agentDone: true, artifactSha: "abc", qaStatus: "passed", qaSha: "def", accepted: true });
  assert.equal(mismatched.complete, false);
  const closed = requirementVerdict({ agentDone: true, artifactSha: "abc", qaStatus: "passed", qaSha: "abc", accepted: true });
  assert.equal(closed.complete, true);
});

test("maintenance that spends, deploys, or rotates a credential is never autonomous", () => {
  for (const kind of ["deploy", "delete", "permission", "credential", "finance", "external_write", "policy", "accepted_outcome", "unknown"]) {
    const decision = maintenanceClass(kind);
    assert.equal(decision.autonomous, false);
    assert.equal(decision.risk, "high");
  }
  assert.equal(maintenanceClass("release_expired_lease").autonomous, true);
  const notes = recommend({ qaFailBps: 6000, retries: 3, blocked: 1 });
  assert.equal(notes.every((note) => note.changesPolicy === false), true);
  assert.match(notes.map((note) => note.text).join(" "), /not changed|not requeued|No new authorization/);
});

test("a disconnected GitHub account is not described as healthy", () => {
  const offline = githubHealth({ status: "authentication_failed", lastSyncMs: Date.now(), pollMinutes: 60, nowMs: Date.now() });
  assert.equal(offline.connected, false);
  assert.equal(offline.stale, false);
  const stale = githubHealth({ status: "connected", lastSyncMs: Date.now() - 120 * 60_000, pollMinutes: 60, nowMs: Date.now() });
  assert.equal(stale.connected, true);
  assert.equal(stale.stale, true);
  assert.match(stale.note, /Nothing was fetched/);
});
