#!/usr/bin/env node
/**
 * Smoke test for homelab-mcp — exercises the probe logic directly (not via stdio),
 * so failures are easy to read. Runs `check_all` against the configured services.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = process.env.HOMELAB_MCP_CONFIG
  ? resolve(process.env.HOMELAB_MCP_CONFIG)
  : join(__dirname, "services.json");
const parsed = JSON.parse(readFileSync(configPath, "utf8"));
const services = Array.isArray(parsed) ? parsed : parsed.services;

async function probe(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "homelab-mcp-test" } });
    return { ok: true, status: res.status, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err.name === "AbortError" ? `timeout ${timeoutMs}ms` : err.message, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

let exit = 0;
for (const svc of services) {
  const url = svc.healthUrl || svc.url;
  const p = await probe(url);
  const status = p.ok && p.status >= 200 && p.status < 400 ? "UP" : p.ok ? "DEGRADED" : "DOWN";
  const line = `${status.padEnd(8)} ${svc.name.padEnd(10)} ${p.ok ? p.status : "ERR"} ${p.latencyMs}ms${p.error ? " — " + p.error : ""}`;
  console.log(line);
  if (status === "DOWN") exit = 1;
}
console.log(`\nDone. exit=${exit}`);
process.exit(exit);
