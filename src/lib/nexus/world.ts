import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type PriceStatus = "verified" | "unverified" | "expired";
export type CostKind = "estimate" | "reservation" | "actual" | "reconciled" | "unknown";
export type UnknownCostPolicy = "record_unknown" | "refuse";

export type PriceCard = {
  version: number;
  status: PriceStatus;
  reviewAt: string;
  inputCentsPerMillion: number | null;
  outputCentsPerMillion: number | null;
  cachedCentsPerMillion: number | null;
};

export function usablePrice(price: PriceCard | null, now: string): PriceCard | null {
  if (!price) return null;
  if (price.status !== "verified") return null;
  if (price.reviewAt <= now) return null;
  return price;
}

export function quoteCost(input: {
  price: PriceCard | null;
  now: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
}): { kind: CostKind; cents: number | null; pricingVersion: number | null; reason: string } {
  const price = usablePrice(input.price, input.now);
  if (!price) {
    return { kind: "unknown", cents: null, pricingVersion: input.price?.version ?? null, reason: "No current verified price. The cost is unknown, not zero." };
  }
  const parts: Array<[number | null, number | null]> = [
    [input.inputTokens, price.inputCentsPerMillion],
    [input.outputTokens, price.outputCentsPerMillion],
    [input.cachedTokens, price.cachedCentsPerMillion],
  ];
  if (parts.some(([tokens, rate]) => tokens == null || rate == null)) {
    return { kind: "unknown", cents: null, pricingVersion: price.version, reason: "Usage or a price dimension is missing. Missing usage is not treated as zero." };
  }
  const cents = parts.reduce((sum, [tokens, rate]) => sum + Math.round(((tokens ?? 0) * (rate ?? 0)) / 1_000_000), 0);
  return { kind: "estimate", cents, pricingVersion: price.version, reason: "Estimate from the verified price and the reported token counts. This is not an invoice." };
}

export function unpricedDispatch(policy: UnknownCostPolicy, kind: CostKind): { allow: boolean; reason: string } {
  if (kind !== "unknown") return { allow: true, reason: "A priced estimate is on record." };
  if (policy === "refuse") return { allow: false, reason: "The owner requires a verified price before an external call." };
  return { allow: true, reason: "The call is allowed and its cost stays unknown." };
}

export function forecastCost(samples: ReadonlyArray<{ cents: number | null }>): {
  available: boolean;
  expectedCents: number | null;
  lowCents: number | null;
  highCents: number | null;
  sample: number;
  note: string;
} {
  const known = samples.map((row) => row.cents).filter((value): value is number => value != null && value >= 0);
  if (known.length < 5) {
    return { available: false, expectedCents: null, lowCents: null, highCents: null, sample: known.length, note: "Fewer than five priced executions. The forecast is unavailable." };
  }
  const sorted = [...known].sort((a, b) => a - b);
  const expected = Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length);
  return {
    available: true,
    expectedCents: expected,
    lowCents: sorted[0] ?? null,
    highCents: sorted[sorted.length - 1] ?? null,
    sample: sorted.length,
    note: "Range is the lowest and highest recorded estimate. It is not a provider quote.",
  };
}

export type RequirementLine = { key: string; text: string };

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / new Set([...left, ...right]).size;
}

export function relateRequirements(before: readonly RequirementLine[], after: readonly RequirementLine[]): {
  unchanged: RequirementLine[];
  modified: Array<{ key: string; text: string; priorKey: string }>;
  added: RequirementLine[];
  removed: RequirementLine[];
  ambiguous: RequirementLine[];
} {
  const usedBefore = new Set<string>();
  const unchanged: RequirementLine[] = [];
  const remaining: RequirementLine[] = [];
  const beforeByText = new Map(before.map((row) => [row.text, row]));
  for (const row of after) {
    const exact = beforeByText.get(row.text);
    if (exact && !usedBefore.has(exact.key)) {
      usedBefore.add(exact.key);
      unchanged.push({ key: exact.key, text: row.text });
    } else remaining.push(row);
  }
  const modified: Array<{ key: string; text: string; priorKey: string }> = [];
  const added: RequirementLine[] = [];
  const ambiguous: RequirementLine[] = [];
  const openBefore = before.filter((row) => !usedBefore.has(row.key));
  for (const row of remaining) {
    const scored = openBefore
      .filter((prior) => !usedBefore.has(prior.key))
      .map((prior) => ({ prior, score: jaccard(tokens(prior.text), tokens(row.text)) }))
      .filter((item) => item.score >= 0.5)
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1];
    if (!best) {
      added.push(row);
    } else if (second && best.score - second.score < 0.1) {
      ambiguous.push(row);
    } else {
      usedBefore.add(best.prior.key);
      modified.push({ key: best.prior.key, text: row.text, priorKey: best.prior.key });
    }
  }
  return { unchanged, modified, added, removed: before.filter((row) => !usedBefore.has(row.key)), ambiguous };
}

export function coveredRequirements(requirements: readonly RequirementLine[], artifact: string): string[] {
  const haystack = artifact.toLowerCase();
  return requirements.filter((row) => haystack.includes(row.text.toLowerCase())).map((row) => row.key);
}

export type ActionClass = 1 | 2 | 3 | 4;

export function actionDecision(input: {
  actionClass: ActionClass;
  integrationStatus: "unverified" | "verified" | "revoked";
  scopes: readonly string[];
  operation: string;
  ownerApproved: boolean;
  confirmed: boolean;
  classification: "public" | "internal" | "confidential";
  caller: "owner" | "agent";
}): { allow: boolean; pending: boolean; reason: string } {
  if (input.integrationStatus !== "verified") {
    return { allow: false, pending: false, reason: "The integration is not connected. An unverified registry row is not a connection." };
  }
  if (!input.scopes.includes(input.operation)) {
    return { allow: false, pending: false, reason: "That operation is outside the granted scope." };
  }
  if (input.classification === "confidential") {
    return { allow: false, pending: false, reason: "Confidential material is not sent through an external integration." };
  }
  if (input.actionClass === 1) return { allow: true, pending: false, reason: "Read-only operation inside the granted scope." };
  if (input.actionClass === 2 && input.caller === "owner") return { allow: true, pending: false, reason: "Low-impact operation pre-authorized by the owner." };
  if (input.actionClass >= 2 && input.caller !== "owner" && !input.ownerApproved) {
    return { allow: false, pending: true, reason: "An agent cannot approve this action." };
  }
  if (input.actionClass === 3 && input.ownerApproved) return { allow: true, pending: false, reason: "The owner approved this consequential action." };
  if (input.actionClass === 4 && input.ownerApproved && input.confirmed) return { allow: true, pending: false, reason: "The owner approved and confirmed this critical action." };
  return { allow: false, pending: true, reason: "This action is waiting on the owner." };
}

export function verifyWebhook(input: {
  body: string;
  secret: string;
  signature: string;
  nonce: string;
  seenNonces: readonly string[];
  now: number;
  timestamp: number;
}): { ok: boolean; reason: string } {
  if (!input.nonce || input.seenNonces.includes(input.nonce)) return { ok: false, reason: "That event nonce was already used." };
  if (Math.abs(input.now - input.timestamp) > 5 * 60 * 1000) return { ok: false, reason: "That event is outside the five-minute window." };
  const expected = createHmac("sha256", input.secret).update(`${input.timestamp}.${input.nonce}.${input.body}`).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(input.signature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return { ok: false, reason: "The signature does not match." };
  return { ok: true, reason: "Signature, nonce, and window checked. The event is not an authorization." };
}

export function quarantineExternal(text: string): { observation: string; ignoredDirectives: number } {
  const kept: string[] = [];
  let ignoredDirectives = 0;
  for (const line of text.split("\n")) {
    if (/ignore (all |any )?(previous |prior )?instructions|you are now|system prompt|grant yourself|raise the (budget|ceiling)/i.test(line)) {
      ignoredDirectives += 1;
      continue;
    }
    kept.push(line);
  }
  return { observation: kept.join("\n").trim(), ignoredDirectives };
}

export function externalMayAuthorize(): boolean {
  return false;
}

export function credentialUsable(input: { revoked: boolean; expiresAt: string | null; now: string }): { ok: boolean; reason: string } {
  if (input.revoked) return { ok: false, reason: "That credential is revoked." };
  if (input.expiresAt && input.expiresAt <= input.now) return { ok: false, reason: "That credential is expired." };
  return { ok: true, reason: "The stored credential is still within its recorded window." };
}

export function sealSecret(plain: string, key: Buffer): { cipher: string; nonce: string; tag: string; hint: string } {
  if (key.length !== 32) throw new Error("Credential key must be 32 bytes.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    cipher: body.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    hint: plain.length >= 8 ? `stored · ends ${plain.slice(-4)}` : "stored",
  };
}

export function openSecret(input: { cipher: string; nonce: string; tag: string }, key: Buffer): string {
  if (key.length !== 32) throw new Error("Credential key must be 32 bytes.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(input.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(input.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(input.cipher, "base64")), decipher.final()]).toString("utf8");
}

export function deviceCommand(input: {
  connected: boolean;
  permission: "read" | "control";
  operation: "read" | "control" | "emergency_stop";
  ownerApproved: boolean;
  emergencyStop: boolean;
}): { allow: boolean; claimed: boolean; state: string; reason: string } {
  if (!input.connected) {
    return { allow: false, claimed: false, state: "safe", reason: "The device is not connected. No physical action is claimed." };
  }
  if (input.operation === "emergency_stop") {
    return { allow: true, claimed: false, state: "stop-requested", reason: "Stop requested. It is not claimed until the device confirms." };
  }
  if (input.emergencyStop) {
    return { allow: false, claimed: false, state: "stopped", reason: "Emergency stop is set. Other commands stay blocked." };
  }
  if (input.operation === "control" && input.permission !== "control") {
    return { allow: false, claimed: false, state: "read-only", reason: "This device is registered for reading, not control." };
  }
  if (input.operation === "control" && !input.ownerApproved) {
    return { allow: false, claimed: false, state: "held", reason: "A control command needs the owner." };
  }
  return { allow: true, claimed: false, state: "requested", reason: "The command is recorded. It is not claimed until the device confirms." };
}

export function connectionLabel(status: string): "connected" | "not connected" {
  return status === "verified" ? "connected" : "not connected";
}

export function withinRate(recent: number, limit: number): boolean {
  return recent < limit;
}
