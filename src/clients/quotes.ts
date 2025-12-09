import { Mood } from "../utils/moodClassifier";

const quotesByMood: Record<Mood, string[]> = {
  stressed: [
    "Breathe. You’re doing better than you think.",
    "One step at a time. You’ve handled harder.",
  ],
  bored: [
    "Adventure is out there—maybe start with a new song.",
    "Boredom is the universe asking you to explore.",
  ],
  excited: [
    "Ride the wave—you earned this energy.",
    "This is the spark. Keep it lit.",
  ],
  sad: [
    "It’s okay to feel this. Brighter chapters are ahead.",
    "You matter more than you know.",
  ],
  calm: [
    "Stay in the stillness; it’s powerful.",
    "Quiet is a superpower. Enjoy it.",
  ],
  unknown: [
    "Here’s a boost for you—no mood labels needed.",
    "Music + a thought for you. Hope it helps.",
  ],
};

export const getQuote = (mood: Mood): string => {
  const list = quotesByMood[mood] ?? quotesByMood.unknown;
  return list[Math.floor(Math.random() * list.length)];
};

