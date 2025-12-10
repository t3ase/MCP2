// src/routes/webhooks.ts
import { Router } from "express";
import { getPlaylistForMood } from "../clients/spotifyClient";
import { sendTwilioMessage } from "../clients/twilioClient";
import { logger } from "../utils/logger";
import {
  classifyMoodAndLanguage,
  ClassificationResult,
} from "../clients/openaiClient";

export const webhooksRouter = Router();

type SessionStage = "idle" | "waiting_language" | "playlist_shown";

type SessionState = {
  stage: SessionStage;
  mood?: string | null;
  language?: string | null;
  vibe?: string | null;
  lastPlaylistId?: string | null;
  lastArtist?: string | null;
  lastTrack?: string | null;
  lastIntent?: string | null;
};

type HistoryEntry = {
  mood: string;
  language: string;
  playlistId: string;
  playlistName?: string;
  playlistUrl?: string;
  lastUsedAt: string; // ISO
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

// -------- STATS HELPERS --------

function getUserStats(from: string) {
  const entries = history.get(from) ?? [];
  if (!entries.length) return null;

  const moodCounts = new Map<string, number>();
  const languageCounts = new Map<string, number>();
  const playlistCounts = new Map<string, number>();

  for (const h of entries) {
    const moodKey = h.mood.toLowerCase();
    moodCounts.set(moodKey, (moodCounts.get(moodKey) ?? 0) + 1);

    const langKey = h.language.toLowerCase();
    languageCounts.set(langKey, (languageCounts.get(langKey) ?? 0) + 1);

    const playlistKey = (h.playlistName || h.playlistId).toLowerCase();
    playlistCounts.set(playlistKey, (playlistCounts.get(playlistKey) ?? 0) + 1);
  }

  const topEntry = (m: Map<string, number>) => {
    let bestKey: string | null = null;
    let bestCount = 0;
    for (const [k, v] of m.entries()) {
      if (v > bestCount) {
        bestKey = k;
        bestCount = v;
      }
    }
    return { key: bestKey, count: bestCount };
  };

  const topMood = topEntry(moodCounts);
  const topLanguage = topEntry(languageCounts);
  const topPlaylist = topEntry(playlistCounts);

  const findPlaylistNameFromKey = (key: string | null): string | null => {
    if (!key) return null;
    const entry = entries.find(
      (e) =>
        (e.playlistName || e.playlistId).toLowerCase() === key.toLowerCase()
    );
    return entry?.playlistName || entry?.playlistId || null;
  };

  const first = entries[0].lastUsedAt;
  const last = entries[entries.length - 1].lastUsedAt;

  return {
    totalPlays: entries.length,
    topMood: topMood.key,
    topMoodCount: topMood.count,
    topLanguage: topLanguage.key,
    topLanguageCount: topLanguage.count,
    topPlaylistName: findPlaylistNameFromKey(topPlaylist.key),
    topPlaylistCount: topPlaylist.count,
    first,
    last,
  };
}

webhooksRouter.post("/twilio/whatsapp", async (req, res) => {
  try {
    const from = req.body.From as string | undefined;
    const bodyRaw = req.body.Body as string | undefined;
    const text = normalizeText(bodyRaw);
    const textLower = text.toLowerCase();

    if (!from || !text) {
      logger.error({ from, bodyRaw }, "Missing From or Body in Twilio webhook");
      return res.status(400).json({ ok: false, error: "missing_from_or_body" });
    }

    const current = sessions.get(from) || ({ stage: "idle" } as SessionState);
    logger.info({ from, text, session: current }, "Incoming WhatsApp message");

    /**
     * ───────────────────────────────
     * 1. If we are WAITING for language, treat this message purely as language
     * ───────────────────────────────
     */
    if (current.stage === "waiting_language") {
      const language = textLower;
      const mood = current.mood || null;
      const vibe = current.vibe || null;
      const artist = current.lastArtist || null;
      const track = current.lastTrack || null;
      const intent =
        (current.lastIntent as ClassificationResult["intent"]) || "playlist";

      let previous: HistoryEntry | undefined;
      if (mood) {
        previous = getLastHistory(from, mood, language);
      }
      const excludeId = previous?.playlistId;

      // Build search query
      let searchQuery = "";
      if (intent === "artist_search") {
        const parts: string[] = [];
        if (artist) parts.push(artist);
        if (track) parts.push(track);
        if (!parts.length && mood) parts.push(mood);
        if (!parts.length) parts.push(textLower);
        searchQuery = parts.join(" ").trim();
      } else {
        const moodPieces: string[] = [];
        if (mood) moodPieces.push(mood);
        if (vibe) moodPieces.push(vibe);
        searchQuery = moodPieces.join(" ").trim() || textLower;
      }

      const tracks = await getPlaylistForMood(searchQuery, language, excludeId);

      const playlistMeta = (tracks as any).playlist as
        | { id: string; name: string; url?: string }
        | undefined;
      const altMeta = (tracks as any).alternatePlaylist as
        | { id: string; name: string; url?: string }
        | undefined;

      let replyLines: string[] = [];

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
          `📅 Last time you listened to a "${previous.mood}" playlist in "${previous.language}" was on ${dateStr}.`,
          `Same playlist: ${previous.playlistName || "(no name)"}`,
          previous.playlistUrl ? `Same playlist link: ${previous.playlistUrl}` : ""
        );
        replyLines.push("");
      }

      if (!tracks.length || !playlistMeta) {
        replyLines.push(
          `I couldn't find playlists for your request in "${language}".`,
          `Try another mood, artist, or language (e.g. "sad english", "songs from drake", etc).`
        );
      } else {
        const first = tracks[0];

        replyLines.push(
          `🎧 Here's a playlist for your request in "${language}":`,
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
            `You can also try this alternate playlist:`,
            `Alt playlist: ${altMeta.name}`,
            `Alt link: ${altMeta.url}`
          );
        }

        if (mood) {
          addHistory(from, {
            mood,
            language,
            playlistId: playlistMeta.id,
            playlistName: playlistMeta.name,
            playlistUrl: playlistMeta.url,
            lastUsedAt: new Date().toISOString(),
          });
        }

        sessions.set(from, {
          stage: "playlist_shown",
          mood,
          language,
          vibe,
          lastPlaylistId: playlistMeta.id,
          lastArtist: artist,
          lastTrack: track,
          lastIntent: intent,
        });
      }

      const reply = replyLines.filter(Boolean).join("\n");
      await sendTwilioMessage(from, reply);

      return res.json({ ok: true });
    }

    /**
     * ───────────────────────────────
     * 2. New message / normal flow
     * ───────────────────────────────
     */
    let ai: ClassificationResult | null = null;
    try {
      ai = await classifyMoodAndLanguage(text);
    } catch (err: any) {
      logger.error({ err }, "Error calling classifyMoodAndLanguage");
      ai = null;
    }

    const mood = ai?.mood || null;
    const detectedLanguage = ai?.language || null;
    const vibe = ai?.vibe || null;
    const artist = ai?.artist || null;
    const track = ai?.track || null;
    const intent = ai?.intent || "playlist";

    logger.info({ from, ai }, "AI classification result");

    const hasCurrentPlaylist =
      current.stage === "playlist_shown" &&
      current.mood &&
      current.language &&
      current.lastPlaylistId;

    /**
     * 2a. STATS COMMAND – either explicit text ("stats") or AI intent "user_stats"
     */
    const normalizedCommand = textLower.replace(/\s+/g, " ").trim();
    const isStatsCommand =
      normalizedCommand === "stats" ||
      normalizedCommand === "my stats" ||
      normalizedCommand === "show my stats";

    // Cast intent to string so TS doesn't complain about "user_stats" not being in the union yet
    const isStatsIntent = (intent as unknown as string) === "user_stats";

    if (isStatsCommand || isStatsIntent) {
      const stats = getUserStats(from);
      const replyLines: string[] = [];

      if (!stats) {
        replyLines.push(
          "I don't have any stats for you yet.",
          "Ask me for a playlist first (for example: 'sad english', 'chill hindi', or 'songs from drake')."
        );
      } else {
        const firstDate = new Date(stats.first);
        const lastDate = new Date(stats.last);
        const firstStr = firstDate.toLocaleString("en-IN", {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        const lastStr = lastDate.toLocaleString("en-IN", {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });

        const diffMs = lastDate.getTime() - firstDate.getTime();
        const retentionDays = Math.max(
          1,
          Math.round(diffMs / (1000 * 60 * 60 * 24))
        );

        replyLines.push(
          "📊 Your listening stats:",
          "",
          `• Total playlists I've sent you: ${stats.totalPlays}`,
          `• Most requested mood: ${stats.topMood ?? "N/A"} (${stats.topMoodCount} times)`,
          `• Top language: ${stats.topLanguage ?? "N/A"} (${stats.topLanguageCount} times)`,
          `• Most re-used playlist: ${
            stats.topPlaylistName ?? "N/A"
          } (${stats.topPlaylistCount} times)`,
          "",
          `• First playlist: ${firstStr}`,
          `• Latest playlist: ${lastStr}`,
          `• You've been using me for about ${retentionDays} day(s).`
        );
      }

      await sendTwilioMessage(from, replyLines.filter(Boolean).join("\n"));
      return res.json({ ok: true });
    }

    /**
     * 2b. If user already has playlist_shown, support "repeat" and "change_vibe"
     */

    // REPEAT
    if (hasCurrentPlaylist && intent === "repeat") {
      const baseMood = current.mood as string;
      const baseLanguage = current.language as string;

      const prev = getLastHistory(from, baseMood, baseLanguage);
      const replyLines: string[] = [];

      replyLines.push(
        `🔁 Re-playing your last "${baseMood}" playlist in "${baseLanguage}".`
      );

      if (prev?.playlistName) {
        replyLines.push(`Playlist: ${prev.playlistName}`);
      }
      if (prev?.playlistUrl) {
        replyLines.push(`Link: ${prev.playlistUrl}`);
      }

      await sendTwilioMessage(from, replyLines.filter(Boolean).join("\n"));
      return res.json({ ok: true });
    }

    // CHANGE VIBE
    if (hasCurrentPlaylist && intent === "change_vibe") {
      const baseMood = current.mood as string;
      const baseLanguage = current.language as string;
      const newVibe = (vibe || current.vibe || "").toLowerCase() || null;

      const moodQuery = newVibe ? `${baseMood} ${newVibe}` : baseMood;

      const prev = getLastHistory(from, baseMood, baseLanguage);
      const excludeId = prev?.playlistId;

      const tracks = await getPlaylistForMood(
        moodQuery,
        baseLanguage,
        excludeId
      );

      const playlistMeta = (tracks as any).playlist as
        | { id: string; name: string; url?: string }
        | undefined;
      const altMeta = (tracks as any).alternatePlaylist as
        | { id: string; name: string; url?: string }
        | undefined;

      const replyLines: string[] = [];

      if (!tracks.length || !playlistMeta) {
        replyLines.push(
          `I couldn't find a new "${baseMood}" playlist with a different vibe in "${baseLanguage}".`,
          `Try another mood or say something like "sad english", "happy hindi", etc.`
        );
      } else {
        const first = tracks[0];

        replyLines.push(
          `🌊 Changing vibe to "${
            newVibe || "different"
          }" for your "${baseMood}" mood in "${baseLanguage}":`,
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
            `You can also try this alternate playlist:`,
            `Alt playlist: ${altMeta.name}`,
            `Alt link: ${altMeta.url}`
          );
        }

        addHistory(from, {
          mood: baseMood,
          language: baseLanguage,
          playlistId: playlistMeta.id,
          playlistName: playlistMeta.name,
          playlistUrl: playlistMeta.url,
          lastUsedAt: new Date().toISOString(),
        });

        sessions.set(from, {
          stage: "playlist_shown",
          mood: baseMood,
          language: baseLanguage,
          vibe: newVibe,
          lastPlaylistId: playlistMeta.id,
          lastArtist: artist,
          lastTrack: track,
          lastIntent: intent,
        });
      }

      await sendTwilioMessage(from, replyLines.filter(Boolean).join("\n"));
      return res.json({ ok: true });
    }

    /**
     * 2c. Brand new request (or normal classification)
     */

    // If we still have absolutely no idea what they want (very unlikely)
    if (!mood && !artist && !track) {
      await sendTwilioMessage(
        from,
        "I couldn't quite understand that. Try something like: 'sad english', 'chill hindi', or 'songs from drake'."
      );
      return res.json({ ok: true });
    }

    // If language missing → ask and store session
    if (!detectedLanguage) {
      sessions.set(from, {
        stage: "waiting_language",
        mood,
        language: null,
        vibe,
        lastPlaylistId: null,
        lastArtist: artist,
        lastTrack: track,
        lastIntent: intent,
      });

      const desc = mood || artist || track || textLower;
      const reply =
        `Got it, I'll find music for "${desc}".\n` +
        `Which language do you prefer? (english, hindi, punjabi, tamil, telugu, etc)`;

      await sendTwilioMessage(from, reply);
      return res.json({ ok: true });
    }

    const language = detectedLanguage;
    let previous: HistoryEntry | undefined;
    if (mood) {
      previous = getLastHistory(from, mood, language);
    }
    const excludeId = previous?.playlistId;

    // Build search query – prefer artist/track if intent is artist_search
    let searchQuery = "";
    if (intent === "artist_search") {
      const parts: string[] = [];
      if (artist) parts.push(artist);
      if (track) parts.push(track);
      if (!parts.length && mood) parts.push(mood);
      if (!parts.length) parts.push(textLower);
      searchQuery = parts.join(" ").trim();
    } else {
      const moodPieces: string[] = [];
      if (mood) moodPieces.push(mood);
      if (vibe) moodPieces.push(vibe);
      searchQuery = moodPieces.join(" ").trim() || textLower;
    }

    const tracks = await getPlaylistForMood(searchQuery, language, excludeId);

    const playlistMeta = (tracks as any).playlist as
      | { id: string; name: string; url?: string }
      | undefined;
    const altMeta = (tracks as any).alternatePlaylist as
      | { id: string; name: string; url?: string }
      | undefined;

    const replyLines: string[] = [];

    if (previous && mood) {
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
        previous.playlistUrl ? `Same playlist link: ${previous.playlistUrl}` : ""
      );
      replyLines.push("");
    }

    if (!tracks.length || !playlistMeta) {
      replyLines.push(
        `I couldn't find playlists for your request "${searchQuery}" in "${language}".`,
        `Try another combination like "happy english", "sad hindi", or "songs from drake".`
      );
    } else {
      const first = tracks[0];

      const moodLabel =
        intent === "artist_search"
          ? artist
            ? `songs by ${artist}`
            : "your request"
          : mood || "your mood";

      replyLines.push(
        `🎧 Here's a playlist for ${moodLabel} in "${language}":`,
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
          `You can also try this alternate playlist:`,
          `Alt playlist: ${altMeta.name}`,
          `Alt link: ${altMeta.url}`
        );
      }

      if (mood) {
        addHistory(from, {
          mood,
          language,
          playlistId: playlistMeta.id,
          playlistName: playlistMeta.name,
          playlistUrl: playlistMeta.url,
          lastUsedAt: new Date().toISOString(),
        });
      }

      sessions.set(from, {
        stage: "playlist_shown",
        mood,
        language,
        vibe,
        lastPlaylistId: playlistMeta.id,
        lastArtist: artist,
        lastTrack: track,
        lastIntent: intent,
      });
    }

    await sendTwilioMessage(from, replyLines.filter(Boolean).join("\n"));
    return res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err }, "Error handling Twilio WhatsApp webhook");
    await sendTwilioMessage(
      req.body?.From,
      "Sorry, something went wrong on my side. Try again in a moment 🙏"
    );
    res.status(500).json({
      ok: false,
      error: "internal_error",
      details: String(err?.message || err),
    });
  }
});
