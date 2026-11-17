import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CompanyError } from "./company.ts";
import type { Sql } from "./company-store.ts";
import {
  addContact,
  assignRole,
  createParty,
  deactivateRole,
  getParty,
  listPartiesByRole,
} from "./party.ts";

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
    create table parties (
      id text primary key,
      organization_id text not null,
      kind text not null,
      display_name text not null,
      status text not null default 'active',
      created_at timestamptz not null default now(),
      created_by text not null
    );
    create table party_roles (
      id text primary key,
      organization_id text not null,
      party_id text not null,
      role text not null,
      status text not null default 'active',
      assigned_at timestamptz not null default now(),
      assigned_by text not null,
      unique (organization_id, party_id, role)
    );
    create table party_contacts (
      id text primary key,
      organization_id text not null,
      party_id text not null,
      label text not null,
      value text not null,
      status text not null default 'active',
      created_at timestamptz not null default now(),
      created_by text not null
    );
    insert into organizations (id) values ('org_a'), ('org_b');
  `);
  return { db, sql: wrap(db) };
}

test("a party is created inside one company and can hold multiple roles", async () => {
  const { sql } = await database();
  const party = await createParty(sql, {
    orgId: "org_a",
    partyId: "pty_1",
    kind: "person",
    displayName: "Ada",
    actorId: "user_a",
  });
  assert.equal(party.displayName, "Ada");
  assert.equal(party.organizationId, "org_a");

  assert.equal(
    await assignRole(sql, { orgId: "org_a", partyId: "pty_1", roleId: "rol_1", role: "customer", actorId: "user_a" }),
    "created",
  );
  assert.equal(
    await assignRole(sql, { orgId: "org_a", partyId: "pty_1", roleId: "rol_2", role: "supplier", actorId: "user_a" }),
    "created",
  );
  assert.equal(
    await assignRole(sql, { orgId: "org_a", partyId: "pty_1", roleId: "rol_3", role: "customer", actorId: "user_a" }),
    "exists",
  );

  const customers = await listPartiesByRole(sql, "org_a", "customer");
  assert.equal(customers.length, 1);
  assert.equal(customers[0].id, "pty_1");

  const suppliers = await listPartiesByRole(sql, "org_a", "supplier");
  assert.equal(suppliers.length, 1);
});

test("cross-organization operations are refused and leave no residue", async () => {
  const { sql } = await database();
  await createParty(sql, { orgId: "org_a", partyId: "pty_a", kind: "person", displayName: "Ada", actorId: "user_a" });

  await assert.rejects(
    assignRole(sql, { orgId: "org_b", partyId: "pty_a", roleId: "rol_x", role: "customer", actorId: "user_b" }),
    /not in this company/,
  );
  await assert.rejects(
    addContact(sql, { orgId: "org_b", partyId: "pty_a", contactId: "cnt_x", label: "email", value: "a@example.com", actorId: "user_b" }),
    /not in this company/,
  );
  const cross = await getParty(sql, "org_b", "pty_a");
  assert.equal(cross, null);

  const same = await getParty(sql, "org_a", "pty_a");
  assert.equal(same?.displayName, "Ada");
});

test("deactivating a role leaves the party and history intact", async () => {
  const { sql } = await database();
  await createParty(sql, { orgId: "org_a", partyId: "pty_1", kind: "person", displayName: "Ada", actorId: "user_a" });
  await assignRole(sql, { orgId: "org_a", partyId: "pty_1", roleId: "rol_1", role: "customer", actorId: "user_a" });
  await addContact(sql, { orgId: "org_a", partyId: "pty_1", contactId: "cnt_1", label: "email", value: "ada@example.com", actorId: "user_a" });

  await deactivateRole(sql, { orgId: "org_a", partyId: "pty_1", role: "customer", actorId: "user_a" });

  const active = await listPartiesByRole(sql, "org_a", "customer");
  assert.equal(active.length, 0);

  const party = await getParty(sql, "org_a", "pty_1");
  assert.equal(party?.status, "active");
  assert.equal(party?.displayName, "Ada");
});

test("agents cannot create parties or assign roles", async () => {
  const { sql } = await database();
  await assert.rejects(
    createParty(sql, { orgId: "org_a", partyId: "pty_x", kind: "person", displayName: "X", actorId: "svc:nexus" }),
    /agent cannot create/,
  );
  await assert.rejects(
    assignRole(sql, { orgId: "org_a", partyId: "pty_1", roleId: "rol_x", role: "customer", actorId: "svc:nexus" }),
    /agent cannot assign/,
  );
});
