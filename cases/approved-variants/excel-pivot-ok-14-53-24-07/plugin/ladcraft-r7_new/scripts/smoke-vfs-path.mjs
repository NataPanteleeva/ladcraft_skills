/**
 * Smoke: session-segment VFS paths + conflict detector (no API).
 * Run: node scripts/smoke-vfs-path.mjs
 */
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { unlinkSync, writeFileSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpEntry = join(root, "scripts", ".tmp-vfs-path-entry.ts");
const tmpOut = join(root, "scripts", ".tmp-vfs-path.mjs");

writeFileSync(
  tmpEntry,
  `
export { sessionPathSegment, documentUploadVfsPath, documentBashPath } from "../src/transfer/message-payload.ts";
export { isVfsPathConflictError } from "../src/eai/vfs.ts";
`,
);

const build = spawnSync(
  process.execPath,
  [
    join(root, "node_modules", "esbuild", "bin", "esbuild"),
    tmpEntry,
    "--bundle",
    "--platform=neutral",
    "--format=esm",
    `--outfile=${tmpOut}`,
  ],
  { encoding: "utf8" },
);
if (build.status !== 0) {
  console.error(build.stderr || build.stdout);
  process.exit(1);
}

const mod = await import(pathToFileURL(tmpOut).href);
const {
  sessionPathSegment,
  documentUploadVfsPath,
  documentBashPath,
  isVfsPathConflictError,
} = mod;

const sid = "AbCdEfGhIjKlMnOpQrSt";
const seg = sessionPathSegment(sid);
if (seg !== "AbCdEfGhIjKl") {
  console.error("FAIL sessionPathSegment", seg);
  process.exit(1);
}

const fileName = "r7-word_deadbeef.json";
const upload = documentUploadVfsPath(fileName, sid);
const bash = documentBashPath(fileName, sid);
if (upload !== `/r7/${seg}/${fileName}`) {
  console.error("FAIL upload path", upload);
  process.exit(1);
}
if (bash !== `/session/r7/${seg}/${fileName}`) {
  console.error("FAIL bash path", bash);
  process.exit(1);
}

const sid2 = "XyZ999OtherSession";
if (documentUploadVfsPath(fileName, sid) === documentUploadVfsPath(fileName, sid2)) {
  console.error("FAIL paths must differ across sessions");
  process.exit(1);
}

if (!isVfsPathConflictError(new Error("целевой путь занят другим файлом"))) {
  console.error("FAIL conflict detect (ru)");
  process.exit(1);
}
if (!isVfsPathConflictError(new Error("Path already occupied"))) {
  console.error("FAIL conflict detect (en)");
  process.exit(1);
}
if (isVfsPathConflictError(new Error("timeout"))) {
  console.error("FAIL false positive conflict");
  process.exit(1);
}

try {
  unlinkSync(tmpEntry);
  unlinkSync(tmpOut);
} catch (_) {}
console.log("OK: session VFS path builders + conflict detect");
