import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "./company-store.ts";
import { credentialUsable, openSecret, quarantineExternal, sealSecret } from "./world.ts";

export const GITHUB_READ_SCOPES = ["read:user", "user:email", "read:org", "read:public_key", "read:gpg_key"] as const;
export const GITHUB_READ_OPERATIONS = ["user", "repos", "repo", "branches", "commits", "pulls", "issues", "workflows"] as const;
export const GITHUB_WRITE_OPERATIONS = [
  "create_repo", "create_branch", "update_file", "create_commit", "create_pull", "create_issue",
  "update_issue", "dispatch_workflow", "delete_repo", "change_permission", "create_deployment",
] as const;
const DEPARTMENTS = new Set(["research", "engineering", "quality", "executive"]);

export type GithubResponse = { status: number; headers: Record<string, string>; body: string };
export type GithubFetch = (url: string, init: { headers: Record<string, string> }) => Promise<GithubResponse>;

export class GithubRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubRefusal";
  }
}

export function readCredentialKey(value: string | undefined): Buffer | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

export function scopeDecision(header: string | null | undefined): { ok: boolean; scopes: string[]; reason: string } {
  if (header == null || header.trim() === "") {
    return { ok: false, scopes: [], reason: "GitHub did not list scopes. A token without a read-only scope list is not stored and is not marked connected." };
  }
  const scopes = header.split(",").map((item) => item.trim()).filter(Boolean);
  const allowed = new Set<string>(GITHUB_READ_SCOPES);
  const rejected = scopes.filter((scope) => !allowed.has(scope));
  if (scopes.length === 0 || rejected.length > 0) {
    return { ok: false, scopes, reason: rejected.length > 0
      ? `These scopes are not read-only, so the token was not stored: ${rejected.join(", ")}.`
      : "GitHub did not list scopes. A token without a read-only scope list is not stored and is not marked connected." };
  }
  return { ok: true, scopes, reason: "Every listed scope is on the read-only list." };
}

export function githubPath(operation: string, resource: string, page = 1): string {
  if ((GITHUB_WRITE_OPERATIONS as readonly string[]).includes(operation)) {
    throw new GithubRefusal("That GitHub operation writes. This connector does not send it.");
  }
  if (!(GITHUB_READ_OPERATIONS as readonly string[]).includes(operation)) {
    throw new GithubRefusal("That GitHub operation is not on the read list.");
  }
  const safePage = Number.isInteger(page) && page > 0 && page < 1000 ? page : 1;
  if (operation === "user") return "https://api.github.com/user";
  if (operation === "repos") return `https://api.github.com/user/repos?per_page=30&page=${safePage}&visibility=public`;
  const repo = parseRepo(resource);
  if (operation === "repo") return `https://api.github.com/repos/${repo}`;
  const suffix = operation === "branches" ? "branches"
    : operation === "commits" ? "commits"
      : operation === "pulls" ? "pulls?state=all"
        : operation === "issues" ? "issues?state=all"
          : "actions/runs";
  const joiner = suffix.includes("?") ? "&" : "?";
  return `https://api.github.com/repos/${repo}/${suffix}${joiner}per_page=30&page=${safePage}`;
}

function parseRepo(resource: string): string {
  const match = resource.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match?.[1] || !match[2] || match[1] === "." || match[2] === "." || match[1] === ".." || match[2] === "..") {
    throw new GithubRefusal("Name the repository as owner/name.");
  }
  return `${match[1]}/${match[2]}`;
}

export function repoAllowed(account: string, allowed: string, resource: string): { ok: boolean; reason: string } {
  let owner = "";
  let name = "";
  try {
    const parsed = parseRepo(resource);
    owner = parsed.split("/")[0] ?? "";
    name = parsed.split("/")[1] ?? "";
  } catch {
    return { ok: false, reason: "Name the repository as owner/name." };
  }
  const list = allowed.split(",").map((item) => item.trim()).filter(Boolean);
  if (list.length === 0) {
    if (owner.toLowerCase() !== account.toLowerCase()) {
      return { ok: false, reason: "No extra repositories are authorized. This connector can read the authenticated account's own public repositories." };
    }
    return { ok: true, reason: "The repository belongs to the authenticated account." };
  }
  const needle = `${owner}/${name}`.toLowerCase();
  if (!list.some((item) => item.toLowerCase() === needle)) {
    return { ok: false, reason: "That repository is outside the authorized list." };
  }
  return { ok: true, reason: "The repository is on the authorized list." };
}

export function rateAllows(remaining: string, reset: string, now: number): { ok: boolean; reason: string } {
  if (remaining !== "0") return { ok: true, reason: "No stored rate limit is exhausted." };
  const numeric = Number(reset);
  const resetAt = Number.isFinite(numeric) && numeric > 10_000_000_000 ? numeric : Number.isFinite(numeric) && numeric > 0 ? numeric * 1000 : Date.parse(reset);
  if (Number.isFinite(resetAt) && resetAt > now) return { ok: false, reason: "GitHub's stored rate limit is exhausted. The call was not sent." };
  return { ok: true, reason: "The stored rate window has passed." };
}

export async function githubCall(input: {
  operation: string;
  resource: string;
  token: string;
  page?: number;
  etag?: string;
  fetchImpl: GithubFetch;
}): Promise<{ url: string; response: GithubResponse }> {
  const url = githubPath(input.operation, input.resource, input.page ?? 1);
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "nexus-github-readonly",
    "x-github-api-version": "2022-11-28",
  };
  if (input.token) headers.authorization = `Bearer ${input.token}`;
  if (input.etag) headers["if-none-match"] = input.etag;
  let response = await input.fetchImpl(url, { headers });
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    response = await input.fetchImpl(url, { headers });
  }
  return { url, response };
}

export function readItems(operation: string, body: string): { ids: string[]; private: boolean; note: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ids: [], private: false, note: "GitHub's response was not JSON. Nothing was accepted as knowledge." };
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const ids: string[] = [];
  let isPrivate = false;
  const notes: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (record.private === true) isPrivate = true;
    const id = typeof record.sha === "string" ? record.sha
      : typeof record.full_name === "string" ? record.full_name
        : typeof record.login === "string" ? record.login
          : typeof record.number === "number" ? String(record.number)
            : typeof record.id === "number" ? String(record.id)
              : "";
    if (id) ids.push(id);
    const text = [record.title, record.message, record.body, record.name].filter((item) => typeof item === "string").join("\n");
    if (text) notes.push(text);
  }
  const quarantined = quarantineExternal(notes.join("\n"));
  const note = isPrivate
    ? "A private repository was returned. Its contents are not shown and are not sent to a model."
    : quarantined.observation.slice(0, 240);
  return { ids, private: isPrivate, note };
}

export function maySendToModel(classification: string): boolean {
  return classification !== "confidential";
}

export function pollDue(lastSync: string | null, minutes: number, now: number): boolean {
  if (!lastSync) return true;
  const at = Date.parse(lastSync);
  if (!Number.isFinite(at)) return true;
  return now - at >= minutes * 60_000;
}

function gid(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function auditGithub(sql: Sql, orgId: string, actorId: string, action: string, target: string, to: string, detail: string): Promise<void> {
  await sql`insert into audit_events (
    id, organization_id, project_id, task_id, actor_id, actor_kind, action, target, from_state, to_state, detail
  ) values (
    ${gid("aud")}, ${orgId}, ${null}, ${null}, ${actorId}, ${"human"}, ${action}, ${target}, ${null}, ${to}, ${detail.slice(0, 500)}
  )`;
}

export async function connectGithubAccount(sql: Sql, input: {
  orgId: string;
  userId: string;
  token: string;
  allowedRepos: string;
  key: Buffer | null;
  fetchImpl: GithubFetch;
}): Promise<{ status: string }> {
  const token = input.token.trim();
  if (!token || token.length > 300 || /[\r\n]/.test(token)) {
    throw new GithubRefusal("The token is missing or not usable. Nothing was sent and nothing was stored.");
  }
  if (!input.key) throw new GithubRefusal("Credential storage is not configured. Set NEXUS_CREDENTIAL_KEY. Nothing was sent and nothing was stored.");
  const existing = await sql<{ id: string; integration_id: string }>`select id, integration_id from github_connections
    where organization_id = ${input.orgId} and status <> ${"revoked"} order by updated_at desc limit 1`;
  let integrationId = existing[0]?.integration_id ?? "";
  let connectionId = existing[0]?.id ?? "";
  if (!integrationId) {
    integrationId = gid("int");
    connectionId = gid("ghc");
    await sql`insert into integrations (
      id, organization_id, name, provider, category, status, auth_method, scopes
    ) values (
      ${integrationId}, ${input.orgId}, ${"GitHub"}, ${"github"}, ${"software"}, ${"unverified"}, ${"bearer"}, ${""}
    )`;
    await sql`insert into github_connections (
      id, organization_id, integration_id, status, allowed_repos
    ) values (
      ${connectionId}, ${input.orgId}, ${integrationId}, ${"authentication_pending"}, ${input.allowedRepos.slice(0, 500)}
    )`;
  } else {
    await sql`update github_connections set status = ${"authentication_pending"}, allowed_repos = ${input.allowedRepos.slice(0, 500)}, updated_at = now()
      where id = ${connectionId} and organization_id = ${input.orgId}`;
  }
  let response: GithubResponse;
  try {
    const called = await githubCall({ operation: "user", resource: "", token, fetchImpl: input.fetchImpl });
    response = called.response;
  } catch (error) {
    const reason = error instanceof GithubRefusal ? error.message : "GitHub could not be reached. The token was not stored.";
    await sql`update github_connections set status = ${"authentication_failed"}, last_failure = ${reason}, last_failure_at = now(), updated_at = now()
      where id = ${connectionId}`;
    throw new GithubRefusal(reason);
  }
  const scopes = scopeDecision(response.headers["x-oauth-scopes"]);
  if (response.status !== 200 || !scopes.ok) {
    const reason = response.status === 401
      ? "GitHub rejected that token. Nothing was stored."
      : response.status !== 200
        ? `GitHub returned ${response.status}. The token was not stored.`
        : scopes.reason;
    await sql`update github_connections set status = ${"authentication_failed"}, last_failure = ${reason}, last_failure_at = now(), updated_at = now()
      where id = ${connectionId}`;
    await auditGithub(sql, input.orgId, input.userId, "github.auth_failed", connectionId, "authentication_failed", reason);
    throw new GithubRefusal(reason);
  }
  const profile = readItems("user", response.body);
  const login = profile.ids[0] ?? "";
  const sealed = sealSecret(token, input.key);
  await sql`insert into integration_secrets (integration_id, organization_id, cipher, nonce, tag, hint)
    values (${integrationId}, ${input.orgId}, ${sealed.cipher}, ${sealed.nonce}, ${sealed.tag}, ${sealed.hint})
    on conflict (integration_id) do update set cipher = ${sealed.cipher}, nonce = ${sealed.nonce}, tag = ${sealed.tag}, hint = ${sealed.hint}, revoked_at = ${null}`;
  await sql`update integrations set status = ${"verified"}, scopes = ${scopes.scopes.join(",")} where id = ${integrationId} and organization_id = ${input.orgId}`;
  await sql`update github_connections set
    status = ${"connected"}, account_login = ${login}, scopes = ${scopes.scopes.join(",")}, credential_hint = ${sealed.hint},
    rate_remaining = ${response.headers["x-ratelimit-remaining"] ?? ""}, rate_reset = ${response.headers["x-ratelimit-reset"] ?? ""},
    last_success_at = now(), last_failure = ${""}, updated_at = now()
    where id = ${connectionId}`;
  await auditGithub(sql, input.orgId, input.userId, "github.connected", connectionId, "connected", `GitHub account ${login} listed read-only scopes. The token is not in this record.`);
  return { status: "connected" };
}

export async function revokeGithubAccount(sql: Sql, input: { orgId: string; userId: string; mode: "revoked" | "disconnected" }): Promise<void> {
  const rows = await sql<{ id: string; integration_id: string }>`select id, integration_id from github_connections
    where organization_id = ${input.orgId} order by updated_at desc limit 1`;
  const row = rows[0];
  if (!row) throw new GithubRefusal("GitHub is not registered for this company.");
  await sql`update integration_secrets set cipher = ${""}, nonce = ${""}, tag = ${""}, hint = ${"revoked"}, revoked_at = now()
    where integration_id = ${row.integration_id} and organization_id = ${input.orgId}`;
  await sql`update integrations set status = ${"revoked"} where id = ${row.integration_id} and organization_id = ${input.orgId}`;
  await sql`update github_connections set status = ${input.mode}, credential_hint = ${"revoked"}, updated_at = now() where id = ${row.id}`;
  await auditGithub(sql, input.orgId, input.userId, "github.revoked", row.id, input.mode, "The stored credential was wiped. No further GitHub call will use it.");
}

export async function readGithub(sql: Sql, input: {
  orgId: string;
  userId: string;
  operation: string;
  resource: string;
  department: string;
  missionId: string;
  page?: number;
  key: Buffer | null;
  fetchImpl: GithubFetch;
  now?: number;
}): Promise<{ result: string; classification: string }> {
  if ((GITHUB_WRITE_OPERATIONS as readonly string[]).includes(input.operation)) {
    throw new GithubRefusal("That GitHub operation writes. No request was sent.");
  }
  if (!DEPARTMENTS.has(input.department)) throw new GithubRefusal("That department cannot request GitHub reads.");
  if (!input.key) throw new GithubRefusal("Credential storage is not configured. The read was not sent.");
  const rows = await sql<{
    id: string;
    integration_id: string;
    status: string;
    account_login: string;
    allowed_repos: string;
    rate_remaining: string;
    rate_reset: string;
  }>`select id, integration_id, status, account_login, allowed_repos, rate_remaining, rate_reset from github_connections
    where organization_id = ${input.orgId} order by updated_at desc limit 1`;
  const connection = rows[0];
  if (!connection || connection.status !== "connected") throw new GithubRefusal("GitHub is not connected. The read was not sent.");
  const secret = await sql<{ cipher: string; nonce: string; tag: string; revoked_at: unknown }>`select cipher, nonce, tag, revoked_at from integration_secrets
    where integration_id = ${connection.integration_id} and organization_id = ${input.orgId} limit 1`;
  const stored = secret[0];
  const usable = credentialUsable({ revoked: Boolean(stored?.revoked_at), expiresAt: null, now: new Date().toISOString() });
  if (!stored || !usable.ok || !stored.cipher) throw new GithubRefusal("The GitHub credential is revoked. The read was not sent.");
  const gate = rateAllows(connection.rate_remaining, connection.rate_reset, input.now ?? Date.now());
  if (!gate.ok) throw new GithubRefusal(gate.reason);
  if (input.operation !== "user" && input.operation !== "repos") {
    const allowed = repoAllowed(connection.account_login, connection.allowed_repos, input.resource);
    if (!allowed.ok) throw new GithubRefusal(allowed.reason);
  }
  const resourceKey = `${input.operation}:${input.resource}:${input.page ?? 1}`;
  const prior = await sql<{ etag: string; body_sha256: string }>`select etag, body_sha256 from github_sync_marks
    where connection_id = ${connection.id} and resource_key = ${resourceKey} limit 1`;
  const token = openSecret(stored, input.key);
  let called: { response: GithubResponse };
  try {
    called = await githubCall({
      operation: input.operation,
      resource: input.resource,
      token,
      page: input.page,
      etag: prior[0]?.etag,
      fetchImpl: input.fetchImpl,
    });
  } catch (error) {
    const reason = error instanceof GithubRefusal ? error.message : "GitHub could not be reached.";
    await sql`update github_connections set last_failure = ${reason}, last_failure_at = now(), updated_at = now() where id = ${connection.id}`;
    throw new GithubRefusal(reason);
  }
  const response = called.response;
  if (response.status === 401) {
    await revokeGithubAccount(sql, { orgId: input.orgId, userId: input.userId, mode: "revoked" });
    throw new GithubRefusal("GitHub rejected the stored token. It has been wiped.");
  }
  const bodyHash = hash(response.body);
  const duplicate = response.status === 304 || (prior[0]?.body_sha256 === bodyHash && response.status === 200);
  const items = response.status === 200 ? readItems(input.operation, response.body) : { ids: [], private: false, note: "" };
  const classification = items.private ? "confidential" : "internal";
  const result = duplicate ? "duplicate" : response.status === 200 ? "retrieved" : "failed";
  await sql`insert into github_reads (
    id, organization_id, connection_id, mission_id, department_slug, operation, resource, http_status, result, body_sha256, classification
  ) values (
    ${gid("ghr")}, ${input.orgId}, ${connection.id}, ${input.missionId || null}, ${input.department}, ${input.operation}, ${input.resource.slice(0, 200)},
    ${response.status}, ${result}, ${bodyHash}, ${classification}
  )`;
  if (!duplicate && response.status === 200 && items.note && !items.private) {
    await sql`insert into observations (
      id, organization_id, mission_id, source, reference, body, content_sha256, classification, status
    ) values (
      ${gid("obs")}, ${input.orgId}, ${input.missionId || null}, ${"github"}, ${input.resource.slice(0, 300)}, ${items.note}, ${hash(items.note)}, ${classification}, ${"observed"}
    )`;
  }
  if (input.operation === "repos" && response.status === 200) {
    await storeRepos(sql, input.orgId, connection.id, response.body);
  }
  await sql`insert into github_sync_marks (connection_id, resource_key, body_sha256, item_ids, etag)
    values (${connection.id}, ${resourceKey}, ${bodyHash}, ${JSON.stringify(items.ids)}, ${response.headers.etag ?? prior[0]?.etag ?? ""})
    on conflict (connection_id, resource_key) do update set body_sha256 = ${bodyHash}, item_ids = ${JSON.stringify(items.ids)}, etag = ${response.headers.etag ?? prior[0]?.etag ?? ""}, synced_at = now()`;
  if (response.status === 200 || response.status === 304) {
    await sql`update github_connections set
      rate_remaining = ${response.headers["x-ratelimit-remaining"] ?? connection.rate_remaining},
      rate_reset = ${response.headers["x-ratelimit-reset"] ?? connection.rate_reset},
      last_success_at = now(), last_sync_at = now(), last_failure = ${""}, updated_at = now()
      where id = ${connection.id}`;
  } else {
    await sql`update github_connections set
      rate_remaining = ${response.headers["x-ratelimit-remaining"] ?? connection.rate_remaining},
      rate_reset = ${response.headers["x-ratelimit-reset"] ?? connection.rate_reset},
      last_failure = ${`GitHub returned ${response.status}.`}, last_failure_at = now(), updated_at = now()
      where id = ${connection.id}`;
  }
  await auditGithub(sql, input.orgId, input.userId, "github.read", connection.id, result, `${input.department} ${input.operation} ${input.resource} status ${response.status}. The token and the response body are not in this record.`);
  return { result, classification };
}

async function storeRepos(sql: Sql, orgId: string, connectionId: string, body: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const full = typeof record.full_name === "string" ? record.full_name : "";
    const [owner, name] = full.split("/");
    if (!owner || !name || typeof record.id !== "number") continue;
    await sql`insert into github_repos (
      id, organization_id, connection_id, owner_name, repo_name, external_id, private, default_branch
    ) values (
      ${gid("ghrepo")}, ${orgId}, ${connectionId}, ${owner}, ${name}, ${String(record.id)}, ${record.private === true},
      ${typeof record.default_branch === "string" ? record.default_branch : ""}
    ) on conflict (connection_id, external_id) do update set private = ${record.private === true}, default_branch = ${typeof record.default_branch === "string" ? record.default_branch : ""}, updated_at = now()`;
  }
}

export async function liveGithubFetch(url: string, init: { headers: Record<string, string> }): Promise<GithubResponse> {
  const response = await fetch(url, { headers: init.headers });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return { status: response.status, headers, body: await response.text() };
}
