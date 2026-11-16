import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SANDBOX, runBounded, type BoundedRun } from "./sandbox-host.ts";

export type RuntimeTest = { name: string; passed: boolean; detail: string };

export type RuntimeReport = {
  passed: boolean;
  sha256: string;
  detail: string;
  tests: RuntimeTest[];
  startedAt: string;
  finishedAt: string;
  executionId: string;
  suite: string;
  sandbox: typeof SANDBOX & { enforced: boolean };
};

const FORBIDDEN = /\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b|\brequire\s*\(|\bprocess\b|\beval\s*\(|\bFunction\s*\(|document\.cookie|\blocalStorage\b|\bindexedDB\b|\bimport\s*\(|\bWorker\s*\(/;

export function extractHtml(artifact: string): string {
  const fenced = artifact.match(/```html\s*([\s\S]*?)```/i)?.[1];
  if (fenced?.includes("<")) return fenced.trim();
  const loose = artifact.match(/```\s*(<!doctype html[\s\S]*?)```/i)?.[1];
  if (loose) return loose.trim();
  if (/^<!doctype html/i.test(artifact.trim())) return artifact.trim();
  return "";
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sandboxFacts(): string {
  const memory = Math.round(SANDBOX.memoryBytes / (1024 * 1024));
  return `Private root, capabilities dropped, ${memory} MB, ${SANDBOX.cpuSeconds}s cpu, ${SANDBOX.processes} processes, ${SANDBOX.fileBytes} byte tmpfs, no network.`;
}

/** Runs the artifact under OS limits. This process never evaluates it. */
export async function executeArtifact(html: string, objective: string, executionId = ""): Promise<RuntimeReport> {
  const startedAt = new Date().toISOString();
  const hash = sha256(html);
  if (!html.trim()) {
    return report(false, hash, "No HTML artifact to execute.", [], startedAt, executionId, false);
  }
  if (FORBIDDEN.test(html)) {
    return report(false, hash, "Refused. The artifact asks for network, storage, or host access.", [
      { name: "No forbidden capability", passed: false, detail: "Blocked before a process was started." },
    ], startedAt, executionId, false);
  }
  const runner = resolve(process.cwd(), "scripts/qa-runner.mjs");
  if (!existsSync(runner)) {
    return report(false, hash, "The sandbox runner is missing.", [{ name: "Sandbox", passed: false, detail: "Runner missing." }], startedAt, executionId, false);
  }
  const bounded = await runBounded(process.execPath, [runner], JSON.stringify({ html, objective }));
  return fromBounded(bounded, hash, startedAt, executionId);
}

export function fromBounded(bounded: BoundedRun, hash: string, startedAt: string, executionId: string): RuntimeReport {
  if (existsSync(bounded.dir)) {
    return report(false, hash, "The sandbox temp directory was not removed.", [{ name: "Cleanup", passed: false, detail: bounded.dir }], startedAt, executionId, true);
  }
  if (/isolation refused|confine:|pivot_root|memory controller unavailable|could not be built|could not be detached/i.test(bounded.stderr) && !bounded.stdout.trim()) {
    return report(false, hash, "The sandbox boundary was not established. The artifact was not executed.", [
      { name: "OS limits", passed: false, detail: bounded.stderr.slice(0, 240) || "Isolation did not start." },
    ], startedAt, executionId, false);
  }
  if (/ENOENT|not found|prlimit|unshare/i.test(bounded.stderr) && !bounded.stdout.trim()) {
    return report(false, hash, "OS limits could not be applied on this host. The artifact was not executed.", [
      { name: "OS limits", passed: false, detail: bounded.stderr.slice(0, 240) || "prlimit or unshare is missing." },
    ], startedAt, executionId, false);
  }
  let parsed: { passed?: boolean; detail?: string; tests?: RuntimeTest[] } | null = null;
  try {
    parsed = JSON.parse(bounded.stdout) as { passed?: boolean; detail?: string; tests?: RuntimeTest[] };
  } catch {
    parsed = null;
  }
  if (!parsed || !Array.isArray(parsed.tests)) {
    const detail = bounded.killed
      ? `The sandbox stopped the artifact. ${sandboxFacts()}`
      : "The sandbox did not return a test report.";
    return report(false, hash, detail, [{ name: "Sandbox", passed: false, detail }], startedAt, executionId, true);
  }
  const tests = parsed.tests.filter((item) => item && typeof item.name === "string" && typeof item.passed === "boolean");
  const passed = parsed.passed === true && tests.length > 0 && tests.every((item) => item.passed);
  const detail = `${typeof parsed.detail === "string" ? parsed.detail : ""} ${sandboxFacts()}`.trim();
  return report(passed, hash, detail, tests, startedAt, executionId, true);
}

function report(
  passed: boolean,
  hash: string,
  detail: string,
  tests: RuntimeTest[],
  startedAt: string,
  executionId: string,
  enforced: boolean,
): RuntimeReport {
  return {
    passed,
    sha256: hash,
    detail,
    tests,
    startedAt,
    finishedAt: new Date().toISOString(),
    executionId,
    suite: SANDBOX.suite,
    sandbox: { ...SANDBOX, enforced },
  };
}
