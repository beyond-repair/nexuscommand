import { CompanyError } from "./company.ts";
import type { Sql } from "./company-store.ts";

export function requireOwner(role: string): void {
  if (role !== "owner") throw new CompanyError("Only the owner can link a task to a mission.");
}

export async function linkTaskToMission(
  sql: Sql,
  input: { orgId: string; missionId: string; taskId: string; actorId: string; linkId: string },
): Promise<"created" | "exists"> {
  if (input.actorId.startsWith("svc:")) throw new CompanyError("An agent cannot link a task to a mission.");
  const rows = await sql<{ id: string }>`insert into mission_links (id, organization_id, mission_id, task_id, linked_by)
    select ${input.linkId}, m.organization_id, m.id, t.id, ${input.actorId}
    from missions m
    join tasks t on t.organization_id = m.organization_id and t.id = ${input.taskId}
    where m.id = ${input.missionId} and m.organization_id = ${input.orgId}
    on conflict (organization_id, mission_id, task_id) do nothing
    returning id`;
  if (rows[0]) return "created";
  const existing = await sql<{ id: string }>`select id from mission_links
    where organization_id = ${input.orgId} and mission_id = ${input.missionId} and task_id = ${input.taskId} limit 1`;
  if (existing[0]) return "exists";
  throw new CompanyError("That task is not in this company. Nothing was linked.");
}

export async function unlinkTaskFromMission(
  sql: Sql,
  input: { orgId: string; missionId: string; taskId: string; actorId: string },
): Promise<void> {
  if (input.actorId.startsWith("svc:")) throw new CompanyError("An agent cannot remove a task link.");
  const rows = await sql<{ id: string }>`delete from mission_links
    where organization_id = ${input.orgId} and mission_id = ${input.missionId} and task_id = ${input.taskId}
    returning id`;
  if (!rows[0]) throw new CompanyError("That link is not in this company. Nothing was removed.");
}

export async function missionTaskLinks(
  sql: Sql,
  orgId: string,
  missionId: string,
): Promise<Array<{ taskId: string; objective: string; state: string; projectName: string }>> {
  const rows = await sql<{ task_id: string; objective: string; state: string; project_name: string }>`
    select t.id as task_id, t.objective, t.state, p.name as project_name
    from mission_links l
    join tasks t on t.id = l.task_id and t.organization_id = l.organization_id
    join projects p on p.id = t.project_id and p.organization_id = l.organization_id
    where l.organization_id = ${orgId} and l.mission_id = ${missionId}
    order by l.created_at`;
  return rows.map((row) => ({
    taskId: row.task_id,
    objective: row.objective,
    state: row.state,
    projectName: row.project_name,
  }));
}
