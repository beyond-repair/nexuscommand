-- Cost records, requirement keys, and the external-world boundary.
-- A registry row is not a live connection. No price is invented.

create table if not exists cost_policy (
  organization_id text primary key references organizations (id),
  unknown_cost text not null default 'record_unknown' check (unknown_cost in ('record_unknown', 'refuse'))
);

create table if not exists provider_prices (
  id text primary key,
  organization_id text not null references organizations (id),
  provider text not null,
  model text not null,
  version integer not null check (version >= 1),
  input_cents_per_million integer,
  output_cents_per_million integer,
  cached_cents_per_million integer,
  currency text not null default 'USD',
  source text not null check (source in ('owner', 'contract', 'official')),
  source_note text not null default '',
  status text not null check (status in ('verified', 'unverified', 'expired')),
  effective_at timestamptz not null default now(),
  review_at timestamptz not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists provider_prices_lookup_idx on provider_prices (organization_id, provider, model, version desc);

create table if not exists cost_records (
  id text primary key,
  organization_id text not null references organizations (id),
  mission_id text,
  department_slug text not null default '',
  execution_id text not null default '',
  provider text not null,
  model text not null,
  pricing_id text,
  pricing_version integer,
  kind text not null check (kind in ('estimate', 'reservation', 'actual', 'reconciled', 'unknown')),
  cents integer,
  currency text not null default 'USD',
  input_tokens integer,
  output_tokens integer,
  cached_tokens integer,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists cost_records_org_idx on cost_records (organization_id, created_at desc);

create table if not exists requirements (
  id text primary key,
  organization_id text not null references organizations (id),
  mission_id text not null,
  specification_id text not null,
  spec_version integer not null,
  requirement_key text not null,
  body text not null,
  criteria text not null default '',
  change text not null check (change in ('added', 'removed', 'modified', 'unchanged', 'ambiguous')),
  prior_key text,
  acceptance text not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists requirements_spec_idx on requirements (specification_id);

create table if not exists requirement_links (
  id text primary key,
  organization_id text not null references organizations (id),
  requirement_key text not null,
  specification_id text not null,
  assignment_id text not null,
  artifact_sha256 text not null,
  execution_id text not null,
  result text not null,
  created_at timestamptz not null default now()
);

create table if not exists integrations (
  id text primary key,
  organization_id text not null references organizations (id),
  name text not null,
  provider text not null,
  category text not null,
  status text not null check (status in ('unverified', 'verified', 'revoked')),
  auth_method text not null default 'none',
  scopes text not null default '',
  classification text not null default 'internal',
  rate_limit integer not null default 30,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists integration_secrets (
  integration_id text primary key,
  organization_id text not null references organizations (id),
  cipher text not null,
  nonce text not null,
  tag text not null,
  hint text not null,
  expires_at timestamptz,
  revoked_at timestamptz
);

create table if not exists external_actions (
  id text primary key,
  organization_id text not null references organizations (id),
  integration_id text not null,
  operation text not null,
  action_class integer not null,
  idempotency_key text not null,
  status text not null,
  reason text not null,
  result text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table if not exists external_events (
  id text primary key,
  organization_id text not null references organizations (id),
  nonce text not null,
  event_key text not null,
  body_hash text not null,
  received_at timestamptz not null default now(),
  unique (organization_id, nonce),
  unique (organization_id, event_key)
);

create table if not exists devices (
  id text primary key,
  organization_id text not null references organizations (id),
  name text not null,
  permission text not null check (permission in ('read', 'control')),
  connected boolean not null default false,
  emergency_stop boolean not null default false,
  safe_state text not null default 'held',
  created_at timestamptz not null default now()
);

create table if not exists device_commands (
  id text primary key,
  organization_id text not null references organizations (id),
  device_id text not null,
  operation text not null,
  status text not null,
  reason text not null,
  claimed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists observations (
  id text primary key,
  organization_id text not null references organizations (id),
  mission_id text,
  source text not null,
  reference text not null,
  body text not null,
  content_sha256 text not null,
  classification text not null,
  status text not null default 'observed',
  created_at timestamptz not null default now()
);
