"use strict";
// Daily verified backup: 02:00 GMT — pg_dump -Fc to BACKUP_DIR, then a verification
// pass (pg_restore --list); abort + error log on failure; 14-day retention (plan §6).
const cron = require("node-cron");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const BACKUP_DIR = process.env.BACKUP_DIR || "/backups";
const RETENTION_DAYS = 14;

function execP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(`${cmd} failed: ${stderr || err.message}`)) : resolve(stdout)
    );
  });
}

async function runBackup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(BACKUP_DIR, `pulse_${stamp}.dump`);

  await execP("pg_dump", ["-Fc", "-f", file, "--dbname", url]);

  // verification pass: a dump pg_restore cannot list is a dump that cannot restore
  try {
    await execP("pg_restore", ["--list", file]);
  } catch (err) {
    console.error(`[backup] VERIFICATION FAILED for ${file} — removing bad dump. ${err.message}`);
    fs.unlinkSync(file);
    throw err;
  }

  // retention: delete dumps older than 14 days
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  let removed = 0;
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (!f.startsWith("pulse_") || !f.endsWith(".dump")) continue;
    const full = path.join(BACKUP_DIR, f);
    if (fs.statSync(full).mtimeMs < cutoff) {
      fs.unlinkSync(full);
      removed++;
    }
  }
  console.log(`[backup] OK ${file} (verified); ${removed} old dump(s) pruned`);
  return file;
}

function start() {
  cron.schedule("0 2 * * *", () => runBackup().catch((e) => console.error("[backup] FAILED:", e.message)), {
    timezone: "Etc/UTC",
  });
  console.log("[backup] scheduled daily 02:00 GMT");
}

module.exports = { start, runBackup };
