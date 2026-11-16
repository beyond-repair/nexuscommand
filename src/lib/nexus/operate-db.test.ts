import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { refreshOperate, type Sql } from "./company-store.ts";

function wrap(db: PGlite): Sql {
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    let text = strings[0] ?? "";
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
    const result = await db.query<T>(text, values);
    return result.rows;
  }) as Sql;
  return sql;
}

test("an expired lease is released and an agent-done requirement stays open", async () => {
  const db = new PGlite();
  await db.exec(`
    create table organizations (id text primary key);
    insert into organizations (id) values ('org_a');
    create table execution_jobs (
      id text primary key, organization_id text, mission_id text, assignment_id text, fence text,
      status text, attempt integer, leased_until timestamptz, updated_at timestamptz default now()
    );
    insert into execution_jobs (id, organization_id, mission_id, assignment_id, fence, status, attempt, leased_until)
      values ('job_1', 'org_a', 'mis_1', 'asg_1', 'fence_1', 'leased', 1, now() - interval '5 minutes');
    create table assignments (
      id text primary key, status text, run_token text, model text, error text, updated_at timestamptz default now()
    );
    insert into assignments (id, status, run_token) values ('asg_1', 'RUNNING', 'fence_1'), ('asg_2', 'DONE', '');
    create table qa_reports (
      id text primary key, organization_id text, mission_id text, assignment_id text, artifact_sha256 text, status text, created_at timestamptz default now()
    );
    create table missions (
      id text primary key, organization_id text, status text, depends_on text, created_at timestamptz default now(), updated_at timestamptz default now()
    );
    insert into missions (id, organization_id, status) values ('mis_1', 'org_a', 'EXECUTING');
    create table defects (id text primary key, organization_id text, status text);
    create table provider_prices (id text primary key, organization_id text, status text, review_at timestamptz);
    create table github_connections (
      id text primary key, organization_id text, status text, last_sync_at timestamptz, poll_minutes integer, updated_at timestamptz default now()
    );
    create table specifications (id text primary key, state text);
    insert into specifications (id, state) values ('spec_1', 'accepted');
    create table requirements (
      id text primary key, organization_id text, mission_id text, specification_id text, requirement_key text, change text
    );
    insert into requirements (id, organization_id, mission_id, specification_id, requirement_key, change)
      values ('req_1', 'org_a', 'mis_1', 'spec_1', 'req_invoice', 'unchanged');
    create table requirement_links (
      id text primary key, requirement_key text, specification_id text, assignment_id text, execution_id text,
      artifact_sha256 text, created_at timestamptz default now()
    );
    insert into requirement_links (id, requirement_key, specification_id, assignment_id, execution_id, artifact_sha256)
      values ('lnk_1', 'req_invoice', 'spec_1', 'asg_2', 'run_1', 'sha_a');
    create table trace_links (
      id text primary key, organization_id text, mission_id text, specification_id text, requirement_key text,
      assignment_id text, execution_id text, artifact_sha256 text, qa_report_id text, qa_passed boolean,
      accepted boolean, complete boolean, reason text, project_id text, updated_at timestamptz default now(),
      unique (organization_id, mission_id, requirement_key, specification_id)
    );
    create table maintenance_actions (
      id text primary key, organization_id text, action_key text, kind text, risk text, autonomous boolean,
      status text, title text, evidence text, result text, updated_at timestamptz default now(),
      unique (organization_id, action_key)
    );
    create table metric_snapshots (
      id text primary key, organization_id text, name text, sample integer, value integer, kind text, unit text, note text,
      created_at timestamptz default now(), unique (organization_id, name)
    );
    create table audit_events (
      id text primary key, organization_id text, project_id text, task_id text, actor_id text, actor_kind text,
      action text, target text, from_state text, to_state text, detail text
    );
  `);
  const view = await refreshOperate(wrap(db), "org_a", "owner");
  const assignment = await db.query<{ status: string }>("select status from assignments where id = 'asg_1'");
  assert.equal(assignment.rows[0]?.status, "READY");
  const trace = await db.query<{ complete: boolean; reason: string }>("select complete, reason from trace_links");
  assert.equal(trace.rows[0]?.complete, false);
  assert.match(trace.rows[0]?.reason ?? "", /not acceptance/);
  assert.equal(view.metrics.find((metric) => metric.name === "Execution success")?.kind, "unavailable");
  assert.equal(view.recommendations.some((note) => note.includes("budget")), false);
  const applied = await db.query<{ status: string }>("select status from maintenance_actions where action_key = 'lease:expired'");
  assert.equal(applied.rows[0]?.status, "applied");
  await db.close();
});
