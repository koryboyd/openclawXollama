// src/utils/audit.ts
/**
 * Simple JSON‑line audit logger.
 *
 * • Writes to `${process.cwd()}/.openclaw_audit.log`
 * • Enabled only when `OPENCLAW_AUDIT=1` or the CLI receives `--audit`.
 * • No external dependencies – uses Node's built‑in `fs`.
 */

export type AuditRecord = {
  ts: string;                     // ISO timestamp (added automatically)
  level: "info" | "debug" | "error";
  event: string;                  // short identifier, e.g. "msg_sent"
  payload: Record<string, unknown>;
};

let _fd: number | null = null;

/** Open (or create) the audit file – lazy, called only when needed. */
function _open(): void {
  if (_fd !== null) return;
  const path = `${process.cwd()}/.openclaw_audit.log`;
  const fs = require("node:fs");
  // Append‑only, file mode 0o600 (owner read/write only)
  _fd = fs.openSync(path, "a", 0o600);
}

/** Write a record – best‑effort, ignore any errors (the logger must never crash the app). */
export function audit(rec: AuditRecord): void {
  if (process.env.OPENCLAW_AUDIT !== "1") return;
  try {
    _open();
    const fs = require("node:fs");
    const line = JSON.stringify({ ...rec, ts: new Date().toISOString() }) + "\n";
    fs.writeSync(_fd!, line);
  } catch {
    // Swallow – auditing must never affect normal operation.
  }
}

/** Call from the CLI entry‑point to enable the logger when `--audit` is supplied. */
export function enableAuditIfRequested(): void {
  if (process.argv.includes("--audit")) {
    process.env.OPENCLAW_AUDIT = "1";
  }
}
