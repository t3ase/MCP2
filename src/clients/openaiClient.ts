// src/clients/openaiClient.ts
import OpenAI from "openai";
import { config } from "../config/env";

const client = new OpenAI({
  apiKey: config.openai.apiKey,
});

export type MoodLanguageResult = {
  mood: string | null;
  language: string | null;
  vibe: string | null;
  intent: string; // "new" | "more" | "repeat" | "other" etc.
};

/**
 * Use OpenAI to understand:
 *  - mood (sad, happy, heartbreak, chill, party, etc.)
 *  - language (english, hindi, punjabi, tamil, etc.)
 *  - vibe (slow, energetic, lofi, gym, etc.)
 *  - intent ("new" playlist, "more" similar songs, "repeat" same playlist, etc.)
 */
export async function classifyMoodAndLanguage(
  message: string
): Promise<MoodLanguageResult> {
  // Fallback when no key configured or quota exhausted
  if (!config.openai.apiKey) {
    const lower = message.toLowerCase();
    let mood = "chill";
    if (lower.includes("sad")) mood = "sad";
    if (lower.includes("happy")) mood = "happy";
    if (lower.includes("breakup") || lower.includes("heart")) mood = "heartbreak";

    return {
      mood,
      language: null,
      vibe: null,
      intent: "other",
    };
  }

  const systemPrompt = `
You are a JSON API that classifies a WhatsApp message for music recommendation.

Extract:
- "mood": short word like "sad", "happy", "heartbreak", "chill", "party", "focus", etc.
- "language": user's preferred language ("english", "hindi", "punjabi", "tamil", "telugu", etc.).
  If not clearly stated, return null.
- "vibe": optional extra descriptor like "slow", "energetic", "lofi", "gym", "acoustic", etc., or null.
- "intent": 
    - "new"    -> user asking for a new playlist or first request.
    - "more"   -> user wants another / different playlist similar to what they just got
                  (phrases like "something else", "another", "more like this", "something slower").
    - "repeat" -> user wants the same playlist again
                  (phrases like "send again", "same one", "repeat").
    - "other"  -> anything else.

Return JSON ONLY. Example:
{
  "mood": "heartbreak",
  "language": "english",
  "vibe": "slow",
  "intent": "new"
}
  `.trim();

  const userPrompt = `
User message: "${message}"
Return ONLY a JSON object, no explanation.
`.trim();

const completion = await client.chat.completions.create({
  model: "gpt-4.1-mini",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ],
  response_format: { type: "json_object" }
});

const raw = completion.choices[0].message.content || "{}";


  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  return {
    mood: parsed.mood ?? null,
    language: parsed.language ?? null,
    vibe: parsed.vibe ?? null,
    intent: parsed.intent ?? "other",
  };
}
