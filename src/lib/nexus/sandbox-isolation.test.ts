import assert from "node:assert/strict";
import test from "node:test";
import { localDraft } from "./company.ts";
import { executeArtifact } from "./qa-sandbox.ts";
import { runBounded } from "./sandbox-host.ts";

test("a checker cannot see the host, credentials, other processes, or the network", async () => {
  process.env.NEXUS_CANARY_SECRET = "should-not-leak";
  process.env.DATABASE_URL = "postgres://root:secret@localhost/nexus";
  const probe = await runBounded(process.execPath, ["-e", `
    const fs = require("fs");
    const paths = ["/etc/passwd", "/etc/shadow", "/workspace/package.json", "/sys/fs/cgroup/cgroup.controllers", "/var/run/docker.sock", "/proc/1/root/etc/passwd"];
    for (const path of paths) {
      try { fs.readFileSync(path); console.log("READ " + path); }
      catch (error) { console.log("NO " + path); }
    }
    const cap = (fs.readFileSync("/proc/self/status", "utf8").match(/^CapEff:\\s*(\\w+)/m) || [])[1];
    console.log("CAP " + cap);
    console.log("ENV " + JSON.stringify(process.env));
    console.log("PROCS " + fs.readdirSync("/proc").filter((name) => /^[0-9]+$/.test(name)).length);
    const net = require("net");
    function hit(host, port, label) {
      return new Promise((resolve) => {
        const socket = net.connect(port, host);
        const done = (line) => { console.log(line); socket.destroy(); resolve(); };
        socket.on("connect", () => done("NET-OPEN " + label));
        socket.on("error", () => done("NET-BLOCK " + label));
        setTimeout(() => done("NET-BLOCK " + label), 300);
      });
    }
    (async () => {
      await hit("1.1.1.1", 80, "public");
      await hit("127.0.0.1", 8080, "localhost");
      await hit("169.254.169.254", 80, "metadata");
      try { fs.writeFileSync("/opt/nexus/qa-runner.mjs", "tamper"); console.log("TAMPER-OK"); }
      catch { console.log("TAMPER-BLOCK"); }
      try { fs.writeFileSync("big.bin", Buffer.alloc(2 * 1024 * 1024)); console.log("DISK-OK"); }
      catch { console.log("DISK-BLOCK"); }
      console.log("DONE");
    })();
  `]);
  delete process.env.NEXUS_CANARY_SECRET;
  delete process.env.DATABASE_URL;
  assert.equal(probe.cleaned, true, probe.stderr);
  assert.match(probe.stdout, /NO \/etc\/passwd/);
  assert.match(probe.stdout, /NO \/workspace\/package.json/);
  assert.match(probe.stdout, /NO \/sys\/fs\/cgroup\/cgroup.controllers/);
  assert.match(probe.stdout, /NO \/var\/run\/docker.sock/);
  assert.match(probe.stdout, /NO \/proc\/1\/root\/etc\/passwd/);
  assert.match(probe.stdout, /CAP 0+/);
  assert.doesNotMatch(probe.stdout, /should-not-leak/);
  assert.doesNotMatch(probe.stdout, /postgres:\/\//);
  assert.match(probe.stdout, /PROCS 1/);
  assert.doesNotMatch(probe.stdout, /NET-OPEN/);
  assert.match(probe.stdout, /TAMPER-BLOCK/);
  assert.match(probe.stdout, /DISK-BLOCK/);
  assert.equal(probe.stdout.includes("DONE"), true, probe.stderr);

  const objective = "Track contractor jobs and draft invoices";
  const html = localDraft("developer", objective, "").match(/```html\s*([\s\S]*?)```/i)?.[1] ?? "";
  const passed = await executeArtifact(html, objective);
  assert.equal(passed.passed, true, passed.detail);
  assert.equal(passed.sandbox.enforced, true);
  assert.equal(passed.sandbox.filesystem, "pivot-root");
  assert.equal(passed.sandbox.capabilities, "dropped");
});
