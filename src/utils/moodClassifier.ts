const keywords: Record<string, string[]> = {
  stressed: ["stressed", "overwhelmed", "anxious", "tired", "burned out"],
  bored: ["bored", "meh", "nothing to do"],
  excited: ["excited", "pumped", "hype", "can't wait", "happy"],
  sad: ["sad", "down", "unhappy", "blue"],
  calm: ["calm", "relaxed", "peaceful", "chill"],
};

export type Mood =
  | "stressed"
  | "bored"
  | "excited"
  | "sad"
  | "calm"
  | "unknown";

export const classifyMood = (text: string): Mood => {
  const normalized = text.toLowerCase();
  for (const [mood, terms] of Object.entries(keywords)) {
    if (terms.some((term) => normalized.includes(term))) {
      return mood as Mood;
    }
  }
  return "unknown";
};

