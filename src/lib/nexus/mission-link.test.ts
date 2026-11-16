import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CompanyError } from "./company.ts";
import type { Sql } from "./company-store.ts";
import { linkTaskToMission, missionTaskLinks, requireOwner, unlinkTaskFromMission } from "./mission-link.ts";

function wrap(db: PGlite): Sql {
  const sql = (async <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    let text = strings[0] ?? "";
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
    const result = await db.query<T>(text, values);
    return result.rows;
  }) as Sql;
  return sql;
}

async function database(): Promise<{ db: PGlite; sql: Sql }> {
  const db = new PGlite();
  await db.exec(`
    create table organizations (id text primary key);
    create table projects (
      id text primary key,
      organization_id text not null,
      name text not null
    );
    create table tasks (
      id text primary key,
      organization_id text not null,
      project_id text not null,
      objective text not null,
      state text not null
    );
    create table missions (
      id text primary key,
      organization_id text not null,
      status text not null
    );
    create table mission_links (
      id text primary key,
      organization_id text not null,
      mission_id text not null,
      task_id text not null,
      linked_by text not null,
      created_at timestamptz not null default now(),
      unique (organization_id, mission_id, task_id)
    );
    insert into organizations (id) values ('org_a'), ('org_b');
    insert into projects (id, organization_id, name) values
      ('prj_a', 'org_a', 'Ledger'), ('prj_b', 'org_b', 'Other');
    insert into tasks (id, organization_id, project_id, objective, state) values
      ('tsk_a', 'org_a', 'prj_a', 'Write the page', 'DRAFT'),
      ('tsk_b', 'org_b', 'prj_b', 'Other work', 'READY');
    insert into missions (id, organization_id, status) values
      ('msn_a', 'org_a', 'PLANNED'), ('msn_b', 'org_b', 'PLANNED');
  `);
  return { db, sql: wrap(db) };
}

test("an agent or a non-owner cannot create the link", () => {
  assert.throws(() => requireOwner("operator"), CompanyError);
  assert.throws(() => requireOwner("reviewer"), CompanyError);
  assert.equal(requireOwner("owner"), undefined);
});

test("a link stays inside one company and does not move the task or the mission", async () => {
  const { db, sql } = await database();
  await assert.rejects(
    linkTaskToMission(sql, { orgId: "org_a", missionId: "msn_a", taskId: "tsk_b", actorId: "user_a", linkId: "lnk_1" }),
    /not in this company/,
  );
  await assert.rejects(
    linkTaskToMission(sql, { orgId: "org_a", missionId: "msn_a", taskId: "tsk_a", actorId: "svc:nexus", linkId: "lnk_2" }),
    /agent cannot link/,
  );
  assert.equal(
    await linkTaskToMission(sql, { orgId: "org_a", missionId: "msn_a", taskId: "tsk_a", actorId: "user_a", linkId: "lnk_3" }),
    "created",
  );
  assert.equal(
    await linkTaskToMission(sql, { orgId: "org_a", missionId: "msn_a", taskId: "tsk_a", actorId: "user_a", linkId: "lnk_4" }),
    "exists",
  );
  const links = await db.query<{ n: number }>("select count(*)::int as n from mission_links");
  assert.equal(links.rows[0]?.n, 1);

  await db.exec("update tasks set state = 'COMPLETED' where id = 'tsk_a'");
  const mission = await db.query<{ status: string }>("select status from missions where id = 'msn_a'");
  assert.equal(mission.rows[0]?.status, "PLANNED");
  await db.exec("update missions set status = 'AUTHORIZED' where id = 'msn_a'");
  const task = await db.query<{ state: string }>("select state from tasks where id = 'tsk_a'");
  assert.equal(task.rows[0]?.state, "COMPLETED");

  const shown = await missionTaskLinks(sql, "org_a", "msn_a");
  assert.equal(shown[0]?.projectName, "Ledger");
  assert.equal(await missionTaskLinks(sql, "org_b", "msn_b").then((rows) => rows.length), 0);

  await unlinkTaskFromMission(sql, { orgId: "org_a", missionId: "msn_a", taskId: "tsk_a", actorId: "user_a" });
  const left = await db.query<{ projects: number; tasks: number; missions: number; links: number }>(`
    select
      (select count(*)::int from projects) as projects,
      (select count(*)::int from tasks) as tasks,
      (select count(*)::int from missions) as missions,
      (select count(*)::int from mission_links) as links
  `);
  assert.deepEqual(left.rows[0], { projects: 2, tasks: 2, missions: 2, links: 0 });
  await db.close();
});
