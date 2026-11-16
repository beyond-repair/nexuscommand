-- An owner may point a mission at an existing task. The link does not move either record.

create table if not exists mission_links (
  id text primary key,
  organization_id text not null references organizations (id),
  mission_id text not null references missions (id),
  task_id text not null references tasks (id),
  linked_by text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, mission_id, task_id)
);

create index if not exists mission_links_task_idx on mission_links (organization_id, task_id);
