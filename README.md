# NEXUS Command Center

**Classification:** RESEARCH (experimental virtual company / multi-agent command surface)
**Claim Level:** ≤2 (hypothesis / design; no production deployment, measured efficacy, or autonomous spend claims)
**Governing Source:** [ADL-Governance](https://github.com/beyond-repair/ADL-Governance)

## Purpose
Local-first TanStack Start application providing a command center for establishing missions, coordinating structured department handoffs (Executive, Research, Engineering, Creative, Quality, Governance), recording outcomes, and owner acceptance/rejection of packets.

Agents cannot deploy, spend, or self-accept. Each step is owner-initiated. Writing uses a free public model (GPT-OSS 20B). GitHub integration is read-only (token sealed, no write ops).

## Status
- Under active development / experimental.
- Tests present (`npm test`, `npm run typecheck`).
- No production CI badge yet (workflow scaffolded this cycle).
- No unsupported claims of completed AGI, autonomous company, or validated economic outcomes.

## Quick Start (local)
```bash
npm install
npm run dev   # listens on 0.0.0.0:8080
```

See `AGENTS.md` for App Builder workspace contract and `package.json` for scripts.

## Governance
All changes must remain idempotent, claim-capped, and documented in ADL-Governance. No history rewrites. Operator review for any archive/release decisions.

**REWRITE · BUILD · TRANSCEND**
