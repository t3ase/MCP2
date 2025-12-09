// src/clients/spotifyClient.ts
import SpotifyWebApi from "spotify-web-api-node";
import { config } from "../config/env";
import { logger } from "../utils/logger";

const spotifyApi = new SpotifyWebApi({
  clientId: config.spotify.clientId,
  clientSecret: config.spotify.clientSecret,
});

async function ensureAccessToken() {
  if (!config.spotify.clientId || !config.spotify.clientSecret) {
    throw new Error("Missing Spotify client credentials in .env");
  }

  const tokenData = await spotifyApi.clientCredentialsGrant();
  spotifyApi.setAccessToken(tokenData.body.access_token);
}

// src/clients/spotifyClient.ts

type TrackInfo = {
  name: string;
  artists: string;
  url?: string;
};

type PlaylistMeta = {
  id: string;
  name: string;
  url?: string;
};

type TracksWithMeta = TrackInfo[] & {
  playlist?: PlaylistMeta;           // the playlist we actually used
  alternatePlaylist?: PlaylistMeta;  // another option for user to try
};

// NOTE: now accepts optional `language` and `excludePlaylistId`
export async function getPlaylistForMood(
  mood: string,
  language?: string,
  excludePlaylistId?: string
): Promise<TracksWithMeta> {
  await ensureAccessToken();

  const parts: string[] = [];
  if (mood) parts.push(mood);
  if (language) parts.push(language);

  const query = parts.join(" ").trim() || "happy";

  const search = await spotifyApi.searchPlaylists(query, { limit: 5 });

  console.log(
    "Spotify playlists search result:",
    JSON.stringify(search.body.playlists, null, 2)
  );

  const rawItems = search.body.playlists?.items ?? [];
  const playlists = (rawItems as any[]).filter((p) => p && p.id);

  const empty: TracksWithMeta = [] as TracksWithMeta;

  if (playlists.length === 0) {
    logger.warn(
      { mood, language, query, raw: search.body.playlists },
      "No valid playlists found"
    );
    return empty;
  }

  // primary = first playlist that is NOT the excluded one (if provided)
  let primary =
    playlists.find((p: any) => p.id !== excludePlaylistId) ?? playlists[0];

  // alternate = a different playlist from primary and exclude
  const alt = playlists.find(
    (p: any) => p.id !== primary.id && p.id !== excludePlaylistId
  );

  const playlistId = primary.id as string;

  const playlistTracks = await spotifyApi.getPlaylistTracks(playlistId, {
    limit: 10,
  });

  const trackItems = (playlistTracks.body.items ?? []) as any[];

  const tracks = trackItems
    .map((item) => {
      const track = item?.track;
      if (!track) return null;

      const artistsArr = (track.artists ?? []) as any[];

      return {
        name: track.name as string,
        artists: artistsArr.map((a) => a.name as string).join(", "),
        url: track.external_urls?.spotify as string | undefined,
      };
    })
    .filter(Boolean) as TrackInfo[];

  const withMeta = tracks as TracksWithMeta;

  withMeta.playlist = {
    id: primary.id as string,
    name: primary.name as string,
    url: primary.external_urls?.spotify as string | undefined,
  };

  if (alt) {
    withMeta.alternatePlaylist = {
      id: alt.id as string,
      name: alt.name as string,
      url: alt.external_urls?.spotify as string | undefined,
    };
  }

  return withMeta;
}

// keep compatibility with old name
export const getTracksForMood = getPlaylistForMood;
