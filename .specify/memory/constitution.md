<!--
SYNC IMPACT REPORT
==================
Version change: 1.3.0 → 1.4.0 (MINOR: Principle IX added; Principles II and V materially amended)

Modified principles:
  - Principle II. Resilience over Completeness
      "Retry logic is OPTIONAL" removed. LLM/external API calls now MUST include retry logic
      co-located with the call site. Outer-wrapper retry is explicitly disallowed as the
      sole mechanism (it cannot observe errors swallowed by agent-level try/catch).
  - Principle V. Test-First for Core Logic
      Unhappy path coverage elevated to mandatory. Data quality handling (rendering of
      absent/malformed data) is now explicitly required to have unit tests. Silent drops
      are declared bugs, not acceptable omissions.

Added sections:
  - Principle IX. Data Quality & Defensive Handling (new)

Removed sections: none

Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no change needed (Constitution Check is dynamic)
  - .specify/templates/spec-template.md ✅ no change needed (edge cases section already present)
  - .specify/templates/tasks-template.md ✅ no change needed (unhappy-path tasks are now
      constitution-mandated; tasks command will generate them per Principle V)
  - README.md ✅ no change needed

Deferred TODOs: none

Context: Real incidents drove these changes:
  1. renderIndicatorRow silently returned '' for undefined indicator fields — no test caught
     it because unhappy paths were not constitutionally required.
  2. Indicator deriver 429 retry was implemented in an outer orchestrator wrapper, but the
     agent's top-level try/catch swallowed the error before the wrapper could see it. Retry
     MUST be co-located with the API call.
  3. Principle IX formalises "make data quality problems visible" as a project-wide rule.
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
- **LLM and external API calls MUST include retry logic for transient failures** (e.g.,
  rate-limit 429 responses). Logging and moving on is acceptable only for non-transient
  errors (e.g., a scraper returning a permanent 404).
- **Retry logic MUST be co-located with the API call it guards.** An outer wrapper is not
  sufficient when the inner call site has its own error handling (try/catch) that can swallow
  the raw error before the wrapper sees it. The retry loop MUST wrap the specific
  `anthropic.messages.create` (or equivalent) call directly.
- Retry MUST respect `Retry-After` headers where present, and MUST cap the total number of
  attempts (default: 4) and the per-attempt wait time to prevent indefinite blocking.

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

**Unhappy path coverage is mandatory, not optional:**

- For every function or rendering path that handles potentially absent, null, or malformed
  data, at least one test MUST exercise each distinct failure/absent state.
- Data quality handling MUST have explicit unit tests. A silent drop — returning an empty
  string or `undefined` instead of a visible "Not derived" / "Unknown" indicator — is a bug
  and MUST be caught by tests, not discovered at runtime.
- Retry and error-recovery paths MUST have unit tests that inject the failure condition
  (e.g., a mock that throws 429 on the first call) and assert the correct outcome.
- "Happy path only" coverage is not acceptable for any module that touches external data,
  LLM responses, or user-facing rendering.

### VI. Agent Architecture

Functionality MUST be decomposed into specialised agents using the Anthropic Agent SDK. Each
agent has a single responsibility, a restricted tool set, and clearly defined inputs/outputs:

**Mandatory agent roles:**

| Agent | Responsibility | Permitted tools |
|-------|---------------|-----------------|
| Orchestrator | Coordinates a full scan run; delegates to and aggregates results from all other agents | State read, spawn sub-agents |
| Scraper (per site) | Fetches and parses raw listings from one aircraft-for-sale website | HTTP GET only |
| Matcher | Evaluates a batch of raw listings against the user's interest profiles; scores listings and produces ranked output | None (pure logic) |
| Historian | Reads/writes the seen-listings store; deduplicates incoming listings | State read/write only |
| Presenter | Generates AI headlines and plain-English interest explanations for listings; stores results for web display | None (pure generation) |

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
- The Historian agent MUST NOT make network requests.
- The Presenter agent MUST NOT read or write persistent state directly; it receives listing
  data as input and returns generated content as output only.

**Human-in-the-loop:**
- A configurable `requireApproval` mode MUST be supported: when enabled, the Orchestrator
  pauses after the Matcher completes and presents the matched listings for user confirmation
  before proceeding with Presenter generation and persistence.
- `requireApproval` defaults to `false` for scheduled/unattended runs and `true` for
  manual/debug runs.

**Output safety:**
- All agent outputs MUST be treated as untrusted until schema-validated.
- Agent outputs MUST NOT be interpolated into shell commands or rendered as raw HTML.
- Listing URLs extracted by Scraper agents MUST be validated as http/https before persistence.

### VIII. Living Documentation

Documentation MUST be kept current as a first-class deliverable, not deferred to the end of
a feature or release cycle. Documentation that is wrong is worse than no documentation.

**README — project entry point:**
- `README.md` MUST contain enough information for someone (or a future AI session) to set up
  and run the tool from scratch: prerequisites, environment setup, how to start the server,
  how to run a one-off scan, and how to run the tests.
- The README MUST be updated whenever a new feature changes a prerequisite, a startup command,
  or a URL/port.
- A minimal README is acceptable; a stale README is not.

**quickstart.md — per-feature operational guide:**
- Each feature MUST produce a `quickstart.md` as part of the planning phase (speckit.plan).
- `quickstart.md` is the authoritative source of truth for operating the specific feature:
  validation scenarios, workflow steps, and npm scripts.
- It MUST be updated if implementation diverges from the plan (e.g., a command changes).

**In-progress updates:**
- During active implementation (speckit.implement), the README and quickstart.md MUST be
  updated before the feature is considered complete — not as a separate cleanup task.
- Principle VIII compliance MUST be verified in the Constitution Check section of each
  plan.md (alongside Principles I–IX).

### IX. Data Quality & Defensive Handling

All data derived from external sources (scrapers, LLM responses, third-party APIs, the
database) MUST be treated as potentially absent, partial, or malformed at every layer:

**Visibility — never silently drop data quality problems:**
- When an expected value is absent or cannot be derived, the absence MUST be made visible to
  the consumer of that data. In UI/rendered output: display "Not derived", "Unknown", or an
  equivalent explicit label — never an empty string, a blank cell, or a missing element.
- In code: a missing field MUST NOT be silently swallowed by an early `return ''` or
  `return undefined`. The absent state is information and MUST be propagated or rendered.
- In logs: a value that fails validation or cannot be parsed MUST produce a log entry at
  WARN level or above, including the listing/entity ID and the field name.

**Validation — schema-first, not trust-first:**
- LLM responses MUST be parsed and validated against a schema before any downstream code
  uses them. Schema validation failures MUST be logged and treated as a `failed` outcome
  for that entity, not silently skipped.
- Database reads that may return `null` or an unexpected type MUST be handled explicitly —
  not assumed to always be present.

**Testing — data quality paths are first-class:**
- Every rendering, formatting, or transformation function that accepts nullable or optional
  fields MUST have at least one test for each distinct absent/invalid state (null value,
  undefined field, empty string, schema validation failure).
- These tests MUST be written before the implementation (per Principle V's TDD requirement).
- "Works when data is present" is necessary but not sufficient — the absent/malformed cases
  are where bugs hide.

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
- The quickstart.md (produced during planning) is the single source of truth for running a
  specific feature; the README is the project-level entry point — both MUST be kept current
  (see Principle VIII).
- Do not introduce a dependency without first checking whether the standard library or an
  existing dependency already covers the need.
- Agent roles and tool sets MUST be documented in the implementation plan before any agent
  code is written.

## Governance

- This constitution supersedes all other practices. When in conflict, the constitution wins.
- Amendments require: description of the change, version bump rationale, and update to this
  file.
- All implementation plans MUST include a Constitution Check section that verifies compliance
  with Principles I–IX before Phase 0 research begins and again after Phase 1 design.
- Complexity violations are permitted only when documented in the plan's Complexity Tracking
  table.
- The constitution is the canonical runtime guidance document for AI-assisted development
  sessions.

**Version**: 1.4.0 | **Ratified**: 2026-03-29 | **Last Amended**: 2026-04-17
