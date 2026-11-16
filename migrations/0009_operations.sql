-- Scheduler, classification, and verification binding. Additive.

alter table missions add column if not exists classification text not null default 'internal';

alter table missions drop constraint if exists missions_classification_check;
alter table missions add constraint missions_classification_check
  check (classification in ('internal', 'confidential'));

create table if not exists scheduler_state (
  organization_id text primary key references organizations (id),
  status text not null check (status in ('running', 'paused', 'stopped')),
  last_tick_at timestamptz,
  tick_lock_until timestamptz,
  last_error text not null default '',
  updated_at timestamptz not null default now()
);

alter table qa_reports add column if not exists execution_id text not null default '';
alter table qa_reports add column if not exists suite text not null default '';
alter table qa_reports add column if not exists sandbox jsonb not null default '{}'::jsonb;

create table if not exists model_dispatches (
  id text primary key,
  organization_id text not null references organizations (id),
  mission_id text not null references missions (id),
  execution_id text not null,
  provider text not null,
  model text not null,
  classification text not null,
  disclosure text not null,
  created_at timestamptz not null default now()
);

create index if not exists model_dispatches_org_idx on model_dispatches (organization_id, created_at desc);
