import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { syncFindings, type Sql } from "./company-store.ts";

function wrap(db: PGlite): Sql {
  return (async <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> => {
    let text = strings[0] ?? "";
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
    const result = await db.query<T>(text, values);
    return result.rows;
  }) as Sql;
}

test("a blocked dependency is stored as a finding and clears when the dependency is accepted", async () => {
  const db = new PGlite();
  await db.exec(`
    create table organizations (id text primary key);
    insert into organizations (id) values ('org_a');
    create table missions (
      id text primary key,
      organization_id text not null references organizations (id),
      title text not null,
      status text not null,
      priority integer not null default 50,
      parent_id text,
      depends_on text,
      updated_at timestamptz not null default now()
    );
    create table assignments (
      id text primary key,
      mission_id text not null,
      organization_id text not null,
      status text not null
    );
    create table defects (
      id text primary key,
      mission_id text not null,
      status text not null
    );
    create table execution_jobs (
      id text primary key,
      mission_id text not null,
      attempt integer not null
    );
    create table knowledge_entries (
      id text primary key,
      organization_id text not null,
      title text not null,
      state text not null,
      confidence text not null
    );
    create table findings (
      id text primary key,
      organization_id text not null references organizations (id),
      mission_id text,
      finding_key text not null,
      severity text not null,
      title text not null,
      evidence text not null,
      recommendation text not null,
      confidence text not null,
      owner_required boolean not null default false,
      status text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    insert into missions (id, organization_id, title, status) values
      ('msn_dep', 'org_a', 'Pricing', 'PLANNED'),
      ('msn_go', 'org_a', 'Desk', 'AUTHORIZED');
    update missions set depends_on = 'msn_dep' where id = 'msn_go';
  `);
  const sql = wrap(db);
  const open = await syncFindings(sql, "org_a");
  assert.equal(open.some((item) => item.title === "A dependency is not accepted" && item.confidence === "recorded"), true);
  await db.exec("update missions set status = 'ACCEPTED' where id = 'msn_dep'");
  const cleared = await syncFindings(sql, "org_a");
  assert.equal(cleared.some((item) => item.title === "A dependency is not accepted"), false);
  const resolved = await db.query<{ status: string }>("select status from findings where finding_key = 'depend:msn_go'");
  assert.equal(resolved.rows[0]?.status, "resolved");
  await db.close();
});
