import { spawn } from "node:child_process";

const suites = ["npm run test:nexus", "npm run test:app", "npm run test:scripts"];
const failed = [];

for (const command of suites) {
  const code = await new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: "inherit" });
    child.on("exit", (status, signal) => resolve(signal ? 1 : status ?? 1));
  });
  if (code !== 0) failed.push(`${command} exited ${code}`);
}

if (failed.length > 0) {
  console.error(failed.join("\n"));
  process.exit(1);
}
