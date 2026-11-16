-- Delivery records for committed work. An event does not authorize, accept, or spend.

create table if not exists outbox_events (
  id text primary key,
  organization_id text not null references organizations (id),
  event_type text not null,
  schema_version integer not null default 1,
  correlation_id text not null default '',
  causation_id text not null default '',
  idempotency_key text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_id text not null,
  status text not null check (status in ('pending', 'processing', 'completed', 'failed', 'dead')),
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

create index if not exists outbox_events_ready_idx on outbox_events (organization_id, status, available_at, created_at);

create table if not exists outbox_deliveries (
  event_id text primary key references outbox_events (id),
  organization_id text not null,
  effect text not null,
  created_at timestamptz not null default now()
);
