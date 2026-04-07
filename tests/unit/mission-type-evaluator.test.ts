import { describe, it, expect, vi, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { evaluateMissionType } from '../../src/services/mission-type-evaluator.js';
import type { ListingForScoring } from '../../src/types.js';

const listing: ListingForScoring = {
  id: 'test-id',
  registration: 'G-ABCD',
  aircraftType: 'Piper PA-28 Arrow IFR',
  make: 'Piper',
  model: 'PA-28 Arrow',
  year: 2002,
  price: 65000,
  priceCurrency: 'GBP',
  location: 'Doncaster',
};

const criterion = {
  intent: 'IFR certified avionics suite',
  sub_criteria: ['GPS navigator capable of IFR approaches', 'Mode S transponder', 'Working attitude indicator'],
};

// ---------------------------------------------------------------------------
// Anthropic path
// ---------------------------------------------------------------------------

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const MockAnthropicClass = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (MockAnthropicClass as any).__mockCreate = mockCreate;
  return { default: MockAnthropicClass };
});

vi.mock('openai', () => {
  const mockCreate = vi.fn();
  const MockOpenAIClass = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (MockOpenAIClass as any).__mockCreate = mockCreate;
  return { default: MockOpenAIClass };
});

function getAnthropicMock() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Anthropic as any).__mockCreate as ReturnType<typeof vi.fn>;
}
function getOpenAIMock() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (OpenAI as any).__mockCreate as ReturnType<typeof vi.fn>;
}

function makeAnthropicResponse(json: object) {
  return { content: [{ type: 'text', text: JSON.stringify(json) }] };
}
function makeOpenAIResponse(json: object) {
  return { choices: [{ message: { content: JSON.stringify(json) } }] };
}

describe('evaluateMissionType — Anthropic path', () => {
  let client: Anthropic;

  beforeEach(() => {
    client = new Anthropic({ apiKey: 'test' });
    vi.clearAllMocks();
  });

  it('returns matched: true with high confidence when API says so', async () => {
    getAnthropicMock().mockResolvedValue(
      makeAnthropicResponse({ matched: true, confidence: 'high', note: 'Aircraft is IFR certified' })
    );
    const result = await evaluateMissionType(listing, criterion, client, 'claude-haiku-4-5-20251001');
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.note).toBeTruthy();
  });

  it('returns matched: false with low confidence when API says so', async () => {
    getAnthropicMock().mockResolvedValue(
      makeAnthropicResponse({ matched: false, confidence: 'low', note: 'Avionics unclear' })
    );
    const result = await evaluateMissionType(listing, criterion, client, 'claude-haiku-4-5-20251001');
    expect(result.matched).toBe(false);
    expect(result.confidence).toBe('low');
  });

  it('includes intent, sub_criteria, and listing fields in the prompt', async () => {
    getAnthropicMock().mockResolvedValue(
      makeAnthropicResponse({ matched: true, confidence: 'medium', note: 'ok' })
    );
    await evaluateMissionType(listing, criterion, client, 'claude-haiku-4-5-20251001');
    const call = getAnthropicMock().mock.calls[0][0] as { messages: Array<{ content: string }> };
    const prompt = call.messages[0].content;
    expect(prompt).toContain('IFR certified avionics suite');
    expect(prompt).toContain('GPS navigator capable of IFR approaches');
    expect(prompt).toContain('Piper');
    expect(prompt).toContain('PA-28 Arrow IFR');
  });

  it('returns safe fallback when Anthropic throws', async () => {
    getAnthropicMock().mockRejectedValue(new Error('Rate limit'));
    const result = await evaluateMissionType(listing, criterion, client, 'claude-haiku-4-5-20251001');
    expect(result.matched).toBe(false);
    expect(result.confidence).toBeNull();
    expect(result.note).toMatch(/AI evaluation failed/);
  });

  it('returns safe fallback when response JSON is malformed', async () => {
    getAnthropicMock().mockResolvedValue({ content: [{ type: 'text', text: 'not json' }] });
    const result = await evaluateMissionType(listing, criterion, client, 'claude-haiku-4-5-20251001');
    expect(result.matched).toBe(false);
    expect(result.confidence).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ollama (OpenAI-compatible) path
// ---------------------------------------------------------------------------

describe('evaluateMissionType — Ollama path', () => {
  let client: OpenAI;

  beforeEach(() => {
    client = new OpenAI({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' });
    vi.clearAllMocks();
  });

  it('returns matched: true with medium confidence when Ollama says so', async () => {
    getOpenAIMock().mockResolvedValue(
      makeOpenAIResponse({ matched: true, confidence: 'medium', note: 'IFR capable' })
    );
    const result = await evaluateMissionType(listing, criterion, client, 'qwen2.5:7b');
    expect(result.matched).toBe(true);
    expect(result.confidence).toBe('medium');
  });

  it('includes intent and listing fields in the Ollama prompt', async () => {
    getOpenAIMock().mockResolvedValue(
      makeOpenAIResponse({ matched: false, confidence: 'low', note: 'no' })
    );
    await evaluateMissionType(listing, criterion, client, 'qwen2.5:7b');
    const call = getOpenAIMock().mock.calls[0][0] as { messages: Array<{ content: string }> };
    const prompt = call.messages[0].content;
    expect(prompt).toContain('IFR certified avionics suite');
    expect(prompt).toContain('Piper');
  });

  it('returns safe fallback when Ollama throws', async () => {
    getOpenAIMock().mockRejectedValue(new Error('Connection refused'));
    const result = await evaluateMissionType(listing, criterion, client, 'qwen2.5:7b');
    expect(result.matched).toBe(false);
    expect(result.confidence).toBeNull();
    expect(result.note).toMatch(/AI evaluation failed/);
  });
});
