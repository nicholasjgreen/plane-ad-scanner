/**
 * T004 [TDD] — Site status state machine unit tests.
 * Write first; confirm failing before implementing siteStatus.ts (T005).
 * Covers all 14 valid transitions, all invalid transitions throw InvalidTransitionError,
 * canTransition returns correct booleans, and disable is valid from every non-disabled status.
 */
import { describe, it, expect } from 'vitest';
import {
  applyTransition,
  canTransition,
  InvalidTransitionError,
} from '../../src/services/siteStatus.js';
import type { SiteStatus, SiteAction } from '../../src/services/siteStatus.js';

// ---------------------------------------------------------------------------
// Valid transitions — 14 rows from the contract transition table
// ---------------------------------------------------------------------------

describe('applyTransition — valid transitions', () => {
  it('pending + approve_verification → enabled', () => {
    expect(applyTransition('pending', 'approve_verification')).toBe('enabled');
  });

  it('pending + reject_verification → verification_failed', () => {
    expect(applyTransition('pending', 'reject_verification')).toBe('verification_failed');
  });

  it('pending + disable → disabled', () => {
    expect(applyTransition('pending', 'disable')).toBe('disabled');
  });

  it('pending + trigger_verify → pending (no-op re-trigger)', () => {
    expect(applyTransition('pending', 'trigger_verify')).toBe('pending');
  });

  it('enabled + disable → disabled', () => {
    expect(applyTransition('enabled', 'disable')).toBe('disabled');
  });

  it('enabled + trigger_verify → pending', () => {
    expect(applyTransition('enabled', 'trigger_verify')).toBe('pending');
  });

  it('disabled + enable → enabled', () => {
    expect(applyTransition('disabled', 'enable')).toBe('enabled');
  });

  it('verification_failed + trigger_verify → pending', () => {
    expect(applyTransition('verification_failed', 'trigger_verify')).toBe('pending');
  });

  it('verification_failed + disable → disabled', () => {
    expect(applyTransition('verification_failed', 'disable')).toBe('disabled');
  });
});

// ---------------------------------------------------------------------------
// Invalid transitions — all must throw InvalidTransitionError
// ---------------------------------------------------------------------------

describe('applyTransition — invalid transitions throw InvalidTransitionError', () => {
  const invalid: Array<[SiteStatus, SiteAction]> = [
    ['pending', 'enable'],
    ['enabled', 'approve_verification'],
    ['enabled', 'reject_verification'],
    ['enabled', 'enable'],
    ['disabled', 'disable'],
    ['disabled', 'trigger_verify'],
    ['verification_failed', 'enable'],
    ['verification_failed', 'approve_verification'],
    ['verification_failed', 'reject_verification'],
  ];

  for (const [status, action] of invalid) {
    it(`${status} + ${action} → throws InvalidTransitionError`, () => {
      expect(() => applyTransition(status, action)).toThrowError(InvalidTransitionError);
    });
  }
});

// ---------------------------------------------------------------------------
// InvalidTransitionError message content
// ---------------------------------------------------------------------------

describe('InvalidTransitionError', () => {
  it('has informative message', () => {
    let err: unknown;
    try {
      applyTransition('enabled', 'approve_verification');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InvalidTransitionError);
    expect((err as InvalidTransitionError).message).toContain('approve_verification');
    expect((err as InvalidTransitionError).message).toContain('enabled');
    expect((err as InvalidTransitionError).name).toBe('InvalidTransitionError');
  });
});

// ---------------------------------------------------------------------------
// canTransition — boolean queries for all valid and some invalid combinations
// ---------------------------------------------------------------------------

describe('canTransition', () => {
  // Valid
  it('pending + approve_verification → true', () => {
    expect(canTransition('pending', 'approve_verification')).toBe(true);
  });
  it('pending + reject_verification → true', () => {
    expect(canTransition('pending', 'reject_verification')).toBe(true);
  });
  it('pending + disable → true', () => {
    expect(canTransition('pending', 'disable')).toBe(true);
  });
  it('pending + trigger_verify → true', () => {
    expect(canTransition('pending', 'trigger_verify')).toBe(true);
  });
  it('enabled + disable → true', () => {
    expect(canTransition('enabled', 'disable')).toBe(true);
  });
  it('enabled + trigger_verify → true', () => {
    expect(canTransition('enabled', 'trigger_verify')).toBe(true);
  });
  it('disabled + enable → true', () => {
    expect(canTransition('disabled', 'enable')).toBe(true);
  });
  it('verification_failed + trigger_verify → true', () => {
    expect(canTransition('verification_failed', 'trigger_verify')).toBe(true);
  });
  it('verification_failed + disable → true', () => {
    expect(canTransition('verification_failed', 'disable')).toBe(true);
  });

  // Invalid
  it('pending + enable → false', () => {
    expect(canTransition('pending', 'enable')).toBe(false);
  });
  it('enabled + approve_verification → false', () => {
    expect(canTransition('enabled', 'approve_verification')).toBe(false);
  });
  it('disabled + disable → false', () => {
    expect(canTransition('disabled', 'disable')).toBe(false);
  });
  it('disabled + trigger_verify → false', () => {
    expect(canTransition('disabled', 'trigger_verify')).toBe(false);
  });
  it('verification_failed + enable → false', () => {
    expect(canTransition('verification_failed', 'enable')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// disable is valid from every non-disabled status
// ---------------------------------------------------------------------------

describe('disable action from every non-disabled status', () => {
  const nonDisabled: SiteStatus[] = ['pending', 'enabled', 'verification_failed'];
  for (const status of nonDisabled) {
    it(`can disable from ${status}`, () => {
      expect(canTransition(status, 'disable')).toBe(true);
      expect(applyTransition(status, 'disable')).toBe('disabled');
    });
  }
});
