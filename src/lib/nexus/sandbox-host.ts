import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** OS boundary applied to every sandboxed process. A separate process without these is not enough. */
export const SANDBOX = {
  suite: "nexus-qa-1",
  policy: "nexus-isolate-1",
  memoryBytes: 384 * 1024 * 1024,
  cpuSeconds: 2,
  processes: 64,
  fileBytes: 1024 * 1024,
  timeoutMs: 4_000,
  network: "none" as const,
  filesystem: "pivot-root" as const,
  proc: "subset-pid" as const,
  env: "minimal" as const,
  capabilities: "dropped" as const,
  /** This host maps only uid 0, so a second uid cannot exist. Capabilities are cleared instead. */
  identity: "uid-0-no-caps" as const,
  seccomp: "deny-host-control" as const,
};

const BOX = "/sys/fs/cgroup/nexus-qa";

export type BoundedRun = {
  code: number | null;
  stdout: string;
  stderr: string;
  killed: boolean;
  dir: string;
  cleaned: boolean;
};

let cgroupReady: boolean | null = null;

/** Enables a child cgroup. RLIMIT_AS cannot cap Node: V8 reserves a huge address space and faults. */
export function prepareCgroup(): boolean {
  if (cgroupReady !== null) return cgroupReady;
  try {
    const root = "/sys/fs/cgroup";
    if (!existsSync(`${root}/cgroup.controllers`)) {
      cgroupReady = false;
      return false;
    }
    const init = `${root}/nexus-init`;
    mkdirSync(init, { recursive: true });
    for (let pass = 0; pass < 6; pass += 1) {
      const procs = readFileSync(`${root}/cgroup.procs`, "utf8").split(/\s+/).filter(Boolean);
      if (procs.length === 0) break;
      for (const pid of procs) {
        try {
          writeFileSync(`${init}/cgroup.procs`, pid);
        } catch {
          /* a busy pid is moved on a later pass */
        }
      }
    }
    if (!readFileSync(`${root}/cgroup.procs`, "utf8").trim()) {
      try {
        writeFileSync(`${root}/cgroup.subtree_control`, "+memory +cpu +pids");
      } catch {
        /* controllers may already be enabled */
      }
    }
    mkdirSync(BOX, { recursive: true });
    writeFileSync(`${BOX}/memory.max`, String(SANDBOX.memoryBytes));
    writeFileSync(`${BOX}/memory.swap.max`, "0");
    writeFileSync(`${BOX}/pids.max`, String(SANDBOX.processes));
    cgroupReady = existsSync(`${BOX}/memory.max`);
    return cgroupReady;
  } catch {
    cgroupReady = false;
    return false;
  }
}

function killGroup(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function nodeLibraries(): string[] {
  const listed = execFileSync("ldd", [process.execPath], { encoding: "utf8" });
  const libs = new Set<string>(["/lib64/ld-linux-x86-64.so.2"]);
  for (const line of listed.split("\n")) {
    const mapped = line.match(/=>\s+(\/\S+)/);
    const direct = line.match(/^\s*(\/\S+)\s+\(/);
    const path = mapped?.[1] ?? direct?.[1];
    if (path) libs.add(path);
  }
  return [...libs];
}

function ensureConfine(): string {
  const source = join(process.cwd(), "scripts/sandbox-confine.c");
  const binary = join(process.cwd(), "scripts/sandbox-confine");
  if (!existsSync(source)) throw new Error("The sandbox confine source is missing.");
  if (!existsSync(binary) || statSync(source).mtimeMs > statSync(binary).mtimeMs) {
    execFileSync("gcc", ["-static", "-O2", "-s", "-o", binary, source], { stdio: "pipe" });
  }
  if (!existsSync(binary)) throw new Error("The sandbox confine helper was not built.");
  return binary;
}

function bindReadonly(source: string, dest: string): void {
  mkdirSync(join(dest, ".."), { recursive: true });
  writeFileSync(dest, "");
  execFileSync("mount", ["--bind", source, dest]);
  execFileSync("mount", ["-o", "remount,bind,ro", dest]);
}

function buildRoot(stage: string, runner: string, confine: string): void {
  execFileSync("mount", ["-t", "tmpfs", "-o", "nosuid,nodev,size=16m,mode=755", "tmpfs", stage]);
  for (const dir of ["usr/bin", "lib64", "lib/x86_64-linux-gnu", "opt/nexus", "tmp", "proc", "dev", "old"]) {
    mkdirSync(join(stage, dir), { recursive: true });
  }
  bindReadonly(process.execPath, join(stage, "usr/bin/node"));
  for (const lib of nodeLibraries()) {
    if (!existsSync(lib)) continue;
    bindReadonly(lib, join(stage, lib.slice(1)));
  }
  copyFileSync(confine, join(stage, "opt/nexus/confine"));
  copyFileSync(runner, join(stage, "opt/nexus/qa-runner.mjs"));
  chmodSync(join(stage, "opt/nexus/confine"), 0o555);
  chmodSync(join(stage, "opt/nexus/qa-runner.mjs"), 0o444);
  for (const name of ["null", "zero", "urandom"]) {
    const dest = join(stage, "dev", name);
    writeFileSync(dest, "");
    execFileSync("mount", ["--bind", `/dev/${name}`, dest]);
  }
  execFileSync("mount", ["-o", "remount,nosuid,nodev,ro", stage]);
  const quota = `${Math.floor(SANDBOX.fileBytes / 1024)}k`;
  execFileSync("mount", ["-t", "tmpfs", "-o", `nosuid,nodev,noexec,size=${quota},mode=700`, "tmpfs", join(stage, "tmp")]);
}

function destroyRoot(stage: string): void {
  try {
    execFileSync("umount", ["-R", "-l", stage], { stdio: "ignore" });
  } catch {
    /* already gone */
  }
  rmSync(stage, { recursive: true, force: true });
  rmSync(`${stage}-enter.sh`, { force: true });
}

function oomKills(): number {
  try {
    const text = readFileSync(`${BOX}/memory.events`, "utf8");
    return Number(text.match(/^oom_kill\s+(\d+)/m)?.[1] ?? 0);
  } catch {
    return 0;
  }
}

function blocked(dir: string, stderr: string): BoundedRun {
  return { code: 1, stdout: "", stderr, killed: false, dir, cleaned: true };
}

/**
 * Runs Node inside a private root that contains only the interpreter, the runner,
 * and a one-megabyte tmp. The host filesystem is detached. Capabilities are dropped.
 * If that boundary cannot be built, the command is not started.
 */
export async function runBounded(command: string, args: string[], stdin = ""): Promise<BoundedRun> {
  const stage = mkdtempSync(join(tmpdir(), "nexus-qa-"));
  if (command !== process.execPath) {
    rmSync(stage, { recursive: true, force: true });
    return blocked(stage, "The sandbox only runs the Node checker.");
  }
  if (!prepareCgroup()) {
    rmSync(stage, { recursive: true, force: true });
    return blocked(stage, "memory controller unavailable");
  }
  const runner = args.find((arg) => arg.endsWith("qa-runner.mjs")) ?? "";
  let confine = "";
  try {
    confine = ensureConfine();
    if (!existsSync(runner) && args.includes(runner)) throw new Error("The sandbox runner is missing.");
    buildRoot(stage, runner || join(process.cwd(), "scripts/qa-runner.mjs"), confine);
  } catch (error) {
    destroyRoot(stage);
    const message = error instanceof Error ? error.message : "The sandbox root could not be built.";
    return blocked(stage, message);
  }
  const enter = `${stage}-enter.sh`;
  const jailed = args.map((arg) => (arg === runner && runner ? "/opt/nexus/qa-runner.mjs" : arg));
  const execArgs = ["/usr/bin/node", ...jailed].map(shQuote).join(" ");
  const inner = [
    "set -eu",
    "mount --make-rprivate /",
    `mount -t proc -o nosuid,nodev,noexec,hidepid=2,subset=pid proc ${shQuote(`${stage}/proc`)}`,
    `cd ${shQuote(stage)}`,
    "pivot_root . old",
    "cd /tmp",
    "unset OLDPWD",
    "export PATH=/usr/bin HOME=/tmp TMPDIR=/tmp LANG=C",
    `exec /opt/nexus/confine --enter /old ${execArgs}`,
  ].join("\n");
  writeFileSync(enter, inner, { mode: 0o755 });
  const outer = [
    `echo $$ > ${BOX}/cgroup.procs`,
    "&&",
    "exec",
    "prlimit",
    `--cpu=${SANDBOX.cpuSeconds}`,
    `--fsize=${SANDBOX.fileBytes}`,
    "--nofile=64",
    "unshare",
    "--mount",
    "--pid",
    "--fork",
    "--net",
    "--ipc",
    "--uts",
    "--propagation",
    "private",
    "/bin/sh",
    enter,
  ].join(" ");
  let child: ChildProcess;
  try {
    child = spawn("/bin/sh", ["-c", outer], {
      cwd: stage,
      env: { PATH: "/usr/sbin:/usr/bin:/bin", HOME: "/tmp", TMPDIR: "/tmp", LANG: "C" },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
  } catch (error) {
    destroyRoot(stage);
    const message = error instanceof Error ? error.message : "The sandbox could not start.";
    return blocked(stage, message);
  }
  const killsBefore = oomKills();
  const timer = setTimeout(() => killGroup(child), SANDBOX.timeoutMs);
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout = (stdout + chunk).slice(0, 20_000);
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(0, 4_000);
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.on("error", (error) => {
      stderr = (stderr + error.message).slice(0, 4_000);
      resolveExit({ code: 1, signal: null });
    });
    child.on("close", (code, signal) => resolveExit({ code, signal }));
  });
  try {
    child.stdin?.write(stdin);
    child.stdin?.end();
  } catch {
    killGroup(child);
  }
  const result = await exited;
  clearTimeout(timer);
  killGroup(child);
  destroyRoot(stage);
  const killed = result.signal === "SIGKILL"
    || result.signal === "SIGXCPU"
    || result.code === null
    || result.code === 137
    || oomKills() > killsBefore;
  return { code: result.code, stdout, stderr, killed, dir: stage, cleaned: !existsSync(stage) };
}
