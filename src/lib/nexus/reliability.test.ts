import assert from "node:assert/strict";
import test from "node:test";
import { localDraft } from "./company.ts";
import { mayCommit, nextStatus, retryDelayMs } from "./execution.ts";
import { executeArtifact } from "./qa-sandbox.ts";

test("a stale fence cannot commit", () => {
  const now = 1_000;
  assert.equal(mayCommit({ heldFence: "run_a", workerFence: "run_a", leaseUntilMs: now + 1, nowMs: now }), true);
  assert.equal(mayCommit({ heldFence: "run_a", workerFence: "run_b", leaseUntilMs: now + 1, nowMs: now }), false);
  assert.equal(mayCommit({ heldFence: "run_a", workerFence: "run_a", leaseUntilMs: now, nowMs: now }), false);
  assert.equal(mayCommit({ heldFence: "", workerFence: "", leaseUntilMs: now + 1, nowMs: now }), false);
});

test("retries stop at the third attempt", () => {
  assert.equal(nextStatus(1), "retry");
  assert.equal(nextStatus(2), "retry");
  assert.equal(nextStatus(3), "dead");
  assert.ok(retryDelayMs(3) >= retryDelayMs(1));
  assert.ok(retryDelayMs(10) <= 8_000);
});

test("the local slice runs in a separate process and a network slice does not", async () => {
  const objective = "Track contractor jobs and draft invoices";
  const html = localDraft("developer", objective, "").match(/```html\s*([\s\S]*?)```/i)?.[1] ?? "";
  const passed = await executeArtifact(html, objective);
  assert.equal(passed.passed, true, passed.detail);
  assert.equal(passed.sha256.length, 64);
  assert.ok(passed.tests.some((item) => item.name === "Output changed" && item.passed));

  const hostile = await executeArtifact(
    "<!doctype html><script>fetch('https://example.test')</script>",
    objective,
  );
  assert.equal(hostile.passed, false);
  assert.ok(hostile.tests.some((item) => item.name === "No forbidden capability" && item.passed === false));

  const escaped = await executeArtifact(
    "<!doctype html><script>const host = this.constructor.constructor('return this')(); if (host) throw new Error('escaped')</script>",
    objective,
  );
  assert.equal(escaped.passed, false, escaped.detail);
  assert.equal(escaped.sandbox.enforced, true);
});

test("a script that throws does not pass verification", async () => {
  const report = await executeArtifact(
    "<!doctype html><p id=\"out\">idle</p><script>throw new Error('boom')</script>",
    "Track jobs",
  );
  assert.equal(report.passed, false);
  assert.ok(report.tests.some((item) => item.name === "Script ran" && item.passed === false));
});
