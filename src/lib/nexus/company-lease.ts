import { CompanyError } from "./company.ts";
import { LEASE_SECONDS, nextStatus, retryDelayMs } from "./execution.ts";
import type { Sql } from "./company-store.ts";

export async function atomically<T>(sql: Sql, run: (tx: Sql) => Promise<T>): Promise<T> {
  if (sql.transaction) return sql.transaction(run);
  return run(sql);
}

export async function claimLease(
  sql: Sql,
  input: { orgId: string; missionId: string; assignmentId: string; fence: string; jobId: string },
): Promise<{ attempt: number }> {
  return atomically(sql, async (tx) => {
    const latest = await tx<{ status: string; attempt: unknown; wait: unknown }>`
      select status, attempt, (leased_until > now()) as wait
      from execution_jobs where assignment_id = ${input.assignmentId}
      order by created_at desc limit 1`;
    const row = latest[0];
    if (row?.status === "dead") {
      throw new CompanyError("This department is in the dead letter. Send it back before it can run.");
    }
    const waiting = row?.wait === true || row?.wait === "t" || row?.wait === "true" || row?.wait === 1;
    if (row?.status === "retry" && waiting) {
      throw new CompanyError("This department is waiting out its retry.");
    }
    const continuing = row?.status === "retry";
    const attempt = continuing ? Number(row?.attempt ?? 0) + 1 : 1;
    const locked = await tx<{ id: string }>`update assignments
      set status = ${"RUNNING"}, error = ${""}, model = ${""}, run_token = ${input.fence}, updated_at = now()
      where id = ${input.assignmentId} and organization_id = ${input.orgId}
        and status in ('QUEUED', 'READY', 'FAILED')
      returning id`;
    if (!locked[0]) throw new CompanyError("That assignment changed. Reload and try again.");
    await tx`insert into execution_jobs (
      id, organization_id, mission_id, assignment_id, fence, status, attempt, max_attempts, leased_until
    ) values (
      ${input.jobId}, ${input.orgId}, ${input.missionId}, ${input.assignmentId}, ${input.fence},
      ${"leased"}, ${attempt}, ${3}, now() + (${LEASE_SECONDS} * interval '1 second')
    )`;
    return { attempt };
  });
}

export async function renewLease(sql: Sql, fence: string): Promise<boolean> {
  const rows = await sql<{ id: string }>`update execution_jobs
    set leased_until = now() + (${LEASE_SECONDS} * interval '1 second'), updated_at = now()
    where fence = ${fence} and status = ${"leased"} and leased_until > now()
    returning id`;
  return Boolean(rows[0]);
}

/** Writes only while this fence still owns an unexpired lease. */
export async function commitLease<T>(sql: Sql, fence: string, write: (tx: Sql) => Promise<T | null>): Promise<T | null> {
  return atomically(sql, async (tx) => {
    const owned = await tx<{ id: string }>`select id from execution_jobs
      where fence = ${fence} and status = ${"leased"} and leased_until > now()`;
    if (!owned[0]) return null;
    const written = await write(tx);
    if (written == null) return null;
    await tx`update execution_jobs set status = ${"done"}, last_error = ${""}, updated_at = now()
      where fence = ${fence} and status = ${"leased"}`;
    return written;
  });
}

export async function failLease(sql: Sql, fence: string, message: string): Promise<"retry" | "dead" | "lost"> {
  return atomically(sql, async (tx) => {
    const rows = await tx<{ attempt: unknown; max_attempts: unknown; assignment_id: string }>`
      select attempt, max_attempts, assignment_id from execution_jobs
      where fence = ${fence} and status = ${"leased"}`;
    const job = rows[0];
    if (!job) return "lost";
    const attempt = Number(job.attempt);
    const outcome = nextStatus(attempt, Number(job.max_attempts) || 3);
    const error = message.slice(0, 500);
    if (outcome === "dead") {
      await tx`update execution_jobs set status = ${"dead"}, last_error = ${error}, updated_at = now()
        where fence = ${fence} and status = ${"leased"}`;
      await tx`update assignments set status = ${"FAILED"}, error = ${error}, run_token = ${""}, updated_at = now()
        where id = ${job.assignment_id} and status = ${"RUNNING"} and run_token = ${fence}`;
      return "dead";
    }
    const delaySeconds = Math.max(1, Math.ceil(retryDelayMs(attempt) / 1000));
    await tx`update execution_jobs
      set status = ${"retry"}, last_error = ${error}, leased_until = now() + (${delaySeconds} * interval '1 second'), updated_at = now()
      where fence = ${fence} and status = ${"leased"}`;
    await tx`update assignments set status = ${"READY"}, error = ${error}, model = ${""}, run_token = ${""}, updated_at = now()
      where id = ${job.assignment_id} and status = ${"RUNNING"} and run_token = ${fence}`;
    return "retry";
  });
}

export async function expireLeases(sql: Sql, missionId?: string): Promise<number> {
  return atomically(sql, async (tx) => {
    const rows = missionId
      ? await tx<{ fence: string; assignment_id: string }>`update execution_jobs
          set status = ${"expired"}, updated_at = now()
          where status = ${"leased"} and leased_until < now() and mission_id = ${missionId}
          returning fence, assignment_id`
      : await tx<{ fence: string; assignment_id: string }>`update execution_jobs
          set status = ${"expired"}, updated_at = now()
          where status = ${"leased"} and leased_until < now()
          returning fence, assignment_id`;
    for (const row of rows) {
      await tx`update assignments
        set status = ${"READY"}, model = ${""}, run_token = ${""},
            error = ${"The lease expired before the run could save."}, updated_at = now()
        where id = ${row.assignment_id} and status = ${"RUNNING"} and run_token = ${row.fence}`;
    }
    return rows.length;
  });
}

export async function cancelLeases(sql: Sql, missionId: string): Promise<void> {
  await sql`update execution_jobs set status = ${"cancelled"}, updated_at = now()
    where mission_id = ${missionId} and status in ('leased', 'retry', 'dead')`;
}
