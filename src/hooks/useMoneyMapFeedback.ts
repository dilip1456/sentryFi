import { useState } from "react";

const KEY = "sentryfi_money_map_feedback";

export type SuggestionFeedback = "accepted" | "dismissed";

export interface FeedbackEntry {
  feedback: SuggestionFeedback;
  at: string; // ISO timestamp
}

// Keyed by a stable suggestion id (e.g. "overage:Travel:2026-06" or "upcoming:Verizon:2026-07-15").
// Lets us avoid re-surfacing something the user already acted on or dismissed
// for that specific period, while still showing it again next month/instance
// since circumstances change.
export type Feedback = Record<string, FeedbackEntry>;

export const useMoneyMapFeedback = () => {
  const [feedback, setFeedbackState] = useState<Feedback>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); }
    catch { return {}; }
  });

  const recordFeedback = (suggestionId: string, fb: SuggestionFeedback) => {
    const next = { ...feedback, [suggestionId]: { feedback: fb, at: new Date().toISOString() } };
    setFeedbackState(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  const getFeedback = (suggestionId: string): FeedbackEntry | undefined => feedback[suggestionId];

  const clearFeedback = () => {
    setFeedbackState({});
    localStorage.removeItem(KEY);
  };

  return { feedback, recordFeedback, getFeedback, clearFeedback };
};
