"use strict";
// Parses every browser module as an ES MODULE — which is how the browser
// actually loads them. `node --check` parses as CommonJS and happily accepts
// files the browser then refuses (a mis-nested template literal shipped this
// way once), so the syntax gate has to use the real goal.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..", "public", "js");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".js") ? [p] : [];
  });
}

const files = walk(root);
const failures = [];
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--input-type=module", "--check"], {
      input: fs.readFileSync(file), stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = String(err.stderr || err.message).split("\n")
      .find((l) => /Error/.test(l)) || String(err.message).slice(0, 200);
    failures.push({ file: path.relative(path.join(__dirname, ".."), file), msg: msg.trim() });
  }
}

if (failures.length) {
  console.error(`Frontend syntax check FAILED for ${failures.length} file(s):`);
  for (const f of failures) console.error(`  ${f.file}: ${f.msg}`);
  process.exit(1);
}
console.log(`Frontend syntax check passed — ${files.length} module(s) parse as ES modules.`);
