// server/index.js — Bun entry point. `bun run dev` builds the client then runs this
// with --hot.

import { app } from "./app.js";
import { dbPath, db } from "./db.js";
import { existsSync } from "node:fs";

const port = Number(process.env.PORT ?? 8788);

const generatedCss = "./src/styles/tailwind.css.js";
if (!existsSync(generatedCss)) {
  console.warn("! Tailwind stylesheet not generated — run `bun run css` (or `bun run build`).");
}
if (!existsSync("./client/vendor/lit.js")) {
  console.warn("! Lit bundle not vendored — run `bun run vendor` (or `bun run build`).");
}

// Who is sitting on the port. Worth the two subprocesses: "address in use" without a PID
// leaves you running `ss` by hand anyway, and half the time it is a stray copy of this
// server from an earlier run.
function findPortHolder(p) {
  const attempts = [
    ["ss", ["-lptnH", `sport = :${p}`]],
    ["lsof", ["-ti", `:${p}`, "-sTCP:LISTEN"]],
  ];
  for (const [cmd, args] of attempts) {
    try {
      const out = Bun.spawnSync([cmd, ...args], { stderr: "ignore" }).stdout.toString();
      const pid = /pid=(\d+)/.exec(out)?.[1] ?? out.trim().split("\n")[0];
      if (!/^\d+$/.test(pid ?? "")) continue;
      let name = "";
      try {
        name = Bun.spawnSync(["ps", "-p", pid, "-o", "comm="], { stderr: "ignore" })
          .stdout.toString()
          .trim();
      } catch {}
      return { pid, name };
    } catch {}
  }
  return null;
}

function reportPortInUse() {
  const holder = findPortHolder(port);
  const lines = [
    "",
    `✗ Port ${port} is already in use — the server did not start.`,
    "",
    holder
      ? `  Held by PID ${holder.pid}${holder.name ? ` (${holder.name})` : ""}.`
      : "  Could not identify the process holding it.",
    "",
    "  Free it:",
    holder ? `    kill ${holder.pid}` : `    fuser -k ${port}/tcp`,
    `    fuser -k ${port}/tcp        # by port, if the PID above is stale`,
    "",
    "  Or run somewhere else:",
    `    PORT=${port + 1} bun run dev`,
    "",
    "  Inspect first:",
    `    lsof -i:${port}`,
    "",
    // This one has cost real time: pkill -f matches against full command lines, and the
    // shell running the pkill has the pattern in its own, so it kills the terminal.
    `  Do NOT use \`pkill -f server/index.js\` — pkill -f matches its own shell's`,
    "  command line and will kill the terminal you ran it from.",
    "",
  ];
  console.error(lines.join("\n"));
}

let server;
try {
  server = Bun.serve({ port, fetch: app.fetch });
} catch (err) {
  if (err?.code === "EADDRINUSE") {
    reportPortInUse();
    process.exit(1);
  }
  throw err;
}

const branchCount = db.query("select count(*) as c from branch").get().c;
// Explicit indexes only — UNIQUE columns get an implicit sqlite_autoindex with a null sql.
const indexCount = db
  .query("select count(*) as c from sqlite_master where type='index' and sql is not null")
  .get().c;

// Logged after the bind succeeds: printing the URL and then failing to listen reads as the
// server having started.
console.log(`rm-merchant-components  →  http://localhost:${server.port}`);
console.log(`  dataset  ${dbPath}`);
console.log(
  `  branches ${branchCount}   explicit indexes ${indexCount}` +
    (indexCount === 0 ? "  (none yet — see docs/plan.md §7.2)" : ""),
);
