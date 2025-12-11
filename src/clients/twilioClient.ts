// src/clients/twilioClient.ts
import fetch from "node-fetch"; // or axios, whichever you use

const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER!;
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN!;

export async function sendTwilioMessage(to: string, body: string, mediaUrl?: string) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const params = new URLSearchParams();
  params.append("From", TWILIO_FROM);
  params.append("To", to);
  if (body) params.append("Body", body);
  if (mediaUrl) params.append("MediaUrl", mediaUrl);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const text = await res.text().catch(() => "");

  if (res.ok) {
    // return parsed JSON if you want; for now return success object
    return { ok: true, status: res.status, body: text };
  }

  // handle rate limit gracefully
  if (res.status === 429) {
    // log a friendly message and return a non-throwing error result
    console.warn(`Twilio rate limit (429). Message not sent to ${to}: ${text}`);
    return { ok: false, status: 429, error: "rate_limited", body: text };
  }

  // For other Twilio errors you may still throw or return error
  const err = { ok: false, status: res.status, statusText: res.statusText, body: text };
  console.error("Twilio error:", err);
  // Option A: don't throw, return err
  return err;

  // Option B: if you prefer throwing for non-429:
  // throw new Error(`Twilio error: ${res.status} ${res.statusText} - ${text}`);
}
