# Contract: Site Status Service

**Feature**: 003-site-discovery-management
**Date**: 2026-04-04

---

## Role

`src/services/siteStatus.ts` — pure functions implementing the site status state machine. No DB access; takes current status as input and returns new status or throws on invalid transition. TDD-mandatory per Constitution Principle V.

---

## Functions

```typescript
type SiteStatus = 'pending' | 'enabled' | 'disabled' | 'verification_failed';

/**
 * Returns the new status after a given action, or throws if the transition is invalid.
 */
function applyTransition(
  current: SiteStatus,
  action: SiteAction
): SiteStatus;

type SiteAction =
  | 'approve_verification'   // Admin approves sample → enabled
  | 'reject_verification'    // Admin rejects sample → verification_failed
  | 'disable'                // Admin disables → disabled (valid from any status)
  | 'enable'                 // Admin re-enables → enabled (valid from disabled only)
  | 'trigger_verify';        // Admin triggers re-verify → pending (valid from enabled, verification_failed)

/**
 * Returns true if the given action is valid from the current status.
 */
function canTransition(current: SiteStatus, action: SiteAction): boolean;
```

---

## Transition Table

| Current Status | Action | New Status | Valid? |
|---------------|--------|------------|--------|
| `pending` | `approve_verification` | `enabled` | ✓ |
| `pending` | `reject_verification` | `verification_failed` | ✓ |
| `pending` | `disable` | `disabled` | ✓ |
| `pending` | `enable` | — | ✗ |
| `pending` | `trigger_verify` | `pending` | ✓ (no-op, re-runs) |
| `enabled` | `disable` | `disabled` | ✓ |
| `enabled` | `trigger_verify` | `pending` | ✓ |
| `enabled` | `approve_verification` | `enabled` | ✗ |
| `enabled` | `reject_verification` | — | ✗ |
| `enabled` | `enable` | — | ✗ |
| `disabled` | `enable` | `enabled` | ✓ |
| `disabled` | `disable` | — | ✗ |
| `disabled` | `trigger_verify` | — | ✗ |
| `verification_failed` | `trigger_verify` | `pending` | ✓ |
| `verification_failed` | `disable` | `disabled` | ✓ |
| `verification_failed` | `enable` | — | ✗ |
| `verification_failed` | `approve_verification` | — | ✗ |
| `verification_failed` | `reject_verification` | — | ✗ |

---

## Error Behaviour

`applyTransition` throws `InvalidTransitionError` (a named `Error` subclass) when the transition is invalid. Callers (admin route handlers) catch this and redirect with an error flash message.

```typescript
class InvalidTransitionError extends Error {
  constructor(current: SiteStatus, action: SiteAction) {
    super(`Cannot apply '${action}' to site in status '${current}'`);
    this.name = 'InvalidTransitionError';
  }
}
```

---

## TDD Requirements

Tests in `tests/unit/siteStatus.test.ts` MUST be written and failing BEFORE `siteStatus.ts` is implemented. Cover:

1. All valid transitions (14 valid rows from table above)
2. All invalid transitions throw `InvalidTransitionError`
3. `canTransition` returns correct boolean for all combinations
4. `disable` is valid from every non-disabled status
