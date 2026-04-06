// Profile Researcher agent — prompts the LLM with a high-level intent and
// returns proposed profile criteria with descriptions and rationale.
// No tools needed: pure LLM generation with structured JSON output.

import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config.js';
import { logger } from '../config.js';

export interface ProposedCriterion {
  type: string;
  description: string;
  rationale: string;
  defaults: Record<string, unknown>;
}

export interface ProfileResearcherOutput {
  proposed: ProposedCriterion[];
}

const SYSTEM = `You are an expert aviation consultant helping a pilot set up an aircraft search profile.
Given a high-level search intent, propose concrete aircraft search criteria in JSON.

Return a JSON array of criteria objects. Each object must have:
- type: one of "make_model", "price_range", "year_range", "listing_type", "mission_type"
- description: plain-English description of the criterion (1 sentence)
- rationale: why this criterion is important for the stated intent (1-2 sentences)
- defaults: an object with the criterion's default values matching its type:
  - make_model: { make: string|null, model: string|null }
  - price_range: { min: number, max: number }
  - year_range: { yearMin: number, yearMax: number }
  - listing_type: { listingType: "full_ownership"|"share"|"any" }
  - mission_type: { intent: string, sub_criteria: string[] }

Return ONLY the JSON array. No preamble, no markdown.`;

export async function runProfileResearcher(
  intent: string,
  anthropic: Anthropic,
  config: Config
): Promise<ProfileResearcherOutput> {
  const response = await anthropic.messages.create({
    model: config.agent.matcher_model,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `My aircraft search intent: "${intent}"\n\nPropose search criteria for this intent.`,
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    logger.warn({ text: text.slice(0, 200) }, 'ProfileResearcher returned no JSON array');
    return { proposed: [] };
  }

  try {
    const parsed = JSON.parse(match[0]) as unknown[];
    const proposed = parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        type: String(item.type ?? ''),
        description: String(item.description ?? ''),
        rationale: String(item.rationale ?? ''),
        defaults: (item.defaults as Record<string, unknown>) ?? {},
      }));
    return { proposed };
  } catch (err) {
    logger.error({ err }, 'ProfileResearcher: failed to parse JSON response');
    return { proposed: [] };
  }
}
