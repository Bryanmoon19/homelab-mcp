# homelab-mcp

A **read-only MCP server** that exposes Bryan's self-hosted homelab services to any
MCP-capable client (Claude Desktop, Claude Code, OpenClaw, Cursor, etc.) as queryable
tools and resources.

Ask your AI assistant *"is my homelab healthy?"* and it can actually check — without you
handing it SSH keys or write access.

## Why this exists

The homelab (Proxmox, autobrr, slskd, VidBee, rackpeek, Lidarr, Plex, NAS…) is a lot of
moving parts spread across a few IPs. The MCP pattern ("USB-C for AI tooling" — see
`awesome-mcp-servers`, ~97k stars) is the natural fit: a small, auditable surface that
lets any model read live status instead of guessing.

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
node index.js            # stdio transport (for MCP clients)
node test.mjs            # smoke-test the probes directly, human-readable
```

## Connect to a client

Add to your client's MCP config:

```json
{
  "mcpServers": {
    "homelab": {
      "command": "node",
      "args": ["/Users/walle/Projects/homelab-mcp/index.js"]
    }
  }
}
```

- **Claude Desktop** — `claude_desktop_config.json`
- **Claude Code** — `claude mcp add homelab -- node /Users/walle/Projects/homelab-mcp/index.js`
- **Cursor** — Settings → MCP → Add

## Configuring services

Edit `services.json`. Each entry:

```json
{
  "name": "autobrr",
  "url": "http://192.168.7.202:7474",
  "healthUrl": "http://192.168.7.202:7474/api/healthz/liveness",
  "description": "autobrr — torrent/Usenet automation",
  "kind": "http"
}
```

- `url` — the human-facing base URL.
- `healthUrl` (optional) — the probed path; use a cheap health/status endpoint when the
  service exposes one (fall back to `url` / root otherwise).
- `kind` — reserved for future non-HTTP adapters (SSH, ICMP, Docker API).

**Adding a service = adding a line.** No code changes needed. To extend beyond HTTP
probes (e.g. read Docker stats via the Docker socket, or Proxmox VM status via its
read-only API), add a `kind` and a probe function — the tool surface stays the same.

## Security notes

- **Read-only by construction.** Only `GET` / health probes. No tokens, no secrets in
  the repo (auth'd endpoints like Lidarr's `/api/v1/*` return 401 and are reported as
  DEGRADED, which is correct — the server never holds those keys).
- **LAN addresses only.** `services.json` assumes the client runs on the trusted network
  (192.168.7.x). If you ever bind this to a remote/agent context, that's a trust
  boundary you're crossing deliberately — don't.
- The `.env.example` / `.gitignore` pattern is here so future non-read-only extensions
  (if any) keep secrets out of git.

## Roadmap (ideas, not commitments)

- Proxmox VM/LXC status via the host's read-only API (`/api2/json/...`, GET only).
- Plex "recently added" / server health via the Plex token.
- NAS free-space check via SSH/SMB.
- A `homelab://health` aggregate resource that caches the last `check_all` result.

---

Built by Moon (Bryan's night-shift). Companion guide post coming on
[devhandbook.io](https://devhandbook.io).
