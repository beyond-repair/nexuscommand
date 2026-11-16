import assert from "node:assert/strict";
import test from "node:test";
import { assertCommandRate, commandRateSnapshot } from "./command-rate.ts";

test("the fortieth command is allowed and the forty-first is not, including at the same timestamp", () => {
  const now = 1_700_000_000_000;
  for (let index = 0; index < 40; index += 1) assertCommandRate("active", now);
  assert.throws(() => assertCommandRate("active", now), /Wait a minute/);
  assert.throws(() => assertCommandRate("active", now + 1), /Wait a minute/);
  assertCommandRate("active", now + 60_000);
  assert.equal(commandRateSnapshot().limit, 40);
});

test("an idle user is dropped without resetting someone who is still inside the window", () => {
  const start = commandRateSnapshot().dropped;
  const now = 1_800_000_000_000;
  assertCommandRate("idle", now);
  assertCommandRate("busy", now + 30_000);
  assertCommandRate("keeper", now + 60_000);
  assert.equal(commandRateSnapshot().tracked, 2);
  assert.ok(commandRateSnapshot().dropped >= start + 1);
  assert.throws(() => {
    for (let index = 0; index < 40; index += 1) assertCommandRate("busy", now + 30_000);
  }, /Wait a minute/);
});
