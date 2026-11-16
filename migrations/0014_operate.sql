-- Derived trace and maintenance. These rows do not authorize work or spend money.

create table if not exists trace_links (
  id text primary key,
  organization_id text not null references organizations (id),
  mission_id text not null,
  specification_id text,
  requirement_key text not null,
  assignment_id text,
  execution_id text not null default '',
  artifact_sha256 text not null default '',
  qa_report_id text,
  qa_passed boolean,
  accepted boolean not null default false,
  complete boolean not null default false,
  project_id text,
  task_id text,
  reason text not null default '',
  updated_at timestamptz not null default now(),
  unique (organization_id, mission_id, requirement_key, specification_id)
);

create table if not exists maintenance_actions (
  id text primary key,
  organization_id text not null references organizations (id),
  action_key text not null,
  kind text not null,
  risk text not null check (risk in ('low', 'high')),
  autonomous boolean not null,
  status text not null check (status in ('proposed', 'applied', 'refused', 'cleared')),
  title text not null,
  evidence text not null,
  result text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, action_key)
);

create table if not exists metric_snapshots (
  id text primary key,
  organization_id text not null references organizations (id),
  name text not null,
  sample integer not null,
  value integer,
  kind text not null check (kind in ('measured', 'unavailable')),
  unit text not null,
  note text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);
