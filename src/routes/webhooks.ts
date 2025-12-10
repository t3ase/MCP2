// src/routes/webhooks.ts
import { Router } from "express";
import { getPlaylistForMood } from "../clients/spotifyClient";
import { sendTwilioMessage } from "../clients/twilioClient";
import { logger } from "../utils/logger";
import { classifyMoodAndLanguage } from "../clients/openaiClient";

export const webhooksRouter = Router();

// ───────────────────────────────── Types & In-memory state ─────────────────────

type SessionStage = "idle" | "waiting_language" | "playlist_shown";

type SessionState = {
  stage: SessionStage;
  mood?: string;
  language?: string;
  vibe?: string | null;
  lastPlaylistId?: string;
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
  return (text || "").trim();
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

// Helper: send playlist recommendation + update history + session
async function sendPlaylistRecommendation(opts: {
  from: string;
  mood: string;
  language: string;
  vibe?: string | null;
  excludePlaylistId?: string;
  res: any;
}) {
  const { from, mood, language, vibe, excludePlaylistId, res } = opts;

  const previous = getLastHistory(from, mood, language);
  const excludeId = excludePlaylistId ?? previous?.playlistId;

  // Combine mood + vibe for search, e.g. "sad slow"
  const moodForQuery = vibe ? `${mood} ${vibe}` : mood;

  const tracks = await getPlaylistForMood(moodForQuery, language, excludeId);

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
      `Same playlist: ${previous.playlistName || "(no name)"}` +
        (previous.playlistUrl ? `\nSame playlist link: ${previous.playlistUrl}` : "")
    );
    replyLines.push(""); // blank line
  }

  // 2) New / alternate playlist
  if (!tracks.length || !playlistMeta) {
    replyLines.push(
      `I couldn't find any playlists for mood "${mood}" in language "${language}".`,
      `Try another combo like "happy english", "sad hindi", etc.`
    );
  } else {
    const first = tracks[0];

    replyLines.push(
      `🎧 Here's a playlist for "${mood}" in "${language}"` +
        (vibe ? ` with a "${vibe}" vibe:` : ":"),
      `Playlist: ${playlistMeta.name}`,
      playlistMeta.url ? `Playlist link: ${playlistMeta.url}` : "",
      "",
      `Song: ${first.name}`,
      `Artists: ${first.artists}`,
      first.url ? `Song link: ${first.url}` : ""
    );

    if (altMeta && altMeta.url) {
      replyLines.push(
        "",
        `You can also try this other playlist:`,
        `Alt playlist: ${altMeta.name}`,
        `Alt link: ${altMeta.url}`
      );
    }

    // Save this playlist in history
    addHistory(from, {
      mood,
      language,
      playlistId: playlistMeta.id,
      playlistName: playlistMeta.name,
      playlistUrl: playlistMeta.url,
      lastUsedAt: new Date().toISOString(),
    });

    // And remember in session for follow-up ("something else", "slower", etc.)
    sessions.set(from, {
      stage: "playlist_shown",
      mood,
      language,
      vibe: vibe ?? null,
      lastPlaylistId: playlistMeta.id,
    });
  }

  const reply = replyLines.filter(Boolean).join("\n");
  await sendTwilioMessage(from, reply);

  return res.json({ ok: true });
}

// ───────────────────────────────── WhatsApp webhook ────────────────────────────

webhooksRouter.post("/twilio/whatsapp", async (req, res) => {
  try {
    const from = req.body.From as string | undefined;
    const bodyRaw = req.body.Body as string | undefined;
    const text = normalizeText(bodyRaw);

    if (!from || !text) {
      logger.error({ from, bodyRaw }, "Missing From or Body in Twilio webhook");
      return res.status(400).json({ ok: false, error: "missing_from_or_body" });
    }

    const session = sessions.get(from) || { stage: "idle" as SessionStage };
    logger.info({ from, text, session }, "Incoming WhatsApp message");

    // ── 1. If playlist was just shown, interpret follow-up ("something else", "slower", etc.) ──
    if (session.stage === "playlist_shown") {
      const ai = await classifyMoodAndLanguage(text);

      if (ai.intent === "more") {
        const mood = (session.mood || ai.mood || "chill").toLowerCase();
        const language = (session.language || ai.language || "english").toLowerCase();
        const vibe = ai.vibe || session.vibe || null;

        return await sendPlaylistRecommendation({
          from,
          mood,
          language,
          vibe,
          excludePlaylistId: session.lastPlaylistId,
          res,
        });
      }

      if (ai.intent === "repeat" && session.lastPlaylistId) {
        // Simple "repeat" – just treat as same playlist again without exclude
        const mood = (session.mood || ai.mood || "chill").toLowerCase();
        const language = (session.language || ai.language || "english").toLowerCase();
        const vibe = ai.vibe || session.vibe || null;

        return await sendPlaylistRecommendation({
          from,
          mood,
          language,
          vibe,
          res,
        });
      }

      // Otherwise treat as a brand-new request and fall through
      sessions.set(from, { stage: "idle" });
    }

    // ── 2. If we're waiting for language only ─────────────────────────────────
    if (session.stage === "waiting_language" && session.mood) {
      const language = text.toLowerCase();
      const mood = session.mood.toLowerCase();
      const vibe = session.vibe || null;

      return await sendPlaylistRecommendation({
        from,
        mood,
        language,
        vibe,
        res,
      });
    }

    // ── 3. New request: use OpenAI to classify mood + language + vibe ─────────
    const ai = await classifyMoodAndLanguage(text);

    const mood = (ai.mood || text || "").toLowerCase();
    const detectedLanguage = ai.language ? ai.language.toLowerCase() : null;
    const vibe = ai.vibe ? ai.vibe.toLowerCase() : null;

    // If language not detected clearly -> ask user
    if (!detectedLanguage) {
      sessions.set(from, {
        stage: "waiting_language",
        mood,
        vibe,
      });

      const reply =
        `Got it, you're feeling "${mood}"` +
        (vibe ? ` with a "${vibe}" vibe.` : ".") +
        `\nWhich language do you prefer? (english, hindi, punjabi, tamil, telugu, etc)`;

      await sendTwilioMessage(from, reply);
      return res.json({ ok: true });
    }

    // If language is known, go straight to recommendation
    const language = detectedLanguage;
    return await sendPlaylistRecommendation({
      from,
      mood,
      language,
      vibe,
      res,
    });
  } catch (err: any) {
    logger.error({ err }, "Error handling Twilio WhatsApp webhook");
    try {
      if (req.body?.From) {
        await sendTwilioMessage(
          req.body.From,
          "Sorry, something went wrong on my side. Try again in a moment 🙏"
        );
      }
    } catch {
      // ignore Twilio errors in error handler
    }

    res.status(500).json({
      ok: false,
      error: "internal_error",
      details: String(err?.message || err),
    });
  }
});
