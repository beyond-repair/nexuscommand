-- Leases, QA evidence, knowledge provenance, and ownership constraints.
-- Additive. Existing rows stay.

alter table organizations add column if not exists model_disclosure text not null default 'public';

alter table missions add column if not exists depends_on text;

alter table knowledge_entries add column if not exists version integer not null default 1;
alter table knowledge_entries add column if not exists state text not null default 'proposed';
alter table knowledge_entries add column if not exists confidence text not null default 'stated';
alter table knowledge_entries add column if not exists supersedes text;
alter table knowledge_entries add column if not exists evidence_ref text not null default '';

update knowledge_entries set state = 'accepted' where verified = true and state = 'proposed';

create table if not exists execution_jobs (
  id text primary key,
  organization_id text not null references organizations (id),
  mission_id text not null references missions (id),
  assignment_id text not null references assignments (id),
  fence text not null unique,
  status text not null check (status in ('leased', 'done', 'retry', 'dead', 'cancelled', 'expired')),
  attempt integer not null check (attempt >= 1),
  max_attempts integer not null default 3,
  leased_until timestamptz not null,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists execution_jobs_assignment_idx on execution_jobs (assignment_id, created_at desc);
create index if not exists execution_jobs_org_status_idx on execution_jobs (organization_id, status);

create table if not exists qa_reports (
  id text primary key,
  organization_id text not null references organizations (id),
  mission_id text not null references missions (id),
  assignment_id text not null,
  artifact_sha256 text not null,
  status text not null check (status in ('passed', 'failed')),
  report jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists qa_reports_mission_idx on qa_reports (mission_id, created_at desc);

create index if not exists assignments_org_idx on assignments (organization_id, status);
create index if not exists defects_org_idx on defects (organization_id, status);

delete from defects a
using defects b
where a.mission_id = b.mission_id
  and a.check_name = b.check_name
  and a.status = 'open'
  and b.status = 'open'
  and a.id > b.id;

create unique index if not exists defects_open_unique on defects (mission_id, check_name) where status = 'open';
