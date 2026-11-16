/** PGLite loads its database snapshot beside the bundled module. The bundler does not emit it. */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const sourceDir = join(process.cwd(), "node_modules/@electric-sql/pglite/dist");
const destDir = join(process.cwd(), ".vercel/output/functions/__server.func/_libs");
const files = ["pglite.data", "pglite.wasm", "initdb.wasm"];

if (!existsSync(destDir)) {
  console.log("[pglite] production bundle is not present yet");
  process.exit(0);
}
mkdirSync(destDir, { recursive: true });
for (const name of files) {
  const from = join(sourceDir, name);
  if (!existsSync(from)) {
    console.error(`[pglite] missing ${from}`);
    process.exit(1);
  }
  copyFileSync(from, join(destDir, name));
}
console.log(`[pglite] copied ${files.join(", ")} to ${dirname(join(destDir, files[0]))}`);
