// src/tools/moodTools.ts
import { getPlaylistForMood } from "../clients/spotifyClient";
import { synthesizeVoice } from "../clients/elevenLabsClient";
import { sendTwilioMessage } from "../clients/twilioClient";

type MoodRequest = {
  to: string;
  mood: string;
  quote?: string;
};

// Text-only WhatsApp message with first track suggestion
export async function sendMoodPlaylistText(input: MoodRequest) {
  const tracks = await getPlaylistForMood(input.mood);
  const first = tracks[0];

  const bodyLines: string[] = [];

  bodyLines.push(`Mood: ${input.mood}`);

  if (first) {
    bodyLines.push(`Track: ${first.name}`);
    bodyLines.push(`Artists: ${first.artists}`);
    if (first.url) {
      bodyLines.push(`Link: ${first.url}`);
    }
  } else {
    bodyLines.push("No tracks found for this mood.");
  }

  if (input.quote) {
    bodyLines.push(`Quote: ${input.quote}`);
  }

  const body = bodyLines.join("\n");

  await sendTwilioMessage(input.to, body);
}

// Example: send voice + text (voice buffer returned, text sent via WhatsApp)
export async function sendMoodPlaylistWithVoice(input: MoodRequest) {
  const tracks = await getPlaylistForMood(input.mood);
  const first = tracks[0];

  const text = first
    ? `Here is a song suggestion for your mood ${input.mood}: ${first.name} by ${first.artists}.`
    : `I couldn't find a good song for your mood ${input.mood}, but I hope you feel better soon.`;

  // Generate audio (not yet attached as media in Twilio – that would require hosting the file)
  const audioBuffer = await synthesizeVoice(text);

  // Send plain text to WhatsApp for now
  await sendTwilioMessage(input.to, text);

  return audioBuffer;
}
