import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CompanyError } from "./company.ts";
import { claimLease } from "./company-lease.ts";
import {
  acceptMission,
  authorizeMission,
  cancelMission,
  commandCenter,
  commandDevice,
  governance,
  knowledge,
  linkMissionTask,
  missionView,
  operations,
  payments,
  planMission,
  recordPayment,
  registerDevice,
  registerIntegration,
  requestExternalAction,
  reserveFunds,
  setMissionBudget,
  setScheduler,
  setSpendingCeiling,
  submitMission,
  voidPayment,
  workforce,
  type Sql,
} from "./company-store.ts";
import { RuleError, milestoneContract } from "./domain.ts";
import { apply, load } from "./engine.ts";
import { connectGithubAccount, readGithub, revokeGithubAccount, type GithubFetch } from "./github.ts";
import { processOutbox } from "./outbox.ts";
import { schedulerTick } from "./scheduler.ts";

const userA = "user_alpha";
const userB = "user_beta";
const token = "ghp_alpha_isolation_token_value";
const key = Buffer.alloc(32, 7);

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

async function migrated(): Promise<{ db: PGlite; sql: Sql }> {
  const db = new PGlite();
  const directory = join(dirname(fileURLToPath(import.meta.url)), "../../../migrations");
  const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) await db.exec(readFileSync(join(directory, name), "utf8"));
  return { db, sql: wrap(db) };
}

function textOf(value: unknown): string {
  return JSON.stringify(value);
}

test("two companies cannot read or change each other's records", async () => {
  const { db, sql } = await migrated();
  const quiet: GithubFetch = async () => ({
    status: 200,
    headers: { "x-oauth-scopes": "read:user, read:org" },
    body: JSON.stringify({ login: "alpha-lab" }),
  });

  await commandCenter(sql, userA);
  await commandCenter(sql, userB);
  const orgs = await db.query<{ id: string; owner_user_id: string }>("select id, owner_user_id from organizations order by owner_user_id");
  assert.equal(orgs.rows.length, 2);
  const orgA = orgs.rows.find((row) => row.owner_user_id === userA)?.id ?? "";
  const orgB = orgs.rows.find((row) => row.owner_user_id === userB)?.id ?? "";
  assert.notEqual(orgA, orgB);

  const submitted = await submitMission(sql, userA, "Company Alpha needs a private ledger page.");
  await planMission(sql, userA, submitted.missionId);
  await authorizeMission(sql, userA, submitted.missionId);
  await recordPayment(sql, userA, { payer: "Alpha Payer", amount: "18.00", note: "Alpha receipt", missionId: submitted.missionId });
  await reserveFunds(sql, userA, { amount: "5.00", note: "Alpha reserve", missionId: submitted.missionId, kind: "reserved" });
  await setSpendingCeiling(sql, userA, "40.00");
  await registerIntegration(sql, userA, { name: "Alpha Registry", category: "software", scopes: "read" });
  await registerDevice(sql, userA, { name: "Alpha Meter", permission: "read" });
  await connectGithubAccount(sql, { orgId: orgA, userId: userA, token, allowedRepos: "alpha-lab/private", key, fetchImpl: quiet });

  const project = await apply(sql, userA, { type: "create_project", name: "Alpha Project", summary: "Alpha only" });
  assert.ok("projectId" in project);
  const task = await apply(sql, userA, { type: "create_task", projectId: project.projectId, objective: milestoneContract().objective });
  assert.ok("taskId" in task);
  await apply(sql, userA, { type: "mark_ready", taskId: task.taskId, ...milestoneContract() });
  await apply(sql, userA, { type: "authorize", taskId: task.taskId });
  await apply(sql, userA, { type: "begin_run", taskId: task.taskId });
  await apply(sql, userA, { type: "finish_run", taskId: task.taskId });

  const beta = await submitMission(sql, userB, "Company Beta keeps its own objective.");
  await planMission(sql, userB, beta.missionId);
  await authorizeMission(sql, userB, beta.missionId);

  const payment = await db.query<{ id: string; voided_at: unknown }>("select id, voided_at from payments where payer = 'Alpha Payer'");
  const device = await db.query<{ id: string; emergency_stop: boolean }>("select id, emergency_stop from devices where name = 'Alpha Meter'");
  const integration = await db.query<{ id: string }>("select id from integrations where name = 'Alpha Registry'");
  const secret = await db.query<{ cipher: string }>("select cipher from integration_secrets where organization_id = $1", [orgA]);
  const assignment = (await missionView(sql, userA, submitted.missionId)).assignments[0];
  assert.ok(payment.rows[0] && device.rows[0] && integration.rows[0] && secret.rows[0]?.cipher && assignment);

  const before = {
    status: (await db.query<{ status: string; budget_cents: number | null }>("select status, budget_cents from missions where id = $1", [submitted.missionId])).rows[0],
    voided: payment.rows[0].voided_at,
    stop: device.rows[0].emergency_stop,
    cipher: secret.rows[0].cipher,
    task: (await db.query<{ state: string }>("select state from tasks where id = $1", [task.taskId])).rows[0]?.state,
    betaReady: (await db.query<{ n: number }>("select count(*)::int as n from assignments where organization_id = $1 and status = 'READY'", [orgB])).rows[0]?.n,
  };

  const crossed = [
    missionView(sql, userB, submitted.missionId),
    authorizeMission(sql, userB, submitted.missionId),
    acceptMission(sql, userB, submitted.missionId, "Beta accepts Alpha"),
    cancelMission(sql, userB, submitted.missionId),
    recordPayment(sql, userB, { payer: "Beta", amount: "1.00", note: "wrong company", missionId: submitted.missionId }),
    voidPayment(sql, userB, payment.rows[0].id),
    reserveFunds(sql, userB, { amount: "2.00", note: "wrong reserve", missionId: submitted.missionId, kind: "reserved" }),
    setMissionBudget(sql, userB, submitted.missionId, "9.00"),
    linkMissionTask(sql, userB, submitted.missionId, task.taskId),
    requestExternalAction(sql, userB, { integrationId: integration.rows[0].id, operation: "read", actionClass: 1, classification: "internal" }),
    commandDevice(sql, userB, device.rows[0].id, "emergency_stop"),
    load(sql, userB, { type: "task", taskId: task.taskId }),
    load(sql, userB, { type: "project", projectId: project.projectId }),
    apply(sql, userB, { type: "approve", taskId: task.taskId, note: "Beta approves Alpha" }),
  ];
  for (const attempt of crossed) {
    await assert.rejects(attempt, (error: unknown) => error instanceof CompanyError || error instanceof RuleError);
  }
  await assert.rejects(
    claimLease(sql, { orgId: orgB, missionId: submitted.missionId, assignmentId: assignment.id, fence: "run_beta", jobId: "job_beta" }),
    CompanyError,
  );
  let fetches = 0;
  await assert.rejects(
    readGithub(sql, {
      orgId: orgB,
      userId: userB,
      operation: "repos",
      resource: "",
      department: "engineering",
      missionId: "",
      key,
      fetchImpl: async () => {
        fetches += 1;
        return { status: 200, headers: {}, body: "{}" };
      },
    }),
    /not connected/,
  );
  await assert.rejects(revokeGithubAccount(sql, { orgId: orgB, userId: userB, mode: "revoked" }), /not registered/);
  assert.equal(fetches, 0);

  const centerB = await commandCenter(sql, userB);
  const payB = await payments(sql, userB);
  const memoryB = await knowledge(sql, userB);
  const auditB = await governance(sql, userB);
  const opsB = await operations(sql, userB);
  const peopleB = await workforce(sql, userB);
  const boardB = await load(sql, userB, { type: "board" });
  const visible = textOf({ centerB, payB, memoryB, auditB, opsB, peopleB, boardB });
  for (const marker of [submitted.missionId, payment.rows[0].id, task.taskId, project.projectId, token, "Alpha Payer", "Alpha Registry", "Alpha Meter", "alpha-lab/private"]) {
    assert.equal(visible.includes(marker), false, marker);
  }
  assert.equal(payB.totalCents, 0);
  assert.ok(centerB.missions.every((mission) => mission.id !== submitted.missionId));

  const reads = await Promise.all([commandCenter(sql, userA), commandCenter(sql, userB), commandCenter(sql, userA), commandCenter(sql, userB)]);
  assert.equal(reads[0].organization.id, orgA);
  assert.equal(reads[1].organization.id, orgB);
  assert.equal(reads[0].missions.some((mission) => mission.id === submitted.missionId), true);
  assert.equal(reads[1].missions.some((mission) => mission.id === submitted.missionId), false);

  const after = {
    status: (await db.query<{ status: string; budget_cents: number | null }>("select status, budget_cents from missions where id = $1", [submitted.missionId])).rows[0],
    voided: (await db.query<{ voided_at: unknown }>("select voided_at from payments where id = $1", [payment.rows[0].id])).rows[0]?.voided_at,
    stop: (await db.query<{ emergency_stop: boolean }>("select emergency_stop from devices where id = $1", [device.rows[0].id])).rows[0]?.emergency_stop,
    cipher: (await db.query<{ cipher: string }>("select cipher from integration_secrets where organization_id = $1", [orgA])).rows[0]?.cipher,
    task: (await db.query<{ state: string }>("select state from tasks where id = $1", [task.taskId])).rows[0]?.state,
    betaReady: (await db.query<{ n: number }>("select count(*)::int as n from assignments where organization_id = $1 and status = 'READY'", [orgB])).rows[0]?.n,
    betaActions: (await db.query<{ n: number }>("select count(*)::int as n from external_actions where organization_id = $1", [orgB])).rows[0]?.n,
  };
  assert.deepEqual(after.status, before.status);
  assert.equal(after.voided, before.voided);
  assert.equal(after.stop, before.stop);
  assert.equal(after.cipher, before.cipher);
  assert.equal(after.task, before.task);
  assert.equal(after.betaReady, before.betaReady);
  assert.equal(after.betaActions, 0);
  assert.equal((await db.query("select body from artifacts where organization_id = $1", [orgB])).rows.length, 0);

  await setSpendingCeiling(sql, userB, "90.00");
  const ceilings = await db.query<{ organization_id: string; spending_ceiling_cents: number }>("select organization_id, spending_ceiling_cents from portfolio_limits");
  assert.equal(ceilings.rows.find((row) => row.organization_id === orgA)?.spending_ceiling_cents, 4000);
  assert.equal(ceilings.rows.find((row) => row.organization_id === orgB)?.spending_ceiling_cents, 9000);

  const pending = await db.query<{ id: string }>("insert into outbox_events (id, organization_id, event_type, schema_version, idempotency_key, aggregate_type, aggregate_id, payload, actor_id, status) values ('obx_alpha', $1, 'mission.recorded', 1, 'iso:alpha', 'mission', $2, '{\"effect\":\"record\"}'::jsonb, $3, 'pending') returning id", [orgA, submitted.missionId, userA]);
  assert.equal(pending.rows[0]?.id, "obx_alpha");
  assert.equal(await processOutbox(sql, orgB, 20), 0);
  assert.equal((await db.query<{ status: string }>("select status from outbox_events where id = 'obx_alpha'")).rows[0]?.status, "pending");

  await setScheduler(sql, userA, "running");
  await schedulerTick(sql, async () => ({ text: "", model: "" }));
  const betaRunning = await db.query<{ n: number }>("select count(*)::int as n from assignments where organization_id = $1 and status in ('RUNNING', 'DONE')", [orgB]);
  assert.equal(betaRunning.rows[0]?.n, 0);
  const crossedJobs = await db.query<{ n: number }>(`
    select count(*)::int as n from (
      select 1 from execution_jobs j join missions m on m.id = j.mission_id where j.organization_id <> m.organization_id
      union all
      select 1 from assignments a join missions m on m.id = a.mission_id where a.organization_id <> m.organization_id
      union all
      select 1 from payments p join missions m on m.id = p.mission_id where p.organization_id <> m.organization_id
      union all
      select 1 from commitments c join missions m on m.id = c.mission_id where c.organization_id <> m.organization_id
      union all
      select 1 from tasks t join projects p on p.id = t.project_id where t.organization_id <> p.organization_id
      union all
      select 1 from artifacts a join tasks t on t.id = a.task_id where a.organization_id <> t.organization_id
      union all
      select 1 from outbox_events where organization_id not in (select id from organizations)
      union all
      select 1 from integration_secrets s join integrations i on i.id = s.integration_id where s.organization_id <> i.organization_id
    ) crossed
  `);
  assert.equal(crossedJobs.rows[0]?.n, 0);
  const sharedAgents = await db.query<{ n: number }>("select count(*)::int as n from agents a join agents b on a.id = b.id and a.organization_id <> b.organization_id");
  assert.equal(sharedAgents.rows[0]?.n, 0);
  await db.close();
});
