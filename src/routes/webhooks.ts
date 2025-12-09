// src/routes/webhooks.ts
import { Router } from "express";
import { getPlaylistForMood } from "../clients/spotifyClient";
import { sendTwilioMessage } from "../clients/twilioClient";
import { logger } from "../utils/logger";
import { classifyMoodAndLanguage } from "../clients/openaiClient";

export const webhooksRouter = Router();

type SessionState = {
  stage: "idle" | "waiting_language";
  mood?: string;
};

type HistoryEntry = {
  mood: string;
  language: string;
  playlistId: string;
  playlistName?: string;
  playlistUrl?: string;
  lastUsedAt: string; // ISO string
};

const sessions = new Map<string, SessionState>();
const history = new Map<string, HistoryEntry[]>();

function normalizeText(text: string | undefined): string {
  return (text || "").trim().toLowerCase();
}

function getLastHistory(
  from: string,
  mood: string,
  language: string
): HistoryEntry | undefined {
  const list = history.get(from) ?? [];
  return list
    .filter(
      (e) =>
        e.mood.toLowerCase() === mood.toLowerCase() &&
        e.language.toLowerCase() === language.toLowerCase()
    )
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0];
}

function addHistory(from: string, entry: HistoryEntry) {
  const list = history.get(from) ?? [];
  list.push(entry);
  history.set(from, list);
}

/**
 * Shared helper: builds the reply message (history + main playlist +
 * optional alternate playlist), sends it to the user, and records
 * the new playlist in history.
 */
async function respondWithPlaylist(from: string, mood: string, language: string) {
  // Check if user has used this mood+language before
  const previous = getLastHistory(from, mood, language);
  const excludeId = previous?.playlistId;

  const tracks = await getPlaylistForMood(mood, language, excludeId);
  const playlistMeta = (tracks as any).playlist as
    | { id: string; name: string; url?: string }
    | undefined;
  const altMeta = (tracks as any).alternatePlaylist as
    | { id: string; name: string; url?: string }
    | undefined;

  let replyLines: string[] = [];

  // 1) Mention previous playlist if exists
  if (previous) {
    const date = new Date(previous.lastUsedAt);
    const dateStr = date.toLocaleString("en-IN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    replyLines.push(
      `📅 Last time you listened to a "${mood}" playlist in "${language}" was on ${dateStr}.`,
      `Same playlist: ${previous.playlistName || "(no name)"}`,
    );
    if (previous.playlistUrl) {
      replyLines.push(`Same playlist link: ${previous.playlistUrl}`);
    }
    replyLines.push(""); // blank line
  }

  // 2) Now present the "new" playlist (different from previous if possible)
  if (!tracks.length || !playlistMeta) {
    replyLines.push(
      `I couldn't find any new playlists for mood "${mood}" in language "${language}".`,
      `Try another combination like "happy + english" or "sad + hindi".`,
    );
  } else {
    const first = tracks[0];

    replyLines.push(
      `🎧 Here's an alternate playlist for "${mood}" in "${language}":`,
      `Playlist: ${playlistMeta.name}`,
      playlistMeta.url ? `Playlist link: ${playlistMeta.url}` : "",
      "",
      `Song: ${first.name}`,
      `Artists: ${first.artists}`,
      first.url ? `Song link: ${first.url}` : "",
    );

    // If Spotify gave us an extra alternate playlist, mention it too
    if (altMeta && altMeta.url) {
      replyLines.push(
        "",
        `You can also try this other playlist:`,
        `Alt playlist: ${altMeta.name}`,
        `Alt link: ${altMeta.url}`,
      );
    }

    // Save this new playlist in history
    addHistory(from, {
      mood,
      language,
      playlistId: playlistMeta.id,
      playlistName: playlistMeta.name,
      playlistUrl: playlistMeta.url,
      lastUsedAt: new Date().toISOString(),
    });
  }

  const reply = replyLines.filter(Boolean).join("\n");
  await sendTwilioMessage(from, reply);
}

webhooksRouter.post("/twilio/whatsapp", async (req, res) => {
  try {
    const from = req.body.From as string | undefined;
    const bodyRaw = req.body.Body as string | undefined;
    const text = normalizeText(bodyRaw);

    if (!from || !text) {
      logger.error({ from, bodyRaw }, "Missing From or Body in Twilio webhook");
      return res.status(400).json({ ok: false, error: "missing_from_or_body" });
    }

    const current = sessions.get(from) || { stage: "idle" as const };
    logger.info({ from, text, session: current }, "Incoming WhatsApp message");

    // ── STEP 2: user is answering with LANGUAGE ───────────────────────
    if (current.stage === "waiting_language" && current.mood) {
      const mood = current.mood;
      const language = text;

      // reset session
      sessions.set(from, { stage: "idle" });

      await respondWithPlaylist(from, mood, language);
      return res.json({ ok: true });
    }

    // ── STEP 1: use OpenAI to detect MOOD + LANGUAGE (if possible) ────
    // Use raw text for better understanding by the model
    const classification = await classifyMoodAndLanguage(bodyRaw || text);

    logger.info(
      { from, classification },
      "OpenAI mood/language classification"
    );

    // Decide mood & language based on classifier, falling back to plain text
    const detectedMood =
      classification.mood && classification.confidence >= 0.5
        ? classification.mood.toLowerCase()
        : text;

    const detectedLanguage =
      classification.language && classification.confidence >= 0.5
        ? classification.language.toLowerCase()
        : null;

    // Case A: We confidently have both mood and language -> go straight to playlist
    if (detectedLanguage) {
      sessions.set(from, { stage: "idle" });
      await respondWithPlaylist(from, detectedMood, detectedLanguage);
      return res.json({ ok: true });
    }

    // Case B: Only mood detected (or classifier unsure about language) -> ask for language
    sessions.set(from, { stage: "waiting_language", mood: detectedMood });

    const reply =
      `Got it, your mood is "${detectedMood}".\n` +
      `Now tell me your language preference (for example: english, hindi, punjabi, tamil, telugu...).`;

    await sendTwilioMessage(from, reply);
    return res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err }, "Error handling Twilio WhatsApp webhook");
    res.status(500).json({
      ok: false,
      error: "internal_error",
      details: String(err?.message || err),
    });
  }
});
