import { randomBytes } from "node:crypto";
import { atomically } from "./company-lease.ts";
import type { Sql } from "./company-store.ts";

export class OutboxRefusal extends Error {
  readonly errorClass = "refused";
}

export function retryDelaySeconds(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) return 2;
  return Math.min(60, 2 ** Math.min(attempt, 6));
}

export function failureStatus(attempt: number, maxAttempts: number, refused: boolean): "dead" | "failed" {
  if (refused || attempt >= maxAttempts) return "dead";
  return "failed";
}

export function mayCommitEvent(input: { heldFence: string; workerFence: string; leaseUntilMs: number; nowMs: number }): boolean {
  return input.heldFence !== "" && input.heldFence === input.workerFence && input.leaseUntilMs > input.nowMs;
}

type EventRow = {
  id: string;
  organization_id: string;
  event_type: string;
  aggregate_id: string;
  schema_version: unknown;
  payload: unknown;
  attempt: unknown;
  max_attempts: unknown;
  lease_fence: string;
};

function eventId(): string {
  return `obx_${randomBytes(9).toString("hex")}`;
}

function readPayload(value: unknown): { effect?: string; summary?: string } {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as { effect?: string; summary?: string };
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object") return value as { effect?: string; summary?: string };
  return {};
}

export async function enqueueOutbox(sql: Sql, input: {
  orgId: string;
  eventType: string;
  idempotencyKey: string;
  correlationId: string;
  causationId: string;
  aggregateType: string;
  aggregateId: string;
  actorId: string;
  summary: string;
}): Promise<void> {
  if (!input.idempotencyKey || !input.eventType) throw new OutboxRefusal("An outbox event needs a type and an idempotency key.");
  const payload = { effect: "record" as const, summary: input.summary.slice(0, 500) };
  await sql`insert into outbox_events (
    id, organization_id, event_type, schema_version, correlation_id, causation_id, idempotency_key,
    aggregate_type, aggregate_id, payload, actor_id, status
  ) values (
    ${eventId()}, ${input.orgId}, ${input.eventType}, ${1}, ${input.correlationId}, ${input.causationId}, ${input.idempotencyKey},
    ${input.aggregateType}, ${input.aggregateId}, ${JSON.stringify(payload)}::jsonb, ${input.actorId}, ${"pending"}
  ) on conflict (organization_id, idempotency_key) do nothing`;
}

async function claimOutbox(sql: Sql, orgId: string, fence: string): Promise<EventRow | null> {
  const rows = await sql<EventRow>`update outbox_events set
      status = ${"processing"}, attempt = attempt + 1, lease_fence = ${fence},
      leased_until = now() + interval '30 seconds', updated_at = now()
    where id = (
      select e.id from outbox_events e
      where e.organization_id = ${orgId}
        and e.status in ('pending', 'failed')
        and e.available_at <= now()
        and not exists (
          select 1 from outbox_events earlier
          where earlier.organization_id = e.organization_id
            and earlier.aggregate_id = e.aggregate_id
            and earlier.id <> e.id
            and (earlier.created_at < e.created_at or (earlier.created_at = e.created_at and earlier.id < e.id))
            and earlier.status in ('pending', 'processing', 'failed')
        )
      order by e.created_at asc
      for update skip locked
      limit 1
    ) and status in ('pending', 'failed')
    returning id, organization_id, event_type, aggregate_id, schema_version, payload, attempt, max_attempts, lease_fence`;
  return rows[0] ?? null;
}

async function applyOutbox(sql: Sql, event: EventRow): Promise<void> {
  const payload = readPayload(event.payload);
  if (Number(event.schema_version) !== 1 || payload.effect !== "record") {
    throw new OutboxRefusal("This event schema is not supported, or it would change authority. It was not applied.");
  }
  await sql`insert into outbox_deliveries (event_id, organization_id, effect)
    values (${event.id}, ${event.organization_id}, ${"recorded"})
    on conflict (event_id) do nothing`;
}

export async function completeOutbox(sql: Sql, eventId: string, fence: string): Promise<boolean> {
  const rows = await sql<{ id: string }>`update outbox_events set
      status = ${"completed"}, completed_at = now(), lease_fence = ${""}, last_error = ${""}, error_class = ${""}, updated_at = now()
    where id = ${eventId} and lease_fence = ${fence} and status = ${"processing"} and leased_until > now()
    returning id`;
  return Boolean(rows[0]);
}

async function failOutbox(sql: Sql, event: EventRow, fence: string, error: unknown): Promise<void> {
  const refused = error instanceof OutboxRefusal;
  const attempt = Number(event.attempt) || 1;
  const maxAttempts = Number(event.max_attempts) || 5;
  const status = failureStatus(attempt, maxAttempts, refused);
  const message = error instanceof Error ? error.message.slice(0, 500) : "The event failed.";
  const errorClass = refused ? "refused" : "failed";
  const delay = retryDelaySeconds(attempt);
  await sql`update outbox_events set
      status = ${status},
      lease_fence = ${""},
      last_error = ${message},
      error_class = ${errorClass},
      available_at = now() + (${delay} * interval '1 second'),
      updated_at = now()
    where id = ${event.id} and lease_fence = ${fence} and status = ${"processing"}`;
}

export async function recoverExpiredOutbox(sql: Sql, orgId: string): Promise<number> {
  const rows = await sql<{ id: string }>`update outbox_events set
      status = case when attempt >= max_attempts then ${"dead"} else ${"failed"} end,
      lease_fence = ${""},
      last_error = ${"The processing lease expired before the delivery was recorded."},
      error_class = ${"expired"},
      available_at = now(),
      updated_at = now()
    where organization_id = ${orgId} and status = ${"processing"} and leased_until < now()
    returning id`;
  return rows.length;
}

export async function processOutbox(sql: Sql, orgId: string, limit = 20): Promise<number> {
  let completed = 0;
  for (let index = 0; index < limit; index += 1) {
    const fence = eventId();
    const claimed = await claimOutbox(sql, orgId, fence);
    if (!claimed) break;
    try {
      const saved = await atomically(sql, async (tx) => {
        await applyOutbox(tx, claimed);
        return completeOutbox(tx, claimed.id, fence);
      });
      if (!saved) throw new Error("The processing fence no longer owns this event.");
      completed += 1;
    } catch (error) {
      await failOutbox(sql, claimed, fence, error);
    }
  }
  return completed;
}

export async function outboxSnapshot(sql: Sql, orgId: string): Promise<{
  pending: number;
  processing: number;
  failed: number;
  dead: number;
  completed: number;
  oldestSeconds: number | null;
}> {
  const rows = await sql<{ status: string; count: unknown; oldest: unknown }>`select status, count(*)::int as count,
      extract(epoch from (now() - min(created_at))) as oldest
    from outbox_events where organization_id = ${orgId}
    group by status`;
  const count = (status: string) => Number(rows.find((row) => row.status === status)?.count ?? 0);
  const waiting = rows.filter((row) => row.status === "pending" || row.status === "processing" || row.status === "failed");
  const oldest = waiting.reduce((min, row) => {
    const value = Number(row.oldest);
    return Number.isFinite(value) ? Math.min(min, value) : min;
  }, Number.POSITIVE_INFINITY);
  return {
    pending: count("pending"),
    processing: count("processing"),
    failed: count("failed"),
    dead: count("dead"),
    completed: count("completed"),
    oldestSeconds: oldest === Number.POSITIVE_INFINITY ? null : Math.max(0, Math.round(oldest)),
  };
}
