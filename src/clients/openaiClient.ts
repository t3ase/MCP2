// src/clients/openaiClient.ts
import OpenAI from "openai";
import { config } from "../config/env";

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

export type MoodLanguageResult = {
  mood: string | null;
  language: string | null;
  confidence: number; // 0–1
};

/**
 * Use OpenAI to classify a free-text WhatsApp message
 * into { mood, language }.
 */
export async function classifyMoodAndLanguage(
  message: string
): Promise<MoodLanguageResult> {
  if (!config.openaiApiKey) {
    // Safety: if key missing, just fall back
    return { mood: null, language: null, confidence: 0 };
  }

  const prompt = `
You are a strict classifier for a music recommendation bot on WhatsApp.

User sends casual text like:
  "i'm kinda low, english songs pls"
  "need chill hindi vibes"
  "happy playlist"
  "give me some party bangers in english"

You MUST extract:
- mood: one or two words (examples: "sad", "happy", "chill", "party", "romantic")
- language: one word like "english", "hindi", "punjabi", or null if not mentioned
- confidence: number between 0 and 1: how sure you are.

Return ONLY valid JSON, no extra text.

Example output:
{"mood":"sad","language":"english","confidence":0.94}

Now classify this message:

"""${message}"""
`;

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",        // cheap + fast :contentReference[oaicite:1]{index=1}
    input: prompt,
  });

  const text = response.output_text ?? "";

  try {
    const parsed = JSON.parse(text) as MoodLanguageResult;
    return {
      mood: parsed.mood ?? null,
      language: parsed.language ?? null,
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch (err) {
    console.error("Failed to parse OpenAI JSON:", text);
    return { mood: null, language: null, confidence: 0 };
  }
}
