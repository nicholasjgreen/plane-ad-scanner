// Weight Suggester agent — given feedback records and current profiles, proposes
// weight adjustments with rationale. No tools; pure LLM generation.

import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config.js';
import { logger } from '../config.js';
import type { FeedbackRecord, InterestProfile, WeightSuggestion } from '../types.js';

const SYSTEM = `You are a flight profile tuning assistant.
Given feedback records (listings rated more/less interesting than expected) and current profile weights,
propose adjustments that better align the weights with the user's preferences.

Return a JSON array of suggestion objects. Each object must have:
- profile_name: string (must match an existing profile name exactly)
- proposed_weight: number (positive; the new weight to set)
- rationale: string (1-2 sentences explaining the change)

Return ONLY the JSON array. No preamble, no markdown.`;

export async function runWeightSuggester(
  feedback: FeedbackRecord[],
  profiles: InterestProfile[],
  anthropic: Anthropic,
  config: Config
): Promise<Omit<WeightSuggestion, 'id' | 'status' | 'createdAt' | 'resolvedAt'>[]> {
  if (feedback.length === 0 || profiles.length === 0) return [];

  const profileSummary = profiles.map((p) => ({ name: p.name, weight: p.weight }));
  const feedbackSummary = feedback.map((f) => ({
    listing_id: f.listingId,
    rating: f.rating,
    weights_at_time: f.weightsSnapshot,
  }));

  const prompt = `Current profile weights:\n${JSON.stringify(profileSummary, null, 2)}\n\nFeedback records (${feedback.length} total):\n${JSON.stringify(feedbackSummary, null, 2)}\n\nPropose weight adjustments.`;

  const response = await anthropic.messages.create({
    model: config.agent.matcher_model,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    logger.warn({ text: text.slice(0, 200) }, 'WeightSuggester returned no JSON array');
    return [];
  }

  try {
    const parsed = JSON.parse(match[0]) as unknown[];
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .filter((item) => {
        const name = String(item.profile_name ?? '');
        return profiles.some((p) => p.name === name);
      })
      .map((item) => {
        const profileName = String(item.profile_name ?? '');
        const currentProfile = profiles.find((p) => p.name === profileName)!;
        return {
          profileName,
          currentWeight: currentProfile.weight,
          proposedWeight: Number(item.proposed_weight ?? currentProfile.weight),
          rationale: String(item.rationale ?? ''),
          feedbackCount: feedback.length,
        };
      });
  } catch (err) {
    logger.error({ err }, 'WeightSuggester: failed to parse JSON response');
    return [];
  }
}
