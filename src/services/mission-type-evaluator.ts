import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { ListingForScoring } from '../types.js';

export interface MissionTypeResult {
  matched: boolean;
  confidence: 'high' | 'medium' | 'low' | null;
  note: string | null;
}

interface MissionTypeCriterion {
  intent: string;
  sub_criteria?: string[];
}

function buildPrompt(listing: ListingForScoring, criterion: MissionTypeCriterion): string {
  const subCriteriaLines =
    criterion.sub_criteria && criterion.sub_criteria.length > 0
      ? `\nSub-criteria:\n${criterion.sub_criteria.map((s) => `  - ${s}`).join('\n')}`
      : '';

  return [
    `You are assessing whether an aircraft listing matches a mission type criterion.`,
    ``,
    `Mission type intent: ${criterion.intent}${subCriteriaLines}`,
    ``,
    `Aircraft listing:`,
    `  Make: ${listing.make ?? 'unknown'}`,
    `  Model: ${listing.model ?? 'unknown'}`,
    `  Aircraft type: ${listing.aircraftType ?? 'unknown'}`,
    `  Year: ${listing.year ?? 'unknown'}`,
    `  Price: ${listing.price != null ? `${listing.priceCurrency} ${listing.price}` : 'unknown'}`,
    `  Location: ${listing.location ?? 'unknown'}`,
    ``,
    `Based on the aircraft make/model and any details in the aircraft type field, assess whether`,
    `this aircraft is likely to match the mission type intent and sub-criteria listed above.`,
    ``,
    `Respond with a JSON object only — no markdown, no explanation outside the JSON:`,
    `{"matched": true/false, "confidence": "high"/"medium"/"low", "note": "brief explanation"}`,
  ].join('\n');
}

function parseSafeResponse(text: string): MissionTypeResult {
  const json = JSON.parse(text) as Record<string, unknown>;
  const matched = Boolean(json.matched);
  const confidence =
    json.confidence === 'high' || json.confidence === 'medium' || json.confidence === 'low'
      ? json.confidence
      : null;
  const note = typeof json.note === 'string' ? json.note : null;
  return { matched, confidence, note };
}

const fallback: MissionTypeResult = {
  matched: false,
  confidence: null,
  note: 'AI evaluation failed — defaulting to unmatched',
};

export async function evaluateMissionType(
  listing: ListingForScoring,
  criterion: MissionTypeCriterion,
  client: Anthropic | OpenAI,
  model: string,
): Promise<MissionTypeResult> {
  const prompt = buildPrompt(listing, criterion);

  try {
    if ('messages' in client) {
      const response = await client.messages.create({
        model,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = response.content[0];
      if (block.type !== 'text') return fallback;
      return parseSafeResponse(block.text);
    } else {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = response.choices[0]?.message?.content;
      if (!text) return fallback;
      return parseSafeResponse(text);
    }
  } catch {
    return fallback;
  }
}
