-- Shared party identity. Roles are scoped to one organization and do not create separate identities.
-- Disabled roles remain in history but do not appear in active lists or generate work.

create table if not exists parties (
  id text primary key,
  organization_id text not null references organizations (id),
  kind text not null check (kind in ('person', 'organization', 'other')),
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  created_by text not null,
  unique (organization_id, id)
);

create index if not exists parties_org_idx on parties (organization_id, status);

create table if not exists party_roles (
  id text primary key,
  organization_id text not null references organizations (id),
  party_id text not null references parties (id),
  role text not null check (role in ('customer', 'supplier', 'employee', 'contractor', 'contact')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  assigned_at timestamptz not null default now(),
  assigned_by text not null,
  unique (organization_id, party_id, role)
);

create index if not exists party_roles_party_idx on party_roles (organization_id, party_id);
create index if not exists party_roles_role_idx on party_roles (organization_id, role, status);

create table if not exists party_contacts (
  id text primary key,
  organization_id text not null references organizations (id),
  party_id text not null references parties (id),
  label text not null,
  value text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  created_by text not null
);

create index if not exists party_contacts_party_idx on party_contacts (organization_id, party_id, status);
