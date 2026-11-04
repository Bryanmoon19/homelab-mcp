#!/usr/bin/env node
/**
 * homelab-mcp — a read-only MCP server that exposes Bryan's self-hosted
 * services as queryable tools/resources for any MCP-capable client
 * (Claude Desktop, Claude Code, OpenClaw, Cursor, etc.).
 *
 * Config-driven: all services live in services.json. Nothing is written,
 * mutated, or exfiltrated — every tool is a GET / status read.
 *
 * Usage:
 *   node index.js            # stdio transport (default for MCP clients)
 *   node index.js --help
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Config path: default to the committed example (services.json). Set
// HOMELAB_MCP_CONFIG to point at an untracked local file (e.g.
// services.local.json) holding your real LAN addresses, so they never enter git.
const CONFIG_PATH = process.env.HOMELAB_MCP_CONFIG
  ? resolve(process.env.HOMELAB_MCP_CONFIG)
  : join(__dirname, "services.json");

// --- load services ---------------------------------------------------------
function loadServices() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `Config not found at ${CONFIG_PATH}. Copy services.json to services.local.json ` +
        `and set HOMELAB_MCP_CONFIG=/path/to/services.local.json, or run against the bundled example.`
    );
  }
  const raw = readFileSync(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : parsed.services;
  if (!Array.isArray(list)) throw new Error("services.json must be an array (or {services:[...]})");
  return list;
}

const services = loadServices();

const server = new McpServer(
  { name: "homelab-mcp", version: "1.0.0" },
  { instructions: "Read-only access to Bryan's self-hosted homelab services. Query status, health, and metadata. No mutations." }
);

// --- helpers ---------------------------------------------------------------
function findService(name) {
  return services.find((s) => s.name.toLowerCase() === String(name).toLowerCase());
}

async function probe(url, { timeoutMs = 4000, method = "GET" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "homelab-mcp/1.0" },
    });
    const ms = Date.now() - started;
    const body = await res.text().catch(() => "");
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      latencyMs: ms,
      contentType: res.headers.get("content-type") || "",
      bodyPreview: body.slice(0, 400),
    };
  } catch (err) {
    const ms = Date.now() - started;
    return {
      ok: false,
      error: err.name === "AbortError" ? `timeout after ${timeoutMs}ms` : err.message,
      latencyMs: ms,
    };
  } finally {
    clearTimeout(timer);
  }
}

function healthOf(p) {
  if (!p.ok) return "DOWN";
  if (p.status >= 200 && p.status < 400) return "UP";
  return "DEGRADED";
}

// --- resources -------------------------------------------------------------
server.registerResource(
  "services",
  "homelab://services",
  { title: "Configured homelab services", mimeType: "application/json" },
  async () => ({
    contents: [
      {
        uri: "homelab://services",
        mimeType: "application/json",
        text: JSON.stringify(services, null, 2),
      },
    ],
  })
);

// --- tools -----------------------------------------------------------------
server.registerTool(
  "list_services",
  {
    title: "List configured homelab services",
    description:
      "Return the list of self-hosted services this MCP server knows about, with their name, base URL, and a short description. No network calls are made.",
  },
  async () => {
    const rows = services.map((s) => ({
      name: s.name,
      url: s.url,
      description: s.description || "",
      kind: s.kind || "http",
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { services: rows, count: rows.length },
    };
  }
);

const checkServiceSchema = {
  name: z.string().describe("Exact service name from list_services, e.g. 'autobrr'."),
  timeoutMs: z
    .number()
    .int()
    .min(500)
    .max(15000)
    .optional()
    .describe("Request timeout in ms. Defaults to 4000."),
};

server.registerTool(
  "check_service",
  {
    title: "Check a single service",
    description:
      "Probe one configured service's health endpoint over HTTP and report status code, latency, and a short body preview. Read-only GET.",
    inputSchema: checkServiceSchema,
  },
  async ({ name, timeoutMs }) => {
    const svc = findService(name);
    if (!svc) {
      return {
        content: [
          { type: "text", text: `Unknown service "${name}". Known: ${services.map((s) => s.name).join(", ")}` },
        ],
        isError: true,
      };
    }
    const url = svc.healthUrl || svc.url;
    const p = await probe(url, { timeoutMs: timeoutMs || 4000 });
    const health = healthOf(p);
    const text = [
      `${svc.name}: ${health}`,
      `  url: ${url}`,
      p.ok
        ? `  status: ${p.status} ${p.statusText} (${p.latencyMs}ms)`
        : `  error: ${p.error} (${p.latencyMs}ms)`,
    ].join("\n");
    return {
      content: [{ type: "text", text }],
      structuredContent: { name: svc.name, health, ...p },
    };
  }
);

server.registerTool(
  "check_all",
  {
    title: "Check all services",
    description:
      "Probe every configured service and return a health summary (UP / DEGRADED / DOWN with status and latency). Read-only GET across the fleet.",
    inputSchema: { timeoutMs: z.number().int().min(500).max(15000).optional().describe("Per-request timeout, default 4000ms.") },
  },
  async ({ timeoutMs }) => {
    const t = timeoutMs || 4000;
    const results = [];
    for (const svc of services) {
      const url = svc.healthUrl || svc.url;
      const p = await probe(url, { timeoutMs: t });
      results.push({ name: svc.name, url, health: healthOf(p), status: p.ok ? p.status : null, latencyMs: p.latencyMs, error: p.ok ? null : p.error });
    }
    const up = results.filter((r) => r.health === "UP").length;
    const down = results.filter((r) => r.health === "DOWN").length;
    const degraded = results.length - up - down;
    const lines = [`${up} up, ${degraded} degraded, ${down} down (${results.length} total)`];
    for (const r of results) {
      lines.push(`  ${r.health.padEnd(8)} ${r.name.padEnd(14)} ${r.status ?? "ERR"} ${r.latencyMs}ms${r.error ? " — " + r.error : ""}`);
    }
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: { up, degraded, down, total: results.length, results },
    };
  }
);

// --- run -------------------------------------------------------------------
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`homelab-mcp v1.0.0
Read-only MCP server for self-hosted homelab services.

Run:      node index.js        (stdio transport)
Config:   services.json       (array of { name, url, description, healthUrl?, kind? })
Connect:  add to your MCP client's config:
  Claude Desktop / Claude Code / OpenClaw / Cursor:
    { "mcpServers": { "homelab": { "command": "node", "args": ["${__dirname}/index.js"] } } }`);
  process.exit(0);
}

const transport = new StdioServerTransport();
await server.connect(transport);
