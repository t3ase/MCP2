// ----------------------------------------------
//  WhatsApp Webhook with ElevenLabs STT Support
// ----------------------------------------------

import { Router } from "express";
import { getPlaylistForMood } from "../clients/spotifyClient";
import { sendTwilioMessage } from "../clients/twilioClient";
import { logger } from "../utils/logger";
import {
  classifyMoodAndLanguage,
  ClassificationResult,
} from "../clients/openaiClient";

import {
  transcribeFromUrl, // <-- ElevenLabs speech-to-text
} from "../clients/elevenLabsClient";

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

function normalizeText(text: string | undefined) {
  return (text || "").trim();
}

function getLastHistory(from: string, mood: string, language: string) {
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

// ----------------------------------------------
// USER STATS
// ----------------------------------------------

function getUserStats(from: string) {
  const entries = history.get(from) ?? [];
  if (!entries.length) return null;

  const moodCounts = new Map<string, number>();
  const languageCounts = new Map<string, number>();
  const playlistCounts = new Map<string, number>();

  for (const h of entries) {
    moodCounts.set(h.mood, (moodCounts.get(h.mood) ?? 0) + 1);
    languageCounts.set(h.language, (languageCounts.get(h.language) ?? 0) + 1);
    playlistCounts.set(
      h.playlistName || h.playlistId,
      (playlistCounts.get(h.playlistName || h.playlistId) ?? 0) + 1
    );
  }

  const topEntry = (m: Map<string, number>) => {
    let bestKey: string | null = null;
    let bestCount = 0;
    for (const [key, count] of m.entries()) {
      if (count > bestCount) {
        bestKey = key;
        bestCount = count;
      }
    }
    return { key: bestKey, count: bestCount };
  };

  const topMood = topEntry(moodCounts);
  const topLang = topEntry(languageCounts);
  const topPlaylist = topEntry(playlistCounts);

  return {
    totalPlays: entries.length,
    topMood: topMood.key,
    topMoodCount: topMood.count,
    topLanguage: topLang.key,
    topLanguageCount: topLang.count,
    topPlaylistName: topPlaylist.key,
    topPlaylistCount: topPlaylist.count,
    first: entries[0].lastUsedAt,
    last: entries.at(-1)!.lastUsedAt,
  };
}

// ----------------------------------------------
// MAIN WEBHOOK HANDLER
// ----------------------------------------------

webhooksRouter.post("/twilio/whatsapp", async (req, res) => {
  try {
    const from = req.body.From as string;
    const bodyRaw = req.body.Body as string;

    //------------------------------------------
    // Detect incoming voice message
    //------------------------------------------
    const numMedia = parseInt(req.body.NumMedia || "0", 10);
    const mediaUrl = numMedia > 0 ? req.body.MediaUrl0 : null;
    const mediaContentType =
      numMedia > 0 ? req.body.MediaContentType0 : null;

    let text = normalizeText(bodyRaw);

    if (!text && numMedia > 0 && mediaUrl && mediaContentType.startsWith("audio")) {
      try {
        logger.info({ from, mediaUrl }, "Voice note detected → transcribing");
        text = await transcribeFromUrl(mediaUrl);
        logger.info({ from, text }, "Transcription completed");
      } catch (err) {
        logger.error({ err }, "STT transcription failed");
      }
    }

    const textLower = text.toLowerCase();

    if (!from || !text) {
      await sendTwilioMessage(from, "I couldn't understand that message.");
      return res.json({ ok: false });
    }

    const current = sessions.get(from) || { stage: "idle" };
    logger.info({ from, text }, "Incoming message");

    //------------------------------------------
    // WAITING FOR LANGUAGE
    //------------------------------------------
    if (current.stage === "waiting_language") {
      const language = textLower;
      const mood = current.mood || null;
      const vibe = current.vibe || null;
      const artist = current.lastArtist || null;
      const track = current.lastTrack || null;
      const intent = current.lastIntent || "playlist";

      let prev = mood ? getLastHistory(from, mood, language) : null;
      const excludeId = prev?.playlistId;

      let searchQuery = "";
      if (intent === "artist_search") {
        searchQuery = [artist, track, mood, textLower].filter(Boolean).join(" ");
      } else {
        searchQuery = [mood, vibe].filter(Boolean).join(" ") || textLower;
      }

      const tracks = await getPlaylistForMood(searchQuery, language, excludeId);
      const playlistMeta = (tracks as any).playlist;
      const altMeta = (tracks as any).alternatePlaylist;

      let replyLines: string[] = [];

      if (!tracks.length || !playlistMeta) {
        replyLines.push(
          `I couldn't find playlists in "${language}". Try another language!`
        );
      } else {
        const first = tracks[0];

        replyLines.push(
          `🎧 Here's something in "${language}":`,
          `Playlist: ${playlistMeta.name}`,
          playlistMeta.url ? `Link: ${playlistMeta.url}` : "",
          "",
          `Song: ${first.name}`,
          `Artists: ${first.artists}`
        );

        if (altMeta?.url) {
          replyLines.push("", `Alternate: ${altMeta.name}`, altMeta.url);
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
    }

    //------------------------------------------
    // NORMAL MESSAGE → Run classifier
    //------------------------------------------
    let ai: ClassificationResult | null = null;
    try {
      ai = await classifyMoodAndLanguage(text);
    } catch (err) {
      logger.error(err, "AI classifier failed");
    }

    const mood = ai?.mood || null;
    const detectedLanguage = ai?.language || null;
    const vibe = ai?.vibe || null;
    const artist = ai?.artist || null;
    const track = ai?.track || null;
    const intent = ai?.intent || "playlist";

    //------------------------------------------
    // USER ASKS FOR STATS
    //------------------------------------------
    const normalizedCommand = textLower.trim();
    const isStats =
      normalizedCommand === "stats" ||
      normalizedCommand === "my stats" ||
      normalizedCommand === "show my stats" ||
      (intent as any) === "user_stats";

    if (isStats) {
      const stats = getUserStats(from);
      if (!stats) {
        await sendTwilioMessage(
          from,
          "I don't have any stats yet — ask me for a playlist first!"
        );
        return res.json({ ok: true });
      }

      const firstDate = new Date(stats.first).toLocaleString("en-IN");
      const lastDate = new Date(stats.last).toLocaleString("en-IN");

      await sendTwilioMessage(
        from,
        [
          "📊 Your Listening Stats:",
          `• Playlists asked: ${stats.totalPlays}`,
          `• Favorite mood: ${stats.topMood} (${stats.topMoodCount})`,
          `• Favorite language: ${stats.topLanguage} (${stats.topLanguageCount})`,
          `• Most used playlist: ${stats.topPlaylistName} (${stats.topPlaylistCount})`,
          "",
          `First use: ${firstDate}`,
          `Last use: ${lastDate}`,
        ].join("\n")
      );

      return res.json({ ok: true });
    }

    //------------------------------------------
    // IF NO LANGUAGE → ASK USER
    //------------------------------------------
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

      await sendTwilioMessage(
        from,
        `Got it! What language do you prefer? (english, hindi, tamil, telugu...)`
      );

      return res.json({ ok: true });
    }

    //------------------------------------------
    // FETCH PLAYLIST
    //------------------------------------------
    const language = detectedLanguage;

    let prev = mood ? getLastHistory(from, mood, language) : null;
    const excludeId = prev?.playlistId;

    let searchQuery = "";
    if (intent === "artist_search") {
      searchQuery = [artist, track, mood, textLower].filter(Boolean).join(" ");
    } else {
      searchQuery = [mood, vibe].filter(Boolean).join(" ") || textLower;
    }

    const tracks = await getPlaylistForMood(searchQuery, language, excludeId);
    const playlistMeta = (tracks as any).playlist;
    const altMeta = (tracks as any).alternatePlaylist;

    let replyLines: string[] = [];

    if (!tracks.length || !playlistMeta) {
      replyLines.push(
        `I couldn't find anything for "${searchQuery}". Try another mood or artist!`
      );
    } else {
      const first = tracks[0];

      replyLines.push(
        `🎧 Playlist Recommendation (${language}):`,
        `Playlist: ${playlistMeta.name}`,
        playlistMeta.url ? `Link: ${playlistMeta.url}` : "",
        "",
        `Song: ${first.name}`,
        `Artists: ${first.artists}`
      );

      if (altMeta?.url) {
        replyLines.push("", `Alternate: ${altMeta.name}`, altMeta.url);
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

  } catch (err) {
    logger.error(err, "Webhook error");
    await sendTwilioMessage(
      req.body.From,
      "Something went wrong — try again!"
    );
    return res.status(500).json({ ok: false });
  }
});
