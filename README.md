# homelab-mcp

A **read-only MCP server** that exposes your self-hosted homelab services to any
MCP-capable client (Claude Desktop, Claude Code, OpenClaw, Cursor, etc.) as queryable
tools and resources.

Ask your AI assistant *"is my homelab healthy?"* and it can actually check — without you
handing it SSH keys or write access.

## Why this exists

A homelab (Proxmox, autobrr, slskd, Lidarr, Plex, NAS…) is a lot of moving parts spread
across a few IPs. The MCP pattern ("USB-C for AI tooling" — see
[`awesome-mcp-servers`](https://github.com/punkpeye/awesome-mcp-servers)) is the natural
fit: a small, auditable surface that lets any model read live status instead of guessing.

This is deliberately **read-only**. Every tool is an HTTP `GET` / health probe. Nothing
is written, mutated, or exfiltrated. That's the whole point — it's a safe thing to plug
into an agent, because the worst it can do is tell you a service is down.

## Tools

| Tool | What it does |
|------|--------------|
| `list_services` | Return the configured service registry (name, URL, description). No network calls. |
| `check_service` | Probe one service's health endpoint — status, latency, body preview. |
| `check_all` | Probe every service; return an UP / DEGRADED / DOWN summary. |

## Resources

| URI | Contents |
|-----|----------|
| `homelab://services` | The full JSON service registry. |

## Quick start

```bash
cd homelab-mcp
npm install

# 1. Create your local config from the example
cp services.json services.local.json

# 2. Edit services.local.json with your real service URLs/ports

# 3. Run (points at services.local.json via env var)
HOMELAB_MCP_CONFIG=./services.local.json node index.js

# Smoke-test the probes directly, human-readable
HOMELAB_MCP_CONFIG=./services.local.json node test.mjs
```

## Connect to a client

Add to your client's MCP config:

```json
{
  "mcpServers": {
    "homelab": {
      "command": "node",
      "args": ["/path/to/homelab-mcp/index.js"],
      "env": { "HOMELAB_MCP_CONFIG": "/path/to/homelab-mcp/services.local.json" }
    }
  }
}
```

- **Claude Desktop** — `claude_desktop_config.json`
- **Claude Code** — `claude mcp add homelab --env HOMELAB_MCP_CONFIG=/path/to/services.local.json -- node /path/to/homelab-mcp/index.js`
- **Cursor** — Settings → MCP → Add

## Configuring services

Config is a JSON file of service entries. The repo ships `services.json` as a **placeholder
example** (dummy `192.168.1.x` addresses) — copy it to `services.local.json` (gitignored)
and put your real addresses there, then point `HOMELAB_MCP_CONFIG` at it. Each entry:

```json
{
  "name": "autobrr",
  "url": "http://192.168.1.50:7474",
  "healthUrl": "http://192.168.1.50:7474/api/healthz/liveness",
  "description": "autobrr — torrent/Usenet automation",
  "kind": "http"
}
```

- `name` — exact name you'll pass to `check_service`.
- `url` — the human-facing base URL.
- `healthUrl` (optional) — the probed path; use a cheap health/status endpoint when the
  service exposes one (fall back to `url` / root otherwise).
- `kind` — reserved for future non-HTTP adapters (SSH, ICMP, Docker API).

**Adding a service = adding a line.** No code changes needed. To extend beyond HTTP
probes (e.g. read Docker stats via the Docker socket, or Proxmox VM status via its
read-only API), add a `kind` and a probe function — the tool surface stays the same.

### Config resolution order

1. `HOMELAB_MCP_CONFIG` env var, if set (absolute path or relative to CWD).
2. `services.json` in the repo root (the bundled example).

## Security notes

- **Read-only by construction.** Only `GET` / health probes. No tokens, no secrets in
  the repo (auth'd endpoints like Lidarr's `/api/v1/*` return 401 and are reported as
  DEGRADED, which is correct — the server never holds those keys).
- **Keep real addresses out of git.** `services.local.json` is gitignored; the committed
  `services.json` contains only dummy `192.168.1.x` placeholders. Don't commit real LAN
  topology — fork/archive copies are effectively permanent.
- **LAN addresses only.** The server assumes the client runs on the trusted network. If
  you ever bind this to a remote/agent context, that's a trust boundary you're crossing
  deliberately — don't.

## Roadmap (ideas, not commitments)

- Proxmox VM/LXC status via the host's read-only API (`/api2/json/...`, GET only).
- Plex "recently added" / server health via the Plex token.
- NAS free-space check via SSH/SMB.
- A `homelab://health` aggregate resource that caches the last `check_all` result.

---

Built as a read-only-by-construction MCP pattern for self-hosted homelabs. Companion
guide on [devhandbook.io](https://devhandbook.io).
