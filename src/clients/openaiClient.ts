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
You are a strict classifier that extracts structured fields from a user's music request.
Return ONLY a single JSON object (no explanation, no markdown).

Fields to extract:
- mood: user's emotional state (e.g. "sad", "happy", "heartbreak", "low", "angry", etc.) or null
- language: language of songs requested (e.g. "english", "hindi") or null
- vibe: tempo/feel ("slow", "chill", "energetic", "lofi", "romantic", etc.) or null
- artist: artist/band name if the user requests music from a specific artist (e.g. "Drake", "Arijit Singh"), otherwise null
- track: specific song title if mentioned, otherwise null
- intent: one of:
  - "artist_search" (user wants songs/tracks/playlists from a specific artist)
  - "playlist" (user asks for a playlist based on mood/vibe/language)
  - "repeat" (user asked to repeat current playlist)
  - "change_vibe" (user asked to change vibe, e.g. "something slower")
  - "other"

INTENT RULES (strict):
1) If the message explicitly asks for songs/music/tracks/by/from/from the artist, intent MUST be "artist_search".
   Examples that MUST be artist_search:
     - "songs by drake"
     - "play me Drake tracks"
     - "some Arijit Singh songs"
     - "play songs from The Weeknd"
     - "drake english songs"
2) If the user says "play that again", "repeat that", or "same playlist", intent MUST be "repeat".
3) If the user asks to change the feel like "something slower", "more chill", "faster", "more energetic", intent MUST be "change_vibe".
4) Otherwise, intent SHOULD be "playlist".

Output formatting:
- Return EXACTLY one JSON object, with those six keys: mood, language, vibe, artist, track, intent.
- Use null for missing fields (not empty string).
- Artist and track values should be the quoted string the user mentioned (model may normalize capitalization).
- Keep the JSON concise — no additional keys.

Examples:

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
  "artist": "Drake",
  "track": null,
  "intent": "artist_search"
}

User: "something slow english songs by drake"
{
  "mood": "slow",
  "language": "english",
  "vibe": "slow",
  "artist": "Drake",
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

Return ONLY valid JSON with keys: mood, language, vibe, artist, track, intent.
If something is not specified, set it to null.
`.trim();

  let parsed: any = {};

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";

    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.error({ err, raw }, "Failed to parse OpenAI classification JSON");
      parsed = {};
    }
  } catch (err: any) {
    logger.error({ err }, "Error calling OpenAI classifier; using fallback heuristics");
    parsed = {};
  }

  // Helper: normalize parsed fields
  const toStringOrNull = (v: any) =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  let mood = toStringOrNull(parsed.mood);
  let language = toStringOrNull(parsed.language);
  let vibe = toStringOrNull(parsed.vibe);
  let artist = toStringOrNull(parsed.artist);
  let track = toStringOrNull(parsed.track);

  // Start with model-provided intent (or default)
  let intent: IntentType = "playlist";
  if (typeof parsed.intent === "string") {
    const i = parsed.intent.trim().toLowerCase();
    if (i === "artist_search") intent = "artist_search";
    else if (i === "repeat") intent = "repeat";
    else if (i === "change_vibe") intent = "change_vibe";
    else if (i === "playlist") intent = "playlist";
    else intent = "other";
  }

  // --- Heuristic fallbacks for artist detection (if model missed it) ---
  // We run a few robust regex patterns on the original message to try to
  // extract an artist name reliably (e.g. "songs by drake", "drake songs").
  try {
    const m = message || "";
    const lower = m.toLowerCase();

    // 1) phrases like "songs by <artist>", "music by <artist>", "tracks from <artist>"
    const byRegex = /\b(?:songs|song|music|tracks|track|albums|album|play|playlist)\s+(?:by|from)\s+([^\.\,\?\n]+)/i;
    const byMatch = m.match(byRegex);
    if (!artist && byMatch && byMatch[1]) {
      artist = byMatch[1].trim().replace(/["']/g, "");
      intent = intent === "repeat" || intent === "change_vibe" ? intent : "artist_search";
    }

    // 2) phrases like "<artist> songs" or "<artist> tracks" (artist at start or middle)
    const artistFirstRegex = /(?:^|\b)([A-Za-z0-9&\.'\-\s]{2,50}?)\s+(?:songs|song|music|tracks|tracks by|playlist|tracks from)\b/i;
    const artistFirstMatch = m.match(artistFirstRegex);
    if (!artist && artistFirstMatch && artistFirstMatch[1]) {
      const candidate = artistFirstMatch[1].trim();
      // Avoid matching generic words like "slow" as artist:
      if (!/^(slow|more|some|few|few|i'm|im|play|give|need|want)$/i.test(candidate)) {
        artist = candidate.replace(/["']/g, "");
        intent = intent === "repeat" || intent === "change_vibe" ? intent : "artist_search";
      }
    }

    // 3) explicit "by <artist>" without preceding "songs"
    const simpleBy = /\bby\s+([A-Za-z0-9&\.'\-\s]{2,50})\b/i;
    const simpleByMatch = m.match(simpleBy);
    if (!artist && simpleByMatch && simpleByMatch[1]) {
      const candidate = simpleByMatch[1].trim();
      if (!/^(me|that|it|this|them)$/i.test(candidate)) {
        artist = candidate.replace(/["']/g, "");
        intent = intent === "repeat" || intent === "change_vibe" ? intent : "artist_search";
      }
    }
  } catch (err) {
    logger.debug({ err }, "Artist heuristic failed");
  }

  // Normalize to lowercase (your webhook expects lowercase values)
  mood = mood ? mood.toLowerCase() : null;
  language = language ? language.toLowerCase() : null;
  vibe = vibe ? vibe.toLowerCase() : null;
  artist = artist ? artist.toLowerCase() : null;
  // keep track as-is (not lowercasing titles could be OK, but for consistency lowercase)
  const trackFinal = track ? track.toLowerCase() : null;

  // Final safety: if intent was model-detected as repeat/change_vibe, keep it
  // (we only override with artist_search when reasonable)
  if (intent !== "repeat" && intent !== "change_vibe") {
    // If we found an artist by heuristics but model set something else, prefer artist_search
    if (artist) {
      intent = "artist_search";
    } else {
      // otherwise keep whatever model said (or default playlist)
      intent = intent || "playlist";
    }
  }

  return {
    mood,
    language,
    vibe,
    artist,
    track: trackFinal,
    intent,
  };
}
