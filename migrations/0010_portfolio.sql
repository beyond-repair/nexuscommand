-- Portfolio, findings, handoffs, and knowledge reuse. Additive.

alter table missions add column if not exists parent_id text;
alter table missions add column if not exists priority integer not null default 50;
alter table missions add column if not exists milestone text not null default '';

alter table missions drop constraint if exists missions_priority_check;
alter table missions add constraint missions_priority_check check (priority between 0 and 100);

create index if not exists missions_parent_idx on missions (parent_id);

create table if not exists portfolio_limits (
  organization_id text primary key references organizations (id),
  max_concurrent integer not null default 1 check (max_concurrent between 1 and 8),
  updated_at timestamptz not null default now()
);

create table if not exists findings (
  id text primary key,
  organization_id text not null references organizations (id),
  mission_id text,
  finding_key text not null,
  severity text not null check (severity in ('info', 'watch', 'blocking')),
  title text not null,
  evidence text not null,
  recommendation text not null,
  confidence text not null check (confidence in ('recorded', 'inferred')),
  owner_required boolean not null default false,
  status text not null check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists findings_open_key on findings (organization_id, finding_key) where status = 'open';

create table if not exists handoffs (
  id text primary key,
  organization_id text not null,
  mission_id text not null,
  from_department text not null,
  to_department text not null,
  from_assignment text not null,
  to_assignment text not null,
  completed text not null,
  outstanding text not null,
  risks text not null default '',
  criteria text not null,
  created_at timestamptz not null default now()
);

create index if not exists handoffs_mission_idx on handoffs (mission_id, created_at desc);

create table if not exists knowledge_uses (
  id text primary key,
  organization_id text not null,
  knowledge_id text not null,
  mission_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_uses_org_idx on knowledge_uses (organization_id, created_at desc);
