-- GitHub is the first external connector. A row is not a connection.
-- The token is stored only after GitHub lists read-only scopes, and only as ciphertext.

create table if not exists github_connections (
  id text primary key,
  organization_id text not null references organizations (id),
  integration_id text not null,
  status text not null check (status in (
    'unverified', 'configuration_required', 'authentication_pending', 'connected',
    'authentication_failed', 'revoked', 'disconnected'
  )),
  account_login text not null default '',
  account_id text not null default '',
  scopes text not null default '',
  allowed_repos text not null default '',
  rate_remaining text not null default '',
  rate_reset text not null default '',
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure text not null default '',
  last_sync_at timestamptz,
  poll_minutes integer not null default 60,
  credential_hint text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists github_connections_org_idx on github_connections (organization_id, updated_at desc);

create table if not exists github_repos (
  id text primary key,
  organization_id text not null references organizations (id),
  connection_id text not null,
  owner_name text not null,
  repo_name text not null,
  external_id text not null,
  private boolean not null default false,
  default_branch text not null default '',
  updated_at timestamptz not null default now(),
  unique (connection_id, external_id)
);

create table if not exists github_reads (
  id text primary key,
  organization_id text not null references organizations (id),
  connection_id text not null,
  mission_id text,
  department_slug text not null default '',
  operation text not null,
  resource text not null,
  http_status integer not null,
  result text not null,
  body_sha256 text not null,
  classification text not null default 'internal',
  created_at timestamptz not null default now()
);

create index if not exists github_reads_conn_idx on github_reads (connection_id, created_at desc);

create table if not exists github_sync_marks (
  connection_id text not null,
  resource_key text not null,
  body_sha256 text not null,
  item_ids text not null default '[]',
  etag text not null default '',
  synced_at timestamptz not null default now(),
  primary key (connection_id, resource_key)
);
