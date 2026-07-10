"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const EXPECT_VERSION = "0.4.2";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("OK:", msg);
}

const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
if (config.version !== EXPECT_VERSION) {
  fail(`config.json version=${config.version}, expected ${EXPECT_VERSION}`);
}
ok(`config.json version ${EXPECT_VERSION}`);

const versionTs = fs.readFileSync(path.join(ROOT, "src", "version.ts"), "utf8");
if (!versionTs.includes(`"${EXPECT_VERSION}"`)) {
  fail("src/version.ts mismatch");
}
ok("src/version.ts matches");

const distPath = path.join(ROOT, "dist", "app.js");
if (!fs.existsSync(distPath)) {
  fail("dist/app.js missing — run npm run build");
}
const dist = fs.readFileSync(distPath, "utf8");
if (!dist.includes(`PLUGIN_VERSION = "${EXPECT_VERSION}"`)) {
  fail(`dist/app.js missing PLUGIN_VERSION ${EXPECT_VERSION}`);
}
ok("dist/app.js PLUGIN_VERSION");

const requiredSnippets = [
  "documentCallbackUrl",
  "getDiskRefDebugInfo",
  "formatDiskRefDebugLine",
  "r7-disk:",
  "MISSING_DOC_ID",
];
for (const snippet of requiredSnippets) {
  if (!dist.includes(snippet)) {
    fail(`dist/app.js missing ${snippet}`);
  }
}
ok("dist/app.js id-first disk-ref symbols");

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  fail("index.html missing");
}
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
if (!html.includes("documentid|document_id")) {
  fail("index.html early capture patterns incomplete");
}
ok("index.html early id capture");

console.log("\nPlugin build verified for v" + EXPECT_VERSION);
console.log("Install path:", ROOT.replace(/\\/g, "/"));
