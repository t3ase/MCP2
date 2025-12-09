import { Router } from "express";
import { getPlaylistForMood } from "../clients/spotifyClient";

export const mcpRouter = Router();

// simple test route
mcpRouter.get("/", (_req, res) => {
  res.json({ ok: true, message: "MCP router working" });
});

// Spotify route: GET /mcp/spotify?mood=happy
mcpRouter.get("/spotify", async (req, res) => {
  try {
    const mood = (req.query.mood as string) || "happy";
    const tracks = await getPlaylistForMood(mood);

    res.json({
      ok: true,
      mood,
      tracks,
    });
  } catch (err: any) {
    console.error("Spotify error:", err);
    res.status(500).json({
      ok: false,
      error: "spotify_error",
      details: String(err?.message || err),
    });
  }
});
