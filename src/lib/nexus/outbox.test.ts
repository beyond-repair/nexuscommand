import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./company-store.ts";
import { completeOutbox, enqueueOutbox, failureStatus, mayCommitEvent, processOutbox, recoverExpiredOutbox, retryDelaySeconds } from "./outbox.ts";

function wrap(db: PGlite): Sql {
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    let text = strings[0] ?? "";
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
    const result = await db.query<T>(text, values);
    return result.rows;
  }) as Sql;
  sql.transaction = async <T>(fn: (tx: Sql) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      const inner = (async <R>(strings: TemplateStringsArray, ...values: unknown[]): Promise<R[]> => {
        let text = strings[0] ?? "";
        for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
        const result = await tx.query<R>(text, values);
        return result.rows;
      }) as Sql;
      return fn(inner);
    });
  return sql;
}

async function schema(db: PGlite): Promise<void> {
  await db.exec(`
    create table missions (id text primary key, organization_id text, status text);
    insert into missions (id, organization_id, status) values ('mis_1', 'org_a', 'PLANNED');
    create table outbox_events (
      id text primary key,
      organization_id text not null,
      event_type text not null,
      schema_version integer not null default 1,
      correlation_id text not null default '',
      causation_id text not null default '',
      idempotency_key text not null,
      aggregate_type text not null,
      aggregate_id text not null,
      payload jsonb not null default '{}'::jsonb,
      actor_id text not null,
      status text not null,
      attempt integer not null default 0,
      max_attempts integer not null default 5,
      lease_fence text not null default '',
      leased_until timestamptz,
      available_at timestamptz not null default now(),
      last_error text not null default '',
      error_class text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz,
      unique (organization_id, idempotency_key)
    );
    create table outbox_deliveries (
      event_id text primary key,
      organization_id text not null,
      effect text not null,
      created_at timestamptz not null default now()
    );
  `);
}

test("a crash before commit keeps both the mission and the event unwritten", async () => {
  const db = new PGlite();
  await schema(db);
  const sql = wrap(db);
  const transaction = sql.transaction;
  if (!transaction) throw new Error("The test database has no transaction.");
  await assert.rejects(() => transaction(async (tx) => {
    await tx`update missions set status = ${"AUTHORIZED"} where id = ${"mis_1"}`;
    await enqueueOutbox(tx, {
      orgId: "org_a",
      eventType: "mission.authorized",
      idempotencyKey: "mission.authorized:mis_1",
      correlationId: "mis_1",
      causationId: "owner",
      aggregateType: "mission",
      aggregateId: "mis_1",
      actorId: "owner",
      summary: "Owner authorized the plan.",
    });
    throw new Error("crash before commit");
  }));
  const mission = await db.query<{ status: string }>("select status from missions");
  const events = await db.query<{ count: number }>("select count(*)::int as count from outbox_events");
  assert.equal(mission.rows[0]?.status, "PLANNED");
  assert.equal(Number(events.rows[0]?.count), 0);
  await db.close();
});

test("the same event is delivered once, a stale fence cannot finish it, and a refused event does not authorize", async () => {
  assert.equal(failureStatus(5, 5, false), "dead");
  assert.equal(failureStatus(2, 5, false), "failed");
  assert.equal(failureStatus(1, 5, true), "dead");
  assert.equal(mayCommitEvent({ heldFence: "a", workerFence: "b", leaseUntilMs: 20, nowMs: 10 }), false);
  assert.equal(retryDelaySeconds(3), 8);
  const db = new PGlite();
  await schema(db);
  const sql = wrap(db);
  const transaction = sql.transaction;
  if (!transaction) throw new Error("The test database has no transaction.");
  await transaction(async (tx) => {
    await tx`update missions set status = ${"AUTHORIZED"} where id = ${"mis_1"}`;
    await enqueueOutbox(tx, {
      orgId: "org_a",
      eventType: "mission.authorized",
      idempotencyKey: "mission.authorized:mis_1",
      correlationId: "mis_1",
      causationId: "owner",
      aggregateType: "mission",
      aggregateId: "mis_1",
      actorId: "owner",
      summary: "Owner authorized the plan.",
    });
    await enqueueOutbox(tx, {
      orgId: "org_a",
      eventType: "mission.authorized",
      idempotencyKey: "mission.authorized:mis_1",
      correlationId: "mis_1",
      causationId: "owner",
      aggregateType: "mission",
      aggregateId: "mis_1",
      actorId: "owner",
      summary: "duplicate",
    });
  });
  assert.equal(await processOutbox(sql, "org_a", 5), 1);
  assert.equal(await processOutbox(sql, "org_a", 5), 0);
  const deliveries = await db.query<{ count: number }>("select count(*)::int as count from outbox_deliveries");
  assert.equal(Number(deliveries.rows[0]?.count), 1);
  await db.exec(`insert into outbox_events (
    id, organization_id, event_type, idempotency_key, aggregate_type, aggregate_id, payload, actor_id, status, lease_fence, leased_until
  ) values (
    'obx_held', 'org_a', 'mission.authorized', 'held', 'mission', 'mis_1', '{"effect":"record"}'::jsonb, 'owner', 'processing', 'fence_a', now() + interval '1 minute'
  )`);
  assert.equal(await completeOutbox(sql, "obx_held", "fence_b"), false);
  const held = await db.query<{ status: string }>("select status from outbox_events where id = 'obx_held'");
  assert.equal(held.rows[0]?.status, "processing");
  await db.exec(`insert into outbox_events (
    id, organization_id, event_type, idempotency_key, aggregate_type, aggregate_id, payload, actor_id, status, created_at
  ) values (
    'obx_bad', 'org_a', 'mission.authorized', 'bad', 'mission', 'mis_2', '{"effect":"authorize"}'::jsonb, 'svc:nexus', 'pending', now()
  )`);
  await db.exec(`update missions set status = 'PLANNED' where id = 'mis_1'`);
  await processOutbox(sql, "org_a", 5);
  const mission = await db.query<{ status: string }>("select status from missions");
  const refused = await db.query<{ status: string }>("select status from outbox_events where id = 'obx_bad'");
  assert.equal(mission.rows[0]?.status, "PLANNED");
  assert.equal(refused.rows[0]?.status, "dead");
  await db.close();
});

test("an expired processing lease can be recovered once, and a later event waits for the earlier one", async () => {
  const db = new PGlite();
  await schema(db);
  const sql = wrap(db);
  await db.exec(`
    insert into outbox_events (
      id, organization_id, event_type, idempotency_key, aggregate_type, aggregate_id, payload, actor_id, status, attempt, max_attempts, leased_until, created_at
    ) values
    ('obx_old', 'org_a', 'execution.completed', 'old', 'execution', 'run_1', '{"effect":"record","summary":"saved"}'::jsonb, 'svc:nexus', 'processing', 1, 5, now() - interval '1 minute', now() - interval '2 minutes'),
    ('obx_new', 'org_a', 'artifact.recorded', 'new', 'execution', 'run_1', '{"effect":"record","summary":"artifact"}'::jsonb, 'svc:nexus', 'pending', 0, 5, null, now() - interval '1 minute'),
    ('obx_dead', 'org_a', 'qa.recorded', 'dead', 'execution', 'run_2', '{"effect":"record","summary":"qa"}'::jsonb, 'svc:nexus', 'processing', 5, 5, now() - interval '1 minute', now());
  `);
  const recovered = await recoverExpiredOutbox(sql, "org_a");
  assert.equal(recovered, 2);
  const dead = await db.query<{ status: string }>("select status from outbox_events where id = 'obx_dead'");
  assert.equal(dead.rows[0]?.status, "dead");
  assert.equal(await processOutbox(sql, "org_a", 1), 1);
  const newer = await db.query<{ status: string }>("select status from outbox_events where id = 'obx_new'");
  assert.equal(newer.rows[0]?.status, "pending");
  assert.equal(await processOutbox(sql, "org_a", 1), 1);
  const deliveries = await db.query<{ count: number }>("select count(*)::int as count from outbox_deliveries");
  assert.equal(Number(deliveries.rows[0]?.count), 2);
  await db.exec(`insert into outbox_events (
    id, organization_id, event_type, schema_version, idempotency_key, aggregate_type, aggregate_id, payload, actor_id, status
  ) values (
    'obx_v2', 'org_a', 'mission.authorized', 2, 'schema-2', 'mission', 'mis_9', '{"effect":"record","summary":"future"}'::jsonb, 'owner', 'pending'
  )`);
  await processOutbox(sql, "org_a", 5);
  const future = await db.query<{ status: string; error_class: string }>("select status, error_class from outbox_events where id = 'obx_v2'");
  const extra = await db.query<{ count: number }>("select count(*)::int as count from outbox_deliveries where event_id = 'obx_v2'");
  assert.equal(future.rows[0]?.status, "dead");
  assert.equal(future.rows[0]?.error_class, "refused");
  assert.equal(Number(extra.rows[0]?.count), 0);
  await db.close();
});
