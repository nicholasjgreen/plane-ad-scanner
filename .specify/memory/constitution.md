<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.1.0 (MINOR: two new agent principles added; stack materially amended)
Modified principles:
  - I. Simplicity First — amended to acknowledge intentional agent complexity
  - Technology Stack — Anthropic Agent SDK and model choice added
Added sections/principles:
  - VI. Agent Architecture (new)
  - VII. Agent Controls (new)
Removed sections: none
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ aligned (Constitution Check covers new principles)
  - .specify/templates/spec-template.md ✅ aligned (no changes needed)
  - .specify/templates/tasks-template.md ✅ aligned (agent phases fit existing phase model)
Deferred TODOs: none
-->

# plane-ad-scanner Constitution

## Core Principles

### I. Simplicity First

This is a single-user personal automation tool. Every design decision MUST default to the
simplest thing that works. YAGNI applies strictly — with one explicit exception: multi-agent
architecture is an intentional, justified design choice (see Principle VI) and its complexity
does not require further justification.

- No feature, abstraction, or dependency may be added speculatively.
- Three lines of direct code beat a premature helper.
- Complexity beyond the agent architecture MUST be justified in writing (Complexity Tracking
  table in plan.md) before it is introduced.
- The tool MUST be operable with zero external services beyond the sites it scans, the
  notification channel, and the Anthropic API.

### II. Resilience over Completeness

The tool runs unattended. A partial result is always better than a crash:

- Any single-site scraper agent failure MUST NOT abort the scan run; remaining agents MUST
  still be processed by the orchestrator.
- All errors MUST be surfaced (logged + included in the notification summary where applicable).
- State MUST be persisted durably after each successful scan so a crash mid-run does not
  duplicate notifications.
- Retry logic is OPTIONAL; logging the failure and moving on is acceptable.

### III. Observability

Since the tool runs unattended for days at a time, every run MUST leave a human-readable
audit trail:

- Structured log entries MUST be written for: run start/end, agent invocations, tool calls
  made by each agent, listings found, listings matched, notifications sent, errors encountered.
- Log output MUST go to stdout (human-readable) and optionally to a file.
- Each notification MUST include a timestamp and the source site.
- Agent token usage MUST be logged per run for cost visibility.
- Silent failures are forbidden; if something goes wrong and nothing is logged, that is a bug.

### IV. Configuration-Driven Behaviour

All user-facing behaviour MUST be controlled via a configuration file, not code changes:

- Target sites, matching criteria, schedule, notification channel, and agent cost budget are
  all config.
- Changing criteria MUST NOT require a code edit or redeploy.
- Config MUST be validated at startup with clear error messages for missing or invalid values.
- Secrets (e.g., `ANTHROPIC_API_KEY`, notification credentials) MUST be supplied via
  environment variables only — never in config files or source code.

### V. Test-First for Core Logic

Scraping and notification delivery are I/O-bound and may be tested with mocks or integration
tests, but the matching/filtering engine and agent orchestration logic are deterministic and
MUST be test-driven:

- Matching/criteria logic: tests written and failing BEFORE implementation (Red-Green-Refactor).
- Deduplication logic: tests written and failing BEFORE implementation.
- Agent orchestration flow: tests written against mocked agent responses BEFORE wiring real
  agents.
- I/O-bound code (scrapers, notifiers): integration or smoke tests acceptable; full TDD not
  required.
- No test infrastructure complexity beyond what the project already uses.

### VI. Agent Architecture

Functionality MUST be decomposed into specialised agents using the Anthropic Agent SDK. Each
agent has a single responsibility, a restricted tool set, and clearly defined inputs/outputs:

**Mandatory agent roles:**

| Agent | Responsibility | Permitted tools |
|-------|---------------|-----------------|
| Orchestrator | Coordinates a full scan run; delegates to and aggregates results from all other agents | State read, spawn sub-agents |
| Scraper (per site) | Fetches and parses raw listings from one aircraft-for-sale website | HTTP GET only |
| Matcher | Evaluates a batch of raw listings against the user's criteria; returns matched listings | None (pure logic) |
| Notifier | Formats and dispatches a notification for matched listings | Notification channel write only |
| Historian | Reads/writes the seen-listings store; deduplicates incoming listings | State read/write only |

- Agents MUST run concurrently where independent (e.g., all Scraper agents launch in parallel).
- Agent outputs MUST be schema-validated before being passed to downstream agents.
- No agent may hold state between runs; all persistent state lives in the Historian's store.
- New agents MAY be introduced for new sites or capabilities, following the same role/tool
  restriction pattern.

### VII. Agent Controls

The full capability of the Anthropic Agent SDK MUST be used, and MUST be paired with
proportionate controls that prevent runaway cost, unintended side effects, and privilege
escalation:

**Cost & resource controls:**
- A configurable per-run token budget MUST be enforced; the orchestrator MUST abort and log a
  warning if the budget is exceeded before all agents complete.
- Each agent invocation MUST have a maximum-turns limit (default: 10) to prevent infinite
  tool-call loops.
- The model used for each agent role SHOULD be the least-capable model sufficient for that
  role (e.g., Haiku for scraping/extraction, Sonnet for matching judgment).

**Permission controls (principle of least privilege):**
- Each agent MUST only be granted the tools listed for its role in Principle VI. No agent
  receives a superset tool set "just in case".
- No agent may write to the configuration file or environment.
- The Notifier agent MUST only send notifications; it MUST NOT read or write persistent state.
- The Historian agent MUST NOT make network requests.

**Human-in-the-loop:**
- A configurable `requireApproval` mode MUST be supported: when enabled, the Orchestrator
  presents matched listings to the user for confirmation before invoking the Notifier.
- `requireApproval` defaults to `false` for scheduled/unattended runs and `true` for
  manual/debug runs.

**Output safety:**
- All agent outputs MUST be treated as untrusted until schema-validated.
- Agent outputs MUST NOT be interpolated into shell commands or rendered as raw HTML.
- Listing URLs extracted by Scraper agents MUST be validated as http/https before inclusion
  in notifications.

## Technology Stack

- **Language**: TypeScript (strict mode enabled)
- **Runtime**: Node.js LTS
- **AI SDK**: Anthropic Agent SDK (`@anthropic-ai/sdk` / `claude-agent-sdk`)
- **Default model**: `claude-haiku-4-5-20251001` for extraction tasks; `claude-sonnet-4-6` for
  judgment/matching tasks — override via config
- **Package manager**: npm or bun (document the choice in plan.md and stay consistent)
- **Testing**: Vitest (preferred) or Jest — one framework only
- **Linting/formatting**: ESLint + Prettier
- **No build step required** for a CLI tool; ts-node or tsx for execution is acceptable

Deviations from this stack MUST be justified in the Complexity Tracking table.

## Development Workflow

- Work is spec-driven: spec → plan → tasks → implement (speckit workflow).
- Each user story is independently implementable and independently testable.
- Commit after each completed task or logical group.
- The quickstart.md (produced during planning) is the single source of truth for running the
  tool.
- Do not introduce a dependency without first checking whether the standard library or an
  existing dependency already covers the need.
- Agent roles and tool sets MUST be documented in the implementation plan before any agent
  code is written.

## Governance

- This constitution supersedes all other practices. When in conflict, the constitution wins.
- Amendments require: description of the change, version bump rationale, and update to this
  file.
- All implementation plans MUST include a Constitution Check section that verifies compliance
  with Principles I–VII before Phase 0 research begins and again after Phase 1 design.
- Complexity violations are permitted only when documented in the plan's Complexity Tracking
  table.
- The constitution is the canonical runtime guidance document for AI-assisted development
  sessions.

**Version**: 1.1.0 | **Ratified**: 2026-03-29 | **Last Amended**: 2026-03-29
