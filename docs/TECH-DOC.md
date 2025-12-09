# Mood-Based Music & Quote MCP – Technical Notes (Draft)

## Overview
- Purpose: respond to incoming WhatsApp/SMS with mood-aware playlist + quote, optionally voice.
- Entry: Twilio webhook (`POST /webhooks/twilio`) or MCP-style HTTP tools (`/mcp/tools`, `/mcp/call`).

## Architecture
- Express server (`src/server.ts`) with CORS + JSON/urlencoded middleware.
- Tool registry (`src/tools/moodTools.ts`) implements MCP-like tools and an orchestration flow.
- External clients:
  - Spotify client credentials for playlist search (`src/clients/spotifyClient.ts`).
  - Quotes provider (static) (`src/clients/quotes.ts`).
  - ElevenLabs TTS (optional) (`src/clients/elevenLabsClient.ts`).
  - Twilio send (`src/clients/twilioClient.ts`).
- Routing:
  - `/mcp/tools` returns tool definitions.
  - `/mcp/call` executes a tool by name.
  - `/webhooks/twilio` handles inbound message and triggers `run_mood_flow`.

## Tool contracts
- `detect_mood(text)` → `{ mood }`
- `get_playlist(mood)` → `{ title, url, description? }`
- `get_quote(mood)` → `{ quote }`
- `synthesize_voice(text, voiceId?)` → `{ audio: base64 | null, contentType }`
- `send_message(to, body, mediaUrl?)` → `{ status: "sent" }`
- `run_mood_flow(to, text, includeVoice?)` → `{ mood, playlist, quote, sent, mediaUrl }`

## Error handling
- Central try/catch in `/mcp/call` and webhook with logging (`pino`).
- Spotify/Twilio/ElevenLabs clients throw with status details; upstream routes translate to 500.
- Unknown moods fall back to “unknown” category + default playlist/quote.

## Security & env
- Configuration via `.env` (see `config/env.example`).
- Secrets are read at runtime; no secrets in repo.
- Ensure webhook URL is validated at Twilio side (Auth Token signature) for production.

## Gaps / next steps
- Host generated audio and pass `MediaUrl` in Twilio replies.
- Add LLM-based mood classifier option.
- Add UI dashboard for manual triggers + logs.
- Add automated tests and CI.
- Add OpenAPI snippet for MCP HTTP facade.



