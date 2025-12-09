// src/clients/twilioClient.ts
import { config } from "../config/env";

const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}`;

export async function sendTwilioMessage(to: string, body: string) {
  if (
    !config.twilio.accountSid ||
    !config.twilio.authToken ||
    !config.twilio.fromNumber
  ) {
    throw new Error("Twilio config missing");
  }

  const form = new URLSearchParams();
  form.append("From", config.twilio.fromNumber);
  form.append("To", to);
  form.append("Body", body);

  const res = await fetch(`${twilioBase}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          `${config.twilio.accountSid}:${config.twilio.authToken}`
        ).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio error: ${res.status} ${res.statusText} - ${text}`);
  }

  return res.json();
}

