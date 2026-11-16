import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyTransition } from "./mission-state.ts";
import type { Sql } from "./company-store.ts";

test("a failed write leaves the in-memory mission status unchanged", () => {
  const mission = { status: "PLANNED" };
  assert.throws(() => applyTransition(mission, "AUTHORIZED", () => {
    throw new Error("rollback");
  }), /rollback/);
  assert.equal(mission.status, "PLANNED");
});

test("the in-memory status changes only after the write returns", () => {
  const mission = { status: "PLANNED" };
  let seen = "";
  applyTransition(mission, "AUTHORIZED", () => {
    seen = mission.status;
  });
  assert.equal(seen, "PLANNED");
  assert.equal(mission.status, "AUTHORIZED");
});

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

test("a rolled-back status write leaves the stored mission unchanged", async () => {
  const db = new PGlite();
  await db.exec(`create table missions (id text primary key, organization_id text, status text);
    insert into missions (id, organization_id, status) values ('mis_1', 'org_a', 'PLANNED');`);
  const sql = wrap(db);
  const mission = { status: "PLANNED" };
  const transaction = sql.transaction;
  if (!transaction) throw new Error("The test database has no transaction.");
  await assert.rejects(() => transaction(async (tx) => {
    applyTransition(mission, "AUTHORIZED", () => {
      throw new Error("audit failed");
    });
    await tx`update missions set status = ${"AUTHORIZED"} where id = ${"mis_1"} and status = ${"PLANNED"}`;
  }));
  assert.equal(mission.status, "PLANNED");
  const stored = await db.query<{ status: string }>("select status from missions");
  assert.equal(stored.rows[0]?.status, "PLANNED");
  await db.close();
});
