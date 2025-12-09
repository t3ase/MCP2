// src/config/env.ts
import * as dotenv from "dotenv";

dotenv.config(); // load .env into process.env

export const config = {
  port: Number(process.env.PORT) || 3000,
  logLevel: process.env.LOG_LEVEL ?? "info",

  // flat keys (old style)
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER ?? "",

  spotifyClientId: process.env.SPOTIFY_CLIENT_ID ?? "",
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? "",

  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
  elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "",

  openaiApiKey: process.env.OPENAI_API_KEY ?? "",

  // nested objects used by clients
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    fromNumber: process.env.TWILIO_FROM_NUMBER ?? ""
  },

  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID ?? "",
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? ""
  },

  elevenLabs: {
    apiKey: process.env.ELEVENLABS_API_KEY ?? "",
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? ""
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? ""
  }
} as const;

// some original code expected this – keep as a no-op helper
export function assertOutboundDeps(_service: string, _vars: string[]) {
  // could add runtime validation here later
}
