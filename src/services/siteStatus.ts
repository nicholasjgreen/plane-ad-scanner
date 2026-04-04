// Pure state machine for site status transitions.
// No DB access — takes current status, returns new status or throws.

export type SiteStatus = 'pending' | 'enabled' | 'disabled' | 'verification_failed';

export type SiteAction =
  | 'approve_verification'
  | 'reject_verification'
  | 'disable'
  | 'enable'
  | 'trigger_verify';

export class InvalidTransitionError extends Error {
  constructor(current: SiteStatus, action: SiteAction) {
    super(`Cannot apply '${action}' to site in status '${current}'`);
    this.name = 'InvalidTransitionError';
  }
}

// Transition table: [current][action] → new status, or undefined if invalid.
const TRANSITIONS: Partial<Record<SiteStatus, Partial<Record<SiteAction, SiteStatus>>>> = {
  pending: {
    approve_verification: 'enabled',
    reject_verification: 'verification_failed',
    disable: 'disabled',
    trigger_verify: 'pending',
  },
  enabled: {
    disable: 'disabled',
    trigger_verify: 'pending',
  },
  disabled: {
    enable: 'enabled',
  },
  verification_failed: {
    trigger_verify: 'pending',
    disable: 'disabled',
  },
};

export function applyTransition(current: SiteStatus, action: SiteAction): SiteStatus {
  const next = TRANSITIONS[current]?.[action];
  if (next === undefined) {
    throw new InvalidTransitionError(current, action);
  }
  return next;
}

export function canTransition(current: SiteStatus, action: SiteAction): boolean {
  return TRANSITIONS[current]?.[action] !== undefined;
}
