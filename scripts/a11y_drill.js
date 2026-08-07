"use strict";
/* eslint-disable no-console */
// E28 accessibility + i18n drill (plan §68, §69, §115, RA-20).
// Boots the app against the dev database, then in a real browser:
//   1. axe-core scan of login, portfolio wall, My Actions, Executive
//      — fails on any serious/critical violation;
//   2. keyboard-only login (Tab + Enter, no mouse);
//   3. FR language switch — asserts French strings actually render.
// Usage: DATABASE_URL=... node scripts/a11y_drill.js  (server must NOT be running)
// Requires: npm dev deps (axe-core, playwright-core) + system Chromium.
const path = require("path");
const { spawn } = require("child_process");

const PORT = process.env.A11Y_PORT || 3210;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_BIN || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const LOGIN_EMAIL = process.env.A11Y_EMAIL || "inf.lead@endeavourmining.com";
const LOGIN_PASSWORD = process.env.A11Y_PASSWORD || "Endeavour-2026!";

async function main() {
  const { chromium } = require("playwright-core");
  const axeSource = require("fs").readFileSync(
    path.join(__dirname, "..", "node_modules", "axe-core", "axe.min.js"), "utf8");

  const server = spawn(process.execPath, [path.join(__dirname, "..", "src", "server.js")], {
    env: { ...process.env, PORT, SESSION_SECRET: process.env.SESSION_SECRET || "a11y-drill" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(d));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 15000);
    server.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); resolve(); } });
  });

  const browser = await chromium.launch({ executablePath: CHROME });
  // bypassCSP lets the drill inject axe-core; the app's CSP itself is untouched
  const page = await (await browser.newContext({ bypassCSP: true })).newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(e.message));
  let failed = false;

  async function axeScan(label) {
    await page.addScriptTag({ content: axeSource });
    const res = await page.evaluate(() =>
      window.axe.run(document, { resultTypes: ["violations"] }));
    const bad = res.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    const minor = res.violations.filter((v) => !["serious", "critical"].includes(v.impact));
    console.log(`[axe] ${label}: ${bad.length} serious/critical, ${minor.length} minor/moderate`);
    for (const v of bad) {
      failed = true;
      console.log(`  ✗ ${v.impact} ${v.id}: ${v.help} (${v.nodes.length} nodes)`);
      for (const n of v.nodes.slice(0, 3)) console.log(`     ${n.target.join(" ")}`);
    }
    for (const v of minor) console.log(`  · ${v.impact || "n/a"} ${v.id} (${v.nodes.length} nodes)`);
  }

  // ---- 1. login page: axe + keyboard-only sign-in ----
  await page.goto(BASE);
  await page.waitForSelector("input[name=email]");
  await axeScan("login (EN)");

  await page.keyboard.press("Tab"); // move focus off autofocused email? ensure email focused
  await page.focus("input[name=email]");
  await page.keyboard.type(LOGIN_EMAIL);
  await page.keyboard.press("Tab");
  await page.keyboard.type(LOGIN_PASSWORD);
  await page.keyboard.press("Enter"); // submit without mouse
  await page.waitForSelector(".sidenav", { timeout: 10000 });
  console.log("[kbd] keyboard-only login OK");

  // ---- 2. core views: axe ----
  await page.waitForTimeout(600);
  await axeScan("portfolio wall (EN)");
  await page.goto(`${BASE}/#/my`);
  await page.waitForSelector(".section-title", { timeout: 8000 });
  await axeScan("my actions (EN)");
  await page.goto(`${BASE}/#/exec`);
  await page.waitForSelector(".kpi-banner", { timeout: 8000 });
  await axeScan("executive (EN)");

  // ---- 3. FR switch: strings actually change ----
  await page.goto(`${BASE}/#/portfolio`);
  await page.waitForSelector(".filterbar", { timeout: 8000 });
  await page.click('.lang-pick[data-lang="fr"]');
  await page.waitForTimeout(800);
  const frBody = await page.textContent("body");
  const frChecks = [
    ["nav FR", frBody.includes("Mes actions")],
    ["wall title FR", frBody.includes("Mur des projets")],
    ["filters FR", frBody.includes("Effacer les filtres")],
    ["html lang", await page.evaluate(() => document.documentElement.lang) === "fr"],
  ];
  for (const [label, ok] of frChecks) {
    console.log(`[i18n] ${label}: ${ok ? "OK" : "MISSING"}`);
    if (!ok) failed = true;
  }
  await page.goto(`${BASE}/#/my`);
  await page.waitForSelector(".section-title", { timeout: 8000 });
  const frMy = await page.textContent("body");
  const myFr = frMy.includes("Actions ouvertes");
  console.log(`[i18n] my-actions FR: ${myFr ? "OK" : "MISSING"}`);
  if (!myFr) failed = true;
  await axeScan("my actions (FR)");

  if (jsErrors.length) {
    failed = true;
    console.log("[js] page errors:", jsErrors.join(" | "));
  } else console.log("[js] no page errors");

  await browser.close();
  server.kill();
  console.log(failed ? "A11Y DRILL: FAIL" : "A11Y DRILL: PASS");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
