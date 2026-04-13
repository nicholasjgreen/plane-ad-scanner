import { describe, it, expect } from 'vitest';
import { validatePresenterOutput } from '../../src/agents/presenter.js';
import type { PresenterInput } from '../../src/types.js';

const baseInput: PresenterInput = {
  listing: {
    id: 'test-id-1',
    make: 'Cessna',
    model: '172N',
    year: 1978,
    price: 45000,
    priceCurrency: 'GBP',
    location: 'Doncaster',
    sourceSite: 'Trade-A-Plane',
    attributes: {},
  },
  profiles: [
    {
      name: 'IFR Touring',
      weight: 1.0,
      min_score: 60,
      criteria: [],
    },
  ],
};

const inputNoProfiles: PresenterInput = {
  ...baseInput,
  profiles: [],
};

describe('validatePresenterOutput', () => {
  it('returns valid output unchanged when within limits', () => {
    const raw = { headline: 'Short headline', explanation: 'This is a good listing.', status: 'ok' };
    const result = validatePresenterOutput(raw, baseInput);
    expect(result.headline).toBe('Short headline');
    expect(result.explanation).toBe('This is a good listing.');
    expect(result.status).toBe('ok');
    expect(result.listingId).toBe('test-id-1');
  });

  it('truncates headline to 60 chars with ellipsis when too long', () => {
    const longHeadline = 'A'.repeat(70);
    const raw = { headline: longHeadline, explanation: 'Some explanation.', status: 'ok' };
    const result = validatePresenterOutput(raw, baseInput);
    expect(result.headline.length).toBe(60);
    expect(result.headline.endsWith('…')).toBe(true);
  });

  it('replaces blank headline with site+price fallback', () => {
    const raw = { headline: '', explanation: 'Some explanation.', status: 'ok' };
    const result = validatePresenterOutput(raw, baseInput);
    expect(result.headline).toContain('Trade-A-Plane');
    expect(result.headline).toContain('£45,000');
    expect(result.headline).not.toBe('');
  });

  it('replaces whitespace-only headline with site+price fallback', () => {
    const raw = { headline: '   ', explanation: 'Some explanation.', status: 'ok' };
    const result = validatePresenterOutput(raw, baseInput);
    expect(result.headline).toContain('Trade-A-Plane');
    expect(result.headline).not.toBe('');
  });

  it('replaces blank explanation with neutral placeholder', () => {
    const raw = { headline: 'Good headline', explanation: '', status: 'ok' };
    const result = validatePresenterOutput(raw, baseInput);
    expect(result.explanation).toBe('No summary available.');
  });

  it('replaces whitespace-only explanation with neutral placeholder', () => {
    const raw = { headline: 'Good headline', explanation: '   ', status: 'ok' };
    const result = validatePresenterOutput(raw, baseInput);
    expect(result.explanation).toBe('No summary available.');
  });

  it('accepts status "ok"', () => {
    const raw = { headline: 'Good headline', explanation: 'Good explanation.', status: 'ok' };
    const result = validatePresenterOutput(raw, baseInput);
    expect(result.status).toBe('ok');
  });

  it('accepts status "partial"', () => {
    const raw = { headline: 'Good headline', explanation: 'Good explanation.', status: 'partial' };
    const result = validatePresenterOutput(raw, baseInput);
    expect(result.status).toBe('partial');
  });

  it('normalises invalid status to "partial"', () => {
    const raw = { headline: 'Good headline', explanation: 'Good explanation.', status: 'invalid' };
    const result = validatePresenterOutput(raw, baseInput);
    expect(result.status).toBe('partial');
  });

  it('uses status "partial" when no profiles provided', () => {
    const raw = { headline: 'Good headline', explanation: 'Good explanation.', status: 'ok' };
    const result = validatePresenterOutput(raw, inputNoProfiles);
    expect(result.status).toBe('partial');
  });

  it('site-only fallback headline when price is null', () => {
    const inputNullPrice: PresenterInput = {
      ...baseInput,
      listing: { ...baseInput.listing, price: null },
    };
    const raw = { headline: '', explanation: 'Some explanation.', status: 'ok' };
    const result = validatePresenterOutput(raw, inputNullPrice);
    expect(result.headline).toContain('Trade-A-Plane');
    expect(result.headline).not.toContain('null');
  });
});
