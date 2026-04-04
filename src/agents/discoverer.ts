// Discoverer agent — searches the web for aircraft-for-sale marketplace websites.
// Uses Anthropic's web_search_20250305 first-party tool; claude-sonnet-4-6; max 10 turns.
// Returns DiscovererOutput (new candidate sites, deduped against existingUrls).

import Anthropic from '@anthropic-ai/sdk';
import type { DiscovererInput, DiscovererOutput, DiscoveryCandidate } from '../types.js';
import { logger } from '../config.js';

const MAX_TURNS = 10;

// First-party web search tool — Anthropic executes searches server-side.
// Cast needed because the TypeScript type for Tool expects custom tool fields.
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
} as unknown as Anthropic.Tool;

export interface DiscovererDeps {
  /** Override the full discovery logic (for testing) */
  runDiscovery?: (input: DiscovererInput) => Promise<DiscovererOutput>;
}

export async function runDiscoverer(
  input: DiscovererInput,
  anthropic: Anthropic,
  config: { maxTokensPerAgent: number },
  deps: DiscovererDeps = {}
): Promise<DiscovererOutput> {
  if (deps.runDiscovery) {
    return deps.runDiscovery(input);
  }

  const systemPrompt = `You are searching for aircraft-for-sale marketplace websites.

Search the web for websites where private owners or dealers list aircraft for sale in the UK or Europe (fixed-wing, helicopters, gliders, microlights, etc.).

Focus primarily on UK and European marketplaces — for example: Barnfinders, AeroClassifieds, AFors, GlobalAir (UK listings), FlyingForSale, PlaneCheck, etc. USA-only sites like Trade-A-Plane, Controller, AeroTrader, and Barnstormers are of low value; only include them if they have substantial UK/European inventory.

Rules:
- Only propose genuine aircraft-for-sale marketplaces (not blogs, news sites, forums, or individual seller pages)
- Prefer sites with UK/European inventory; deprioritise US-only sites
- Normalise each URL to scheme://host only — no path, no query string, no trailing slash
  (e.g. "https://www.afors.com" not "https://www.afors.com/search?...")
- Do NOT propose any of these already-known URLs: ${JSON.stringify(input.existingUrls)}
- For each new marketplace, provide: url, name, description (one sentence noting geographic focus)

When you have finished searching, respond with ONLY a valid JSON object (no markdown code fences):
{
  "candidates": [
    { "url": "https://example.com", "name": "Example", "description": "One-sentence description." }
  ]
}

If you find no new sites, respond with: { "candidates": [] }`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: 'Search for UK and European aircraft-for-sale marketplace websites I might not know about yet.',
    },
  ];

  let turnsUsed = 0;

  try {
    while (turnsUsed < MAX_TURNS) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: Math.min(config.maxTokensPerAgent, 4096),
        system: systemPrompt,
        tools: [WEB_SEARCH_TOOL],
        messages,
      });
      turnsUsed++;

      logger.debug({ turn: turnsUsed, stop: response.stop_reason }, 'Discoverer turn');

      if (response.stop_reason === 'end_turn') {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');

        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
          logger.warn({ turnsUsed }, 'Discoverer: no JSON found in response');
          return { candidates: [] };
        }

        const parsed = JSON.parse(match[0]) as { candidates?: unknown[] };
        const raw = (parsed.candidates ?? []) as Record<string, unknown>[];

        // Deduplicate against existingUrls and against each other
        const seen = new Set(input.existingUrls.map((u) => u.toLowerCase()));
        const candidates: DiscoveryCandidate[] = [];

        for (const item of raw) {
          const rawUrl = String(item.url ?? '').trim().replace(/\/$/, '');
          if (!rawUrl.match(/^https?:\/\//)) continue;
          const key = rawUrl.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({
            url: rawUrl,
            name: String(item.name ?? rawUrl),
            description: String(item.description ?? ''),
          });
        }

        logger.info({ candidates: candidates.length, turnsUsed }, 'Discoverer done');
        return { candidates };
      }

      if (response.stop_reason === 'tool_use') {
        // Continue the conversation; the web_search tool is executed server-side by Anthropic.
        messages.push({ role: 'assistant', content: response.content });

        // Provide empty tool_result blocks so the model can continue processing search results.
        const toolResults: Anthropic.ToolResultBlockParam[] = response.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
          .map((b) => ({
            type: 'tool_result' as const,
            tool_use_id: b.id,
            content: '',
          }));

        if (toolResults.length > 0) {
          messages.push({ role: 'user', content: toolResults });
        }
      }
    }

    logger.warn({ turnsUsed }, 'Discoverer exceeded max turns');
    return { candidates: [] };
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Discoverer failed');
    return { candidates: [] };
  }
}
