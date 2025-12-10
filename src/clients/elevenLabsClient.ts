// src/clients/elevenLabsClient.ts
import axios from "axios";
import FormData from "form-data";
import { logger } from "../utils/logger";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

// For downloading Twilio media (voice notes)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";

// Basic sanity logs on startup
if (!ELEVENLABS_API_KEY) {
  logger.warn(
    "ELEVENLABS_API_KEY is not set – ElevenLabs TTS/STT will not work."
  );
}
if (!ELEVENLABS_VOICE_ID) {
  logger.warn(
    "ELEVENLABS_VOICE_ID is not set – generateSpeechFromText will fail."
  );
}

/**
 * TEXT → SPEECH (TTS)
 * Returns MP3 audio as a Buffer.
 */
export async function generateSpeechFromText(text: string): Promise<Buffer> {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    throw new Error("Missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID");
  }

  logger.info(
    { len: text.length },
    "Calling ElevenLabs Text-to-Speech for reply audio"
  );

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;

  const response = await axios.post(
    url,
    {
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    },
    {
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      responseType: "arraybuffer",
    }
  );

  return Buffer.from(response.data);
}

/**
 * SPEECH → TEXT (STT)
 * Takes a raw audio buffer and returns the transcribed text.
 */
export async function transcribeAudioBuffer(audio: Buffer): Promise<string> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("Missing ELEVENLABS_API_KEY");
  }

  const formData = new FormData();

  // 🔑 ElevenLabs STT expects the binary audio under the field name "file"
  formData.append("file", audio, {
    filename: "audio.ogg", // WhatsApp voice notes are usually OGG/opus
    contentType: "audio/ogg",
  });

  // Scribe v1 model for transcription
  formData.append("model_id", "scribe_v1");

  logger.info(
    { size: audio.byteLength },
    "Calling ElevenLabs Speech-to-Text (Scribe v1)"
  );

  try {
    const response = await axios.post(
      "https://api.elevenlabs.io/v1/speech-to-text",
      formData,
      {
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          ...formData.getHeaders(),
        },
      }
    );

    // Response is typically: { text: string, language_code: string, ... }
    const text = (response.data && response.data.text) || "";
    return text.trim();
  } catch (err: any) {
    logger.error(
      {
        status: err?.response?.status,
        data: err?.response?.data,
      },
      "Error from ElevenLabs STT"
    );
    throw err;
  }
}

/**
 * Convenience helper:
 *  - Downloads audio from a Twilio media URL (with proper auth)
 *  - Sends it to ElevenLabs STT
 *  - Returns the transcription text
 */
export async function transcribeFromUrl(mediaUrl: string): Promise<string> {
  if (!mediaUrl) {
    throw new Error("mediaUrl is required for transcribeFromUrl");
  }

  logger.info({ mediaUrl }, "Downloading audio from Twilio for STT");

  const audioResp = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    auth:
      TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
        ? {
            username: TWILIO_ACCOUNT_SID,
            password: TWILIO_AUTH_TOKEN,
          }
        : undefined,
  });

  const audioBuffer = Buffer.from(audioResp.data);
  return transcribeAudioBuffer(audioBuffer);
}
