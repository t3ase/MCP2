# MCP2 – Mood-Based Playlist & Quote Server

A small Express/TypeScript service that classifies incoming WhatsApp (or HTTP tool calls) by mood/intent and replies with a Spotify playlist as a response. Endpoints are exposed for Twilio webhooks and for MCP-style tools.

## Prerequisites
- Node.js 18+ and npm
- Spotify Client Credentials (client id/secret)
- Twilio credentials (for WhatsApp)
- ElevenLabs (voice) and OpenAI API key (LLM classifier; otherwise heuristics are used)

## Quick Start
```bash
cd MCP2
npm install
cp config/env.example .env   # fill in your values
npm run dev                  # starts with nodemon + ts-node on port 3000
```

Build and run production:
```bash
npm run build                # emits dist/
npm start                    # runs dist/server.js with source maps
```

Health check: `GET http://localhost:3000/healthz`

## Configuration (.env)
See `config/env.example` for all keys:
- `PORT` (default 3000)
- `LOG_LEVEL`
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- Spotify: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`
- Voice and LLM: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `OPENAI_API_KEY`

## Routes
- `POST /webhooks/twilio/whatsapp` — primary webhook for inbound WhatsApp/SMS. Handles text and voice (ElevenLabs STT) and replies via Twilio.
- `GET /healthz` — liveness probe.
- `POST /mcp/tools`, `POST /mcp/call` — MCP-style tool discovery/execution (see `src/routes/mcpRouter.ts`).

## Dev Notes
- Source: `src/` (Express app in `src/server.ts`, routers in `src/routes/`, clients in `src/clients/`).
- Build with `tsc`; outputs to `dist/`.
- Logging via `src/utils/logger.ts` (simple console wrapper).

## Twilio Webhook Setup (WhatsApp)
1) Start the server locally (`npm run dev`).
2) Expose via ngrok: `ngrok http 3000`.
3) Configure Twilio WhatsApp sandbox/webhook URL to `https://<ngrok>.ngrok.io/webhooks/twilio/whatsapp`.
4) Send a WhatsApp message to the sandbox number; the service will classify mood/intent and reply with a playlist link.

## MCP Tool Usage (optional)
- Discover tools: `POST /mcp/tools`.
- Invoke a tool: `POST /mcp/call` with `{ name, args }`. See `src/tools/moodTools.ts` for available tools (detect mood, get playlist, get quote, synthesize voice, send message, run_mood_flow).

## Testing / Troubleshooting
- Verify env vars are loaded (`console.log(process.env.PORT)` or check logs).
- If Spotify search returns empty, confirm credentials and that the search query/mood exists.
- If Twilio replies fail, check Twilio credentials and webhook URL, and watch logs for 429 rate limits.
- Voice/STT requires valid ElevenLabs keys and audio media in the incoming message.

## Scripts
- `npm run dev` — live-reload dev server (nodemon + ts-node).
- `npm run build` — compile TypeScript to `dist/`.
- `npm start` — run compiled server.

## Architecture & Design Diagram

### System Architecture

```mermaid
graph TB
    subgraph "External Services"
        TW[Twilio WhatsApp]
        SP[Spotify API]
        OAI[OpenAI API]
        EL[ElevenLabs API]
    end

    subgraph "Express Server"
        SERVER[Express Server<br/>Port 3000]
        
        subgraph "Routes"
            WEBHOOK[Webhook Router<br/>/webhooks/twilio/whatsapp]
            MCP[MCP Router<br/>/mcp/*]
            HEALTH[Health Check<br/>/healthz]
        end
        
        subgraph "Clients"
            TWCLIENT[Twilio Client<br/>Send Messages]
            SPCLIENT[Spotify Client<br/>Search Playlists]
            OAICLIENT[OpenAI Client<br/>Mood Classification]
            ELCLIENT[ElevenLabs Client<br/>TTS/STT]
        end
        
        subgraph "Core Logic"
            CLASSIFIER[Mood Classifier<br/>Rule-based fallback]
            SESSION[Session Manager<br/>In-memory state]
            HISTORY[History Tracker<br/>User stats]
        end
        
        subgraph "Utils"
            LOGGER[Logger]
            CONFIG[Config/Env]
        end
    end

    TW -->|POST| WEBHOOK
    WEBHOOK -->|Classify| OAICLIENT
    WEBHOOK -->|Fallback| CLASSIFIER
    WEBHOOK -->|Search| SPCLIENT
    WEBHOOK -->|Voice| ELCLIENT
    WEBHOOK -->|Send| TWCLIENT
    WEBHOOK -->|State| SESSION
    WEBHOOK -->|Track| HISTORY
    
    OAICLIENT -->|API Call| OAI
    SPCLIENT -->|API Call| SP
    ELCLIENT -->|API Call| EL
    TWCLIENT -->|API Call| TW
    
    MCP -->|Tools| SPCLIENT
    MCP -->|Tools| TWCLIENT
    
    SERVER --> WEBHOOK
    SERVER --> MCP
    SERVER --> HEALTH
    
    CONFIG --> SERVER
    LOGGER --> SERVER
```

### Request Flow: WhatsApp Message Processing

```mermaid
sequenceDiagram
    participant User
    participant Twilio
    participant Webhook
    participant OpenAI
    participant Spotify
    participant Session
    participant History

    User->>Twilio: Send WhatsApp Message<br/>(text or voice)
    Twilio->>Webhook: POST /webhooks/twilio/whatsapp
    
    alt Voice Message Detected
        Webhook->>ElevenLabs: Transcribe audio (STT)
        ElevenLabs-->>Webhook: Transcribed text
    end
    
    Webhook->>Session: Get user session state
    
    alt Stats Request
        Webhook->>History: Get user stats
        History-->>Webhook: Stats data
        Webhook->>Twilio: Send stats message
    else Normal Message
        Webhook->>OpenAI: Classify mood/intent/language
        alt OpenAI Available
            OpenAI-->>Webhook: Classification result
        else Fallback
            Webhook->>Classifier: Rule-based classification
            Classifier-->>Webhook: Mood detected
        end
        
        alt Language Missing
            Webhook->>Session: Set stage: waiting_language
            Webhook->>Twilio: Ask for language preference
        else Language Detected
            Webhook->>Spotify: Search playlists<br/>(mood, language, exclude previous)
            Spotify-->>Webhook: Playlist + tracks
            
            Webhook->>History: Save playlist usage
            Webhook->>Session: Update session state
            Webhook->>Twilio: Send playlist recommendation
        end
    end
    
    Twilio->>User: Deliver message
```

### Component Interaction Diagram

```mermaid
graph LR
    subgraph "Input Layer"
        A1[WhatsApp Message]
        A2[Voice Note]
        A3[MCP Tool Call]
    end
    
    subgraph "Processing Layer"
        B1[Message Parser]
        B2[Intent Classifier]
        B3[Session Handler]
    end
    
    subgraph "Service Layer"
        C1[OpenAI Client<br/>LLM Classification]
        C2[Spotify Client<br/>Playlist Search]
        C3[ElevenLabs Client<br/>Voice Processing]
        C4[Twilio Client<br/>Message Sending]
    end
    
    subgraph "Data Layer"
        D1[Session Store<br/>In-memory Map]
        D2[History Store<br/>In-memory Map]
    end
    
    subgraph "Output Layer"
        E1[WhatsApp Reply]
        E2[Voice Response]
        E3[MCP Response]
    end
    
    A1 --> B1
    A2 --> B1
    A3 --> B1
    
    B1 --> B2
    B2 --> C1
    B2 --> B3
    
    B3 --> D1
    B3 --> D2
    
    C1 --> B3
    B3 --> C2
    C2 --> C4
    C4 --> E1
    
    A2 --> C3
    C3 --> B1
    C3 --> E2
    
    A3 --> C2
    C2 --> E3
```

### Data Flow: Classification & Playlist Retrieval

```mermaid
flowchart TD
    START[User Message] --> CHECK{Has Media?}
    CHECK -->|Yes| STT[ElevenLabs STT<br/>Transcribe Audio]
    CHECK -->|No| TEXT[Use Text]
    STT --> TEXT
    
    TEXT --> CLASSIFY{OpenAI<br/>Available?}
    CLASSIFY -->|Yes| LLM[OpenAI GPT-4<br/>Extract: mood, language,<br/>vibe, artist, track, intent]
    CLASSIFY -->|No| HEURISTIC[Rule-based<br/>Keyword Matching]
    
    LLM --> FALLBACK[Heuristic Fallback<br/>Artist Detection Regex]
    HEURISTIC --> FALLBACK
    
    FALLBACK --> INTENT{Intent Type?}
    INTENT -->|artist_search| ARTIST[Build Query:<br/>artist + track + mood]
    INTENT -->|playlist| MOOD[Build Query:<br/>mood + vibe]
    INTENT -->|repeat| REPEAT[Use Last Playlist]
    INTENT -->|change_vibe| VIBE[Adjust Vibe Query]
    
    ARTIST --> SPOTIFY[Spotify API<br/>Search Playlists]
    MOOD --> SPOTIFY
    VIBE --> SPOTIFY
    
    SPOTIFY --> FILTER{Previous<br/>Playlist?}
    FILTER -->|Yes| EXCLUDE[Exclude Last Used]
    FILTER -->|No| INCLUDE[Include All]
    
    EXCLUDE --> RESULTS[Get Playlist Results]
    INCLUDE --> RESULTS
    
    RESULTS --> HISTORY[Save to History]
    HISTORY --> REPLY[Format Reply Message]
    REPLY --> SEND[Twilio Send Message]
    SEND --> END[User Receives Reply]
```

### Session State Machine

```mermaid
stateDiagram-v2
    [*] --> idle: Initial State
    
    idle --> waiting_language: No language detected
    idle --> playlist_shown: Language detected
    
    waiting_language --> playlist_shown: User provides language
    
    playlist_shown --> idle: New request
    playlist_shown --> playlist_shown: Repeat/Change vibe
    
    note right of idle
        Default state
        Ready for new requests
    end note
    
    note right of waiting_language
        Waiting for user
        to specify language
        preference
    end note
    
    note right of playlist_shown
        Playlist sent
        Can handle:
        - Repeat requests
        - Vibe changes
        - New searches
    end note
```
