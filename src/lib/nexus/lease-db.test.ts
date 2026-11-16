import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CompanyError } from "./company.ts";
import { claimLease, commitLease, expireLeases, failLease } from "./company-lease.ts";
import type { Sql } from "./company-store.ts";

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

async function database(): Promise<{ db: PGlite; sql: Sql }> {
  const db = new PGlite();
  await db.exec(`
    create table organizations (id text primary key);
    create table missions (
      id text primary key,
      organization_id text not null references organizations (id)
    );
    create table assignments (
      id text primary key,
      mission_id text not null references missions (id),
      organization_id text not null references organizations (id),
      status text not null,
      error text not null default '',
      model text not null default '',
      run_token text not null default '',
      updated_at timestamptz not null default now()
    );
    create table execution_jobs (
      id text primary key,
      organization_id text not null references organizations (id),
      mission_id text not null references missions (id),
      assignment_id text not null references assignments (id),
      fence text not null unique,
      status text not null,
      attempt integer not null,
      max_attempts integer not null default 3,
      leased_until timestamptz not null,
      last_error text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    insert into organizations (id) values ('org_a'), ('org_b');
    insert into missions (id, organization_id) values ('msn_a', 'org_a'), ('msn_b', 'org_b');
    insert into assignments (id, mission_id, organization_id, status)
      values ('asg_a', 'msn_a', 'org_a', 'READY'), ('asg_b', 'msn_b', 'org_b', 'READY');
  `);
  return { db, sql: wrap(db) };
}

test("a stale fence cannot save and another company cannot take the assignment", async () => {
  const { db, sql } = await database();
  await claimLease(sql, { orgId: "org_a", missionId: "msn_a", assignmentId: "asg_a", fence: "run_1", jobId: "job_1" });
  const saved = await commitLease(sql, "run_1", async (tx) => {
    const rows = await tx<{ id: string }>`update assignments set status = ${"DONE"}, run_token = ${""}
      where id = ${"asg_a"} and organization_id = ${"org_a"} and status = ${"RUNNING"} and run_token = ${"run_1"}
      returning id`;
    return rows[0] ?? null;
  });
  assert.ok(saved);
  const late = await commitLease(sql, "run_1", async () => ({ ok: true }));
  assert.equal(late, null);
  await assert.rejects(
    () => claimLease(sql, { orgId: "org_b", missionId: "msn_b", assignmentId: "asg_a", fence: "run_x", jobId: "job_x" }),
    CompanyError,
  );
  const other = await db.query<{ status: string }>("select status from assignments where id = 'asg_b'");
  assert.equal(other.rows[0]?.status, "READY");
  await db.close();
});

test("an expired lease cannot save and the assignment is released", async () => {
  const { db, sql } = await database();
  await claimLease(sql, { orgId: "org_a", missionId: "msn_a", assignmentId: "asg_a", fence: "run_old", jobId: "job_old" });
  await db.exec("update execution_jobs set leased_until = now() - interval '2 seconds' where fence = 'run_old'");
  const expired = await expireLeases(sql, "msn_a");
  assert.equal(expired, 1);
  const late = await commitLease(sql, "run_old", async () => ({ ok: true }));
  assert.equal(late, null);
  const row = await db.query<{ status: string; run_token: string }>("select status, run_token from assignments where id = 'asg_a'");
  assert.equal(row.rows[0]?.status, "READY");
  assert.equal(row.rows[0]?.run_token, "");
  await db.close();
});

test("a failed write rolls back and the third failure is dead", async () => {
  const { db, sql } = await database();
  await claimLease(sql, { orgId: "org_a", missionId: "msn_a", assignmentId: "asg_a", fence: "run_a", jobId: "job_a" });
  await assert.rejects(
    () =>
      commitLease(sql, "run_a", async (tx) => {
        await tx`update assignments set status = ${"DONE"} where id = ${"asg_a"}`;
        throw new Error("database rejected the write");
      }),
    /database rejected/,
  );
  const still = await db.query<{ status: string }>("select status from assignments where id = 'asg_a'");
  assert.equal(still.rows[0]?.status, "RUNNING");
  const job = await db.query<{ status: string }>("select status from execution_jobs where fence = 'run_a'");
  assert.equal(job.rows[0]?.status, "leased");

  assert.equal(await failLease(sql, "run_a", "first"), "retry");
  await db.exec("update execution_jobs set leased_until = now() - interval '1 second' where fence = 'run_a'");
  await claimLease(sql, { orgId: "org_a", missionId: "msn_a", assignmentId: "asg_a", fence: "run_b", jobId: "job_b" });
  assert.equal(await failLease(sql, "run_b", "second"), "retry");
  await db.exec("update execution_jobs set leased_until = now() - interval '1 second' where fence = 'run_b'");
  await claimLease(sql, { orgId: "org_a", missionId: "msn_a", assignmentId: "asg_a", fence: "run_c", jobId: "job_c" });
  assert.equal(await failLease(sql, "run_c", "third"), "dead");
  await assert.rejects(
    () => claimLease(sql, { orgId: "org_a", missionId: "msn_a", assignmentId: "asg_a", fence: "run_d", jobId: "job_d" }),
    /dead letter/,
  );
  await db.close();
});
