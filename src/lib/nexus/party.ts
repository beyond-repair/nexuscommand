import { CompanyError } from "./company.ts";
import type { Sql } from "./company-store.ts";

export type PartyKind = "person" | "organization" | "other";
export type PartyRoleName = "customer" | "supplier" | "employee" | "contractor" | "contact";

export interface Party {
  id: string;
  organizationId: string;
  kind: PartyKind;
  displayName: string;
  status: "active" | "inactive";
  createdAt: string;
  createdBy: string;
}

export interface PartyRole {
  id: string;
  organizationId: string;
  partyId: string;
  role: PartyRoleName;
  status: "active" | "inactive";
  assignedAt: string;
  assignedBy: string;
}

export interface PartyContact {
  id: string;
  organizationId: string;
  partyId: string;
  label: string;
  value: string;
  status: "active" | "inactive";
  createdAt: string;
  createdBy: string;
}

export async function createParty(
  sql: Sql,
  input: { orgId: string; partyId: string; kind: PartyKind; displayName: string; actorId: string },
): Promise<Party> {
  if (input.actorId.startsWith("svc:")) throw new CompanyError("An agent cannot create a party.");
  const rows = await sql<Party>`insert into parties (id, organization_id, kind, display_name, created_by)
    values (${input.partyId}, ${input.orgId}, ${input.kind}, ${input.displayName}, ${input.actorId})
    returning id, organization_id as "organizationId", kind, display_name as "displayName", status, created_at as "createdAt", created_by as "createdBy"`;
  const row = rows[0];
  if (!row) throw new CompanyError("Party was not created.");
  return row;
}

export async function assignRole(
  sql: Sql,
  input: { orgId: string; partyId: string; roleId: string; role: PartyRoleName; actorId: string },
): Promise<"created" | "exists"> {
  if (input.actorId.startsWith("svc:")) throw new CompanyError("An agent cannot assign a party role.");
  const rows = await sql<{ id: string }>`insert into party_roles (id, organization_id, party_id, role, assigned_by)
    select ${input.roleId}, p.organization_id, p.id, ${input.role}, ${input.actorId}
    from parties p
    where p.id = ${input.partyId} and p.organization_id = ${input.orgId}
    on conflict (organization_id, party_id, role) do nothing
    returning id`;
  if (rows[0]) return "created";
  const existing = await sql<{ id: string }>`select id from party_roles
    where organization_id = ${input.orgId} and party_id = ${input.partyId} and role = ${input.role} limit 1`;
  if (existing[0]) return "exists";
  throw new CompanyError("That party is not in this company. Nothing was assigned.");
}

export async function deactivateRole(
  sql: Sql,
  input: { orgId: string; partyId: string; role: PartyRoleName; actorId: string },
): Promise<void> {
  if (input.actorId.startsWith("svc:")) throw new CompanyError("An agent cannot deactivate a party role.");
  const rows = await sql<{ id: string }>`update party_roles set status = 'inactive'
    where organization_id = ${input.orgId} and party_id = ${input.partyId} and role = ${input.role} and status = 'active'
    returning id`;
  if (!rows[0]) throw new CompanyError("That active role is not in this company. Nothing was changed.");
}

export async function addContact(
  sql: Sql,
  input: { orgId: string; partyId: string; contactId: string; label: string; value: string; actorId: string },
): Promise<PartyContact> {
  if (input.actorId.startsWith("svc:")) throw new CompanyError("An agent cannot add a party contact.");
  const rows = await sql<PartyContact>`insert into party_contacts (id, organization_id, party_id, label, value, created_by)
    select ${input.contactId}, p.organization_id, p.id, ${input.label}, ${input.value}, ${input.actorId}
    from parties p
    where p.id = ${input.partyId} and p.organization_id = ${input.orgId}
    returning id, organization_id as "organizationId", party_id as "partyId", label, value, status, created_at as "createdAt", created_by as "createdBy"`;
  const row = rows[0];
  if (!row) throw new CompanyError("That party is not in this company. Nothing was added.");
  return row;
}

export async function listPartiesByRole(
  sql: Sql,
  orgId: string,
  role: PartyRoleName,
): Promise<Array<Party & { roleStatus: string }>> {
  const rows = await sql<Party & { role_status: string }>`
    select p.id, p.organization_id as "organizationId", p.kind, p.display_name as "displayName", p.status,
           p.created_at as "createdAt", p.created_by as "createdBy", r.status as role_status
    from parties p
    join party_roles r on r.party_id = p.id and r.organization_id = p.organization_id
    where p.organization_id = ${orgId} and r.role = ${role} and r.status = 'active' and p.status = 'active'
    order by p.display_name`;
  return rows.map((row) => ({ ...row, roleStatus: row.role_status }));
}

export async function getParty(
  sql: Sql,
  orgId: string,
  partyId: string,
): Promise<Party | null> {
  const rows = await sql<Party>`select id, organization_id as "organizationId", kind, display_name as "displayName", status,
    created_at as "createdAt", created_by as "createdBy"
    from parties where id = ${partyId} and organization_id = ${orgId} limit 1`;
  return rows[0] ?? null;
}
