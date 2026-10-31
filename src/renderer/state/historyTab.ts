import { create } from "zustand";

/** Which part of the History view is showing; the command palette sets it to jump straight to transcript search. */
export type HistoryTab = "commands" | "transcripts";

interface HistoryTabState {
  tab: HistoryTab;
  setTab(tab: HistoryTab): void;
}

export const useHistoryTab = create<HistoryTabState>((set) => ({
  tab: "commands",
  setTab: (tab) => set({ tab }),
}));
