/**
 * T004 — TDD unit tests for detail-fetcher merge logic, URL normalisation,
 * error handling, and 429 retry. Write FIRST, confirm FAILING, then implement.
 */
import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import { mergeAttributes, runDetailFetcher } from '../../src/agents/detail-fetcher.js';
import type { DetailFetcherInput } from '../../src/types.js';

const input: DetailFetcherInput = {
  listingId: 'test-id',
  listingUrl: 'https://example.com/listing/123',
  sourceSite: 'TestSite',
};

function makeMockOllama(content: string) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content } }],
        }),
      },
    },
  } as unknown as OpenAI;
}

// ---------------------------------------------------------------------------
// mergeAttributes
// ---------------------------------------------------------------------------

describe('mergeAttributes', () => {
  it('detail attributes overwrite existing empty attributes', () => {
    const existing = { make: '', model: 'PA-28' };
    const detail = { make: 'Piper', total_time: '1200h' };
    const result = mergeAttributes(existing, detail);
    expect(result.make).toBe('Piper');
    expect(result.total_time).toBe('1200h');
    expect(result.model).toBe('PA-28');
  });

  it('detail attributes do NOT overwrite existing non-empty attributes with blank values', () => {
    const existing = { make: 'Cessna', model: '172' };
    const detail = { make: '', engine_time: '500h' };
    const result = mergeAttributes(existing, detail);
    expect(result.make).toBe('Cessna');
    expect(result.model).toBe('172');
    expect(result.engine_time).toBe('500h');
  });
});

// ---------------------------------------------------------------------------
// Image URL normalisation
// ---------------------------------------------------------------------------

describe('runDetailFetcher image URL normalisation', () => {
  it('returns absolute image URLs unchanged', async () => {
    const client = makeMockOllama(
      JSON.stringify({
        attributes: {},
        imageUrls: ['https://example.com/img/plane.jpg'],
      })
    );
    const result = await runDetailFetcher(input, client, 'qwen2.5:7b', {
      fetchHtml: () => Promise.resolve('<html></html>'),
      retryBaseMs: 0,
    });
    expect(result.imageUrls).toEqual(['https://example.com/img/plane.jpg']);
    expect(result.error).toBeUndefined();
  });

  it('resolves relative image URLs against the listing origin', async () => {
    const client = makeMockOllama(
      JSON.stringify({
        attributes: {},
        imageUrls: ['/img/plane.jpg'],
      })
    );
    const result = await runDetailFetcher(input, client, 'qwen2.5:7b', {
      fetchHtml: () => Promise.resolve('<html></html>'),
      retryBaseMs: 0,
    });
    expect(result.imageUrls[0]).toBe('https://example.com/img/plane.jpg');
    expect(result.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('runDetailFetcher error handling', () => {
  it('returns error result when fetchHtml throws', async () => {
    const client = makeMockOllama('{}');
    const result = await runDetailFetcher(input, client, 'qwen2.5:7b', {
      fetchHtml: () => Promise.reject(new Error('Connection refused')),
      retryBaseMs: 0,
    });
    expect(result.listingId).toBe('test-id');
    expect(result.error).toMatch(/Connection refused/);
    expect(result.attributes).toEqual({});
    expect(result.imageUrls).toEqual([]);
  });

  it('returns error result when LLM returns no parseable JSON', async () => {
    const client = makeMockOllama('not json at all');
    const result = await runDetailFetcher(input, client, 'qwen2.5:7b', {
      fetchHtml: () => Promise.resolve('<html></html>'),
      retryBaseMs: 0,
    });
    expect(result.error).toBe('parse error');
    expect(result.attributes).toEqual({});
    expect(result.imageUrls).toEqual([]);
  });

  it('handles partial JSON gracefully (attributes only, no imageUrls)', async () => {
    const client = makeMockOllama(JSON.stringify({ attributes: { make: 'Cessna' } }));
    const result = await runDetailFetcher(input, client, 'qwen2.5:7b', {
      fetchHtml: () => Promise.resolve('<html></html>'),
      retryBaseMs: 0,
    });
    expect(result.error).toBeUndefined();
    expect(result.attributes).toEqual({ make: 'Cessna' });
    expect(result.imageUrls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 429 retry
// ---------------------------------------------------------------------------

describe('runDetailFetcher 429 retry', () => {
  it('retries after HTTP 429 and succeeds on second attempt', async () => {
    let calls = 0;
    const fetchHtml = () => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('HTTP 429'));
      return Promise.resolve('<html></html>');
    };
    const client = makeMockOllama(JSON.stringify({ attributes: { make: 'Piper' }, imageUrls: [] }));
    const result = await runDetailFetcher(input, client, 'qwen2.5:7b', {
      fetchHtml,
      retryBaseMs: 0,
    });
    expect(result.error).toBeUndefined();
    expect(result.attributes).toEqual({ make: 'Piper' });
    expect(calls).toBe(2);
  });

  it('returns error after three consecutive HTTP 429 responses', async () => {
    let calls = 0;
    const fetchHtml = () => {
      calls++;
      return Promise.reject(new Error('HTTP 429'));
    };
    const client = makeMockOllama('{}');
    const result = await runDetailFetcher(input, client, 'qwen2.5:7b', {
      fetchHtml,
      retryBaseMs: 0,
    });
    expect(result.error).toMatch(/429/);
    expect(result.attributes).toEqual({});
    expect(result.imageUrls).toEqual([]);
    expect(calls).toBe(3);
  });
});
