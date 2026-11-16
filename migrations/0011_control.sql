-- Specification versions, revalidation, budgets, and dispatch outcomes. Additive.

create table if not exists specifications (
  id text primary key,
  organization_id text not null references organizations (id),
  mission_id text not null,
  version integer not null check (version >= 1),
  content_sha256 text not null,
  body text not null,
  state text not null check (state in ('proposed', 'accepted', 'superseded', 'withdrawn')),
  author text not null,
  approved_by text,
  accepted_at timestamptz,
  supersedes text,
  created_at timestamptz not null default now(),
  unique (mission_id, version)
);

create index if not exists specifications_mission_idx on specifications (mission_id, version desc);

create table if not exists spec_impacts (
  id text primary key,
  organization_id text not null references organizations (id),
  mission_id text not null,
  specification_id text not null,
  prior_specification_id text,
  added jsonb not null,
  removed jsonb not null,
  affected_assignments jsonb not null,
  untouched_assignments jsonb not null,
  affected_departments jsonb not null,
  revalidation text not null,
  created_at timestamptz not null default now()
);

create index if not exists spec_impacts_mission_idx on spec_impacts (mission_id, created_at desc);

create table if not exists revalidations (
  id text primary key,
  organization_id text not null references organizations (id),
  mission_id text not null,
  assignment_id text not null,
  specification_id text not null,
  spec_version integer not null,
  state text not null,
  deliverable_sha256 text not null default '',
  qa_execution_id text not null default '',
  suite text not null default '',
  result text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists revalidations_mission_idx on revalidations (mission_id, updated_at desc);

alter table portfolio_limits add column if not exists spending_ceiling_cents integer;
alter table missions add column if not exists budget_cents integer;

create table if not exists department_budgets (
  organization_id text not null references organizations (id),
  department_slug text not null,
  amount_cents integer not null check (amount_cents >= 0),
  primary key (organization_id, department_slug)
);

create table if not exists commitments (
  id text primary key,
  organization_id text not null references organizations (id),
  mission_id text,
  department_slug text not null default '',
  amount_cents integer not null check (amount_cents > 0),
  kind text not null check (kind in ('reserved', 'estimate')),
  note text not null default '',
  status text not null check (status in ('open', 'released', 'converted')),
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists commitments_org_idx on commitments (organization_id, status);

alter table payments add column if not exists department_slug text not null default '';

alter table model_dispatches add column if not exists outcome text not null default 'unspecified';
alter table model_dispatches add column if not exists duration_ms integer;
alter table model_dispatches add column if not exists error_category text not null default '';

alter table model_dispatches drop constraint if exists model_dispatches_outcome_check;
alter table model_dispatches add constraint model_dispatches_outcome_check
  check (outcome in ('succeeded', 'failed', 'timeout', 'withheld', 'unspecified'));
