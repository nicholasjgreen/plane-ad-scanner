# Agent Contract: Indicator Deriver

## Role

Derives all 20 structured indicators for a single aircraft listing by reading the listing's `raw_attributes` JSON. Returns a fully populated `StructuredIndicators` object with values and confidence levels.

## Properties

| Property | Value |
|----------|-------|
| Responsibility | Classify raw listing attributes into 20 structured indicators |
| Permitted tools | None (pure generation — single LLM call, no tool loop) |
| Model | `claude-sonnet-4-6` (judgment task; aviation domain knowledge required) |
| Max turns | 1 (single `messages.create` call — not an agentic loop) |
| State | Stateless — receives raw_attributes, returns StructuredIndicators |
| Error handling | Never throws; returns `{ error: string }` on failure; caller preserves existing indicators |
| Token budget | ~800 input + ~2,500 output per listing |

## Function Signature

```typescript
export async function runIndicatorDeriver(
  input: IndicatorDeriverInput,
  anthropic: Anthropic,
  model: string
): Promise<IndicatorDeriverOutput>

export interface IndicatorDeriverInput {
  listingId: string;          // For correlation only — not sent to LLM
  rawAttributes: Record<string, string>;
  aircraftType?: string | null;
  make?: string | null;
  model?: string | null;
  registration?: string | null;
}

export interface IndicatorDeriverOutput {
  listingId: string;
  indicators?: StructuredIndicators;
  error?: string;
}
```

## Prompt Design

The system prompt includes:
1. The full indicator definitions with allowed values (from FR-002 through FR-024)
2. The IFR approval inference rules (standard-category + minimum instrument set → IFR Approved)
3. The IFR capability level signal lists (equipment markers for Basic/Enhanced/Advanced/High-End)
4. The banding thresholds for numeric indicators (range, speed, fuel burn, capacity)
5. Instruction to output a single JSON object matching the `StructuredIndicators` schema

The user message contains:
- Aircraft type / make / model (if known)
- Registration prefix (if present — for country derivation)
- The full `raw_attributes` JSON

## Output Validation

The output JSON is validated against the indicator schema before storing:
- All 20 fields must be present
- Each field must have `value` (string|number|null) and `confidence` (High|Medium|Low)
- Banded fields must additionally have `band` (string|null)
- Unknown values are represented as `null` (not the string "Unknown")
- Any validation failure → `error` result; existing indicators preserved

## Confidence Band Thresholds

### Typical Range (nm)
- Green: ≥ 600 nm
- Amber: 300–599 nm
- Red: < 300 nm

### Typical Cruise Speed (kts)
- Green: ≥ 140 kts
- Amber: 90–139 kts
- Red: < 90 kts

### Typical Fuel Burn (GPH)
- Green: ≤ 10 GPH
- Amber: 11–20 GPH
- Red: > 20 GPH

### Passenger Capacity (seats)
- "2 seats": ≤ 2
- "3–4 seats": 3–4
- "5–6 seats": 5–6
- "7+ seats": ≥ 7

*These thresholds are included in the LLM system prompt so the model applies them consistently.*
