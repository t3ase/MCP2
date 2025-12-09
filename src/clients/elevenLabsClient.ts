// src/clients/elevenLabsClient.ts
import { config } from "../config/env";

const ELEVEN_BASE_URL = "https://api.elevenlabs.io/v1";

export async function synthesizeTextToSpeech(text: string, voiceId?: string) {
  const apiKey = config.elevenLabs.apiKey;
  const vid = voiceId || config.elevenLabs.voiceId;

  if (!apiKey || !vid) {
    throw new Error("ElevenLabs API key or voice ID not configured");
  }

  const res = await fetch(`${ELEVEN_BASE_URL}/text-to-speech/${vid}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2"
    })
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs error: ${res.status} ${res.statusText}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

// alias for old code
export const synthesizeVoice = synthesizeTextToSpeech;
