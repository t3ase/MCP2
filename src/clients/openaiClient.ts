// src/clients/openaiClient.ts
import OpenAI from "openai";
import { config } from "../config/env";
import { logger } from "../utils/logger";

const client = new OpenAI({
  apiKey: config.openai.apiKey || process.env.OPENAI_API_KEY || "",
});

export type IntentType =
  | "playlist"
  | "artist_search"
  | "repeat"
  | "change_vibe"
  | "other";

export type ClassificationResult = {
  mood: string | null;
  language: string | null;
  vibe: string | null;
  artist: string | null;
  track: string | null;
  intent: IntentType;
};

const systemPrompt = `
You classify user music requests into structured JSON.

Your job is to extract:
- mood (emotional state like "sad", "happy", "heartbreak", "low", etc.)
- language (language of the songs requested, like "english", "hindi", etc.)
- vibe (tempo / feel, like "slow", "chill", "energetic", "gym", "party", etc.)
- artist (singer / band name, if any)
- track (specific song name, if any)
- intent (one of: "playlist", "artist_search", "repeat", "change_vibe", "other")

INTENT RULES:
- If the user explicitly mentions an artist or says "songs by X", "music from X",
  then intent = "artist_search".
- If the user says "play that again", "repeat that", "same playlist", etc.,
  then intent = "repeat".
- If the user says things like "something slower", "more chill", "faster",
  "more energetic", etc., and refers to changing the feel of current music,
  then intent = "change_vibe".
- Otherwise use intent = "playlist".

Return ONLY a single JSON object. No explanation.

Example correct outputs:

User: "I'm feeling empty after breakup, give me slow english songs"
{
  "mood": "heartbreak",
  "language": "english",
  "vibe": "slow",
  "artist": null,
  "track": null,
  "intent": "playlist"
}

User: "Play some gym music by Drake"
{
  "mood": "gym",
  "language": null,
  "vibe": "energetic",
  "artist": "drake",
  "track": null,
  "intent": "artist_search"
}

User: "play that again"
{
  "mood": null,
  "language": null,
  "vibe": null,
  "artist": null,
  "track": null,
  "intent": "repeat"
}
`;

export async function classifyMoodAndLanguage(
  message: string
): Promise<ClassificationResult> {
  // If there is no API key, fall back gracefully
  if (!client.apiKey) {
    logger.warn("No OPENAI_API_KEY set; falling back to simple classification");
    const text = message.trim().toLowerCase();
    return {
      mood: text || null,
      language: null,
      vibe: null,
      artist: null,
      track: null,
      intent: "playlist",
    };
  }

  const userPrompt = `
User message: "${message}"

Extract the fields:
- mood
- language
- vibe
- artist
- track
- intent

If something is not specified, set it to null.
Return ONLY valid JSON. No extra text.
`.trim();

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0].message.content || "{}";

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.error({ err, raw }, "Failed to parse OpenAI classification JSON");
      parsed = {};
    }

    const mood =
      typeof parsed.mood === "string" && parsed.mood.trim()
        ? parsed.mood.trim().toLowerCase()
        : null;

    const language =
      typeof parsed.language === "string" && parsed.language.trim()
        ? parsed.language.trim().toLowerCase()
        : null;

    const vibe =
      typeof parsed.vibe === "string" && parsed.vibe.trim()
        ? parsed.vibe.trim().toLowerCase()
        : null;

    const artist =
      typeof parsed.artist === "string" && parsed.artist.trim()
        ? parsed.artist.trim().toLowerCase()
        : null;

    const track =
      typeof parsed.track === "string" && parsed.track.trim()
        ? parsed.track.trim()
        : null;

    let intent: IntentType = "playlist";
    if (typeof parsed.intent === "string") {
      const i = parsed.intent.toLowerCase();
      if (i === "artist_search") intent = "artist_search";
      else if (i === "repeat") intent = "repeat";
      else if (i === "change_vibe") intent = "change_vibe";
      else if (i === "playlist") intent = "playlist";
      else intent = "other";
    }

    return {
      mood,
      language,
      vibe,
      artist,
      track,
      intent,
    };
  } catch (err: any) {
    logger.error({ err }, "Error calling OpenAI classifier; using fallback");
    const text = message.trim().toLowerCase();
    return {
      mood: text || null,
      language: null,
      vibe: null,
      artist: null,
      track: null,
      intent: "playlist",
    };
  }
}
