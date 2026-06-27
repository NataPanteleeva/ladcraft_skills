"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const src = process.argv[2];
const outDir = path.join(__dirname, "_bundle_extract");
fs.mkdirSync(outDir, { recursive: true });

const raw = zlib.gunzipSync(fs.readFileSync(src));
const tarPath = path.join(outDir, "bundle.tar");
fs.writeFileSync(tarPath, raw);

execFileSync("tar", ["-xf", tarPath, "-C", outDir], { stdio: "pipe" });

const appPath = path.join(outDir, "application.json");
const app = JSON.parse(fs.readFileSync(appPath, "utf8"));
const summary = {
  type: app.type,
  name: app.name,
  title: app.title,
  description: (app.description || "").slice(0, 200),
  skillPreview: (app.skill || "").slice(0, 300),
  tools: (app.tools || []).map((t) => ({ name: t.name, description: (t.description || "").slice(0, 80) })),
  version: app.version,
};
console.log(JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(__dirname, "bundle-summary.json"), JSON.stringify(app, null, 2));
