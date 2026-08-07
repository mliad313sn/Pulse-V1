"use strict";
// Dependency audit gate.
//
// `npm audit --audit-level=low` fails the build on ANY advisory, which is the
// posture we want. But when an advisory has no fix available anywhere in the
// tree, that gate blocks every commit until an upstream maintainer acts —
// and the usual response is to drop the flag, which quietly disables the
// check for everything.
//
// Instead: advisories are allowed ONE AT A TIME, by name, with a written
// justification and a review date. Anything not on the list still fails, and
// an expired entry fails too, so an exception cannot be forgotten.

const { execFileSync } = require("child_process");

// Each entry must state: why it is not exploitable HERE, and when to look again.
const ACCEPTED = [
  {
    package: "image-size",
    advisories: ["GHSA-w3rx-r6r6-pgpr", "GHSA-5p2g-fcmc-qvqq"],
    reason:
      "Denial of service in the ICNS, JXL and HEIF image parsers. Reached only via " +
      "pptxgenjs, which Pulse uses to compose text and tables — the export path never " +
      "calls addImage and no user-supplied image is ever parsed. Every version of " +
      "image-size is affected, and pptxgenjs 4.x pins the same version, so no upgrade " +
      "path exists today.",
    reviewBy: "2026-11-01",
  },
];

function main() {
  let report;
  try {
    // npm audit exits non-zero when it finds anything; capture either way.
    report = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    report = err.stdout;
  }
  if (!report) {
    console.error("audit gate: npm audit produced no output");
    process.exit(1);
  }

  const data = JSON.parse(report);
  const vulns = Object.values(data.vulnerabilities || {});
  const today = new Date().toISOString().slice(0, 10);

  // An expired exception is a failure — that is the point of the review date.
  const expired = ACCEPTED.filter((a) => a.reviewBy < today);
  if (expired.length) {
    console.error("audit gate FAILED — accepted exceptions are past their review date:");
    for (const e of expired) console.error(`  ${e.package} (review was due ${e.reviewBy})`);
    console.error("\nRe-check whether a fix now exists, then extend or remove the entry.");
    process.exit(1);
  }

  const acceptedNames = new Set(ACCEPTED.map((a) => a.package));

  // A package is also acceptable when its ONLY reason for appearing is a
  // dependency on an accepted package — npm reports the whole chain, and
  // listing every dependent by hand would rot the moment the tree changes.
  const isAccepted = (v) => {
    if (acceptedNames.has(v.name)) return true;
    const via = v.via || [];
    return via.length > 0 && via.every((x) => typeof x === "string" && acceptedNames.has(x));
  };
  const unexpected = vulns.filter((v) => !isAccepted(v));

  if (unexpected.length) {
    console.error(`audit gate FAILED — ${unexpected.length} advisory group(s) with no accepted exception:\n`);
    for (const v of unexpected) {
      console.error(`  ${v.name}  severity=${v.severity}  fixAvailable=${JSON.stringify(v.fixAvailable)}`);
      for (const via of v.via) {
        if (typeof via === "object") console.error(`    ${via.title} — ${via.url}`);
      }
    }
    console.error("\nFix it, or add a justified exception with a review date in scripts/audit_gate.js.");
    process.exit(1);
  }

  const accepted = vulns.filter((v) => acceptedNames.has(v.name));
  const viaAccepted = vulns.length - accepted.length;
  if (accepted.length) {
    console.log(`audit gate PASSED with ${accepted.length} documented exception(s):`);
    for (const v of accepted) {
      const entry = ACCEPTED.find((a) => a.package === v.name);
      console.log(`  ${v.name} (${v.severity}) — accepted until ${entry.reviewBy}`);
      console.log(`    ${entry.reason}`);
    }
    if (viaAccepted) console.log(`  plus ${viaAccepted} dependent package(s) flagged only because of the above.`);
  } else {
    console.log("audit gate PASSED — 0 vulnerabilities, 0 exceptions needed.");
  }
}

main();
