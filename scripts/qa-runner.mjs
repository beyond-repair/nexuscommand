/** Child process. The NEXUS server does not run this file in its own module graph. */
import fs from "node:fs";
import vm from "node:vm";

function refuse(reason) {
  process.stderr.write(`isolation refused: ${reason}\n`);
  process.exit(2);
}

const leaks = ["/etc/passwd", "/workspace/package.json", "/sys/fs/cgroup/cgroup.controllers", "/var/run/docker.sock"];
for (const path of leaks) {
  if (fs.existsSync(path)) refuse(path);
}
const status = fs.readFileSync("/proc/self/status", "utf8");
const capability = status.match(/^CapEff:\s*([0-9a-f]+)/mi);
if (!capability || !/^0+$/i.test(capability[1])) refuse("capabilities");
if (process.env.DATABASE_URL || process.env.OLDPWD || process.env.NEXUS_CANARY_SECRET) refuse("environment");

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
const html = typeof input.html === "string" ? input.html : "";
const objective = typeof input.objective === "string" ? input.objective : "";

const tests = [];
function check(name, passed, detail) {
  tests.push({ name, passed, detail });
}

const forbidden = /\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b|\brequire\s*\(|\bprocess\b|\beval\s*\(|\bFunction\s*\(|document\.cookie|\blocalStorage\b|\bindexedDB\b|\bimport\s*\(|\bWorker\s*\(|navigator\./;
if (forbidden.test(html)) {
  check("No forbidden capability", false, "The artifact asks for network, storage, or host access.");
  finish(false, "Refused before execution.");
}

check("No forbidden capability", true, "No network, storage, or host access in the source.");
check("Host isolation", true, "The checker cannot see host files, credentials, or capabilities.");

const elements = new Map();
for (const match of html.matchAll(/<([a-z0-9]+)([^>]*?)\sid=["']([^"']+)["']([^>]*)>([^<]*)/gi)) {
  elements.set(match[3], { id: match[3], textContent: match[5] ?? "", onclick: null });
}
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, { id, textContent: "", onclick: null });
    return elements.get(id);
  },
};
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
if (scripts.length === 0) {
  check("Script ran", false, "No script element.");
  finish(false, "Nothing executed.");
}

try {
const context = vm.createContext(Object.create(null), {
  codeGeneration: { strings: false, wasm: false },
});
context.document = document;
  for (const script of scripts) {
    vm.runInContext(script, context, { timeout: 500 });
  }
  check("Script ran", true, "The script returned without throwing.");
} catch (error) {
  check("Script ran", false, error instanceof Error ? error.message : "The script threw.");
  finish(false, "Runtime exception.");
}

const before = visible();
let clicked = false;
for (const element of elements.values()) {
  if (typeof element.onclick === "function") {
    try {
      element.onclick();
      clicked = true;
    } catch (error) {
      check("Control ran", false, error instanceof Error ? error.message : "The control threw.");
      finish(false, "The control threw.");
    }
  }
}
if (!clicked) {
  check("Control ran", false, "No onclick handler was installed.");
  finish(false, "The page has no running control.");
}
check("Control ran", true, "A control handler ran.");
const after = visible();
const changed = after !== before && after.trim().length > 0;
check("Output changed", changed, changed ? "Visible text changed after the control." : "Visible text did not change.");
const word = objective
  .split(/\W+/)
  .filter((part) => part.length >= 4)
  .slice(0, 1)[0];
const onObjective = word ? after.toLowerCase().includes(word.toLowerCase()) : after.trim().length > 0;
check("Stays on the objective", onObjective, onObjective ? "The result mentions the objective." : "The result does not mention the objective.");
finish(tests.every((item) => item.passed), tests.every((item) => item.passed) ? "The slice ran in isolation." : "The slice did not pass execution.");

function visible() {
  return [...elements.values()].map((element) => element.textContent).join("\n");
}

function finish(passed, detail) {
  process.stdout.write(JSON.stringify({ passed, detail, tests }));
  process.exit(0);
}
