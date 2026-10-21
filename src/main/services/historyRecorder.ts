import { randomUUID } from "node:crypto";
import type { CommandHistoryEntry, CommandHistoryInput } from "../../shared/types";
import { pruneByRetention, shouldRecordCommand, type HistorySettings } from "../../shared/historyFilter";

/** Entries kept at most; the oldest go first. */
export const COMMAND_HISTORY_MAX = 2000;

/** Where entries and settings live; the real one is the data file, tests use memory. */
export interface HistoryStorage {
  entries(): CommandHistoryEntry[];
  setEntries(entries: CommandHistoryEntry[]): void;
  settings(): HistorySettings;
  now(): number;
}

/**
 * Decides what Command History stores, so every rule lives in one place.
 *
 * A typed line arrives first as a guess rebuilt from keystrokes (`record`), and a
 * moment later — for shells with integration — the shell reports the exact text
 * it ran (`shellText`). Per session this remembers what the guess became, so the
 * report can replace it, drop it (the shell's text turned out to be filtered), or
 * be recorded on its own when there was no guess (typed ahead while another
 * command ran). A line the user hid with a leading space is remembered as hidden,
 * so the shell's report of it is dropped instead of recorded.
 */
export function createHistoryRecorder(storage: HistoryStorage) {
  const pending = new Map<string, { id: string } | "none" | "hidden">();

  function store(entries: CommandHistoryEntry[]): void {
    const kept = pruneByRetention(entries, storage.now(), storage.settings().retentionDays);
    if (kept.length > COMMAND_HISTORY_MAX) kept.splice(0, kept.length - COMMAND_HISTORY_MAX);
    storage.setEntries(kept);
  }

  function append(input: CommandHistoryInput): CommandHistoryEntry {
    const entry: CommandHistoryEntry = { id: randomUUID(), timestamp: storage.now(), ...input };
    store([...storage.entries(), entry]);
    return entry;
  }

  return {
    /** A command the user typed. Returns whether it was stored. */
    record(input: CommandHistoryInput & { hidden?: boolean }): boolean {
      const { hidden, ...entryInput } = input;
      if (hidden) {
        pending.set(input.sessionId, "hidden");
        return false;
      }
      if (!shouldRecordCommand(entryInput.command, storage.settings())) {
        pending.set(input.sessionId, "none");
        return false;
      }
      pending.set(input.sessionId, { id: append(entryInput).id });
      return true;
    },

    /** The shell's own text for the command it just started in `sessionId`. */
    shellText(input: Pick<CommandHistoryInput, "sessionId" | "hostId" | "hostName">, command: string): void {
      const state = pending.get(input.sessionId);
      pending.delete(input.sessionId);
      if (state === "hidden") return;

      const allowed = shouldRecordCommand(command, storage.settings());
      if (state && state !== "none") {
        const entries = storage.entries();
        const i = entries.findIndex((e) => e.id === state.id);
        if (i === -1) return; // aged out since
        if (!allowed) {
          store(entries.filter((e) => e.id !== state.id));
        } else {
          const next = [...entries];
          next[i] = { ...next[i], command };
          store(next);
        }
        return;
      }
      if (allowed) append({ ...input, command });
    },

    /** Applies the current settings to what is already stored: retention, and the size cap. */
    prune(): void {
      store(storage.entries());
    },

    forgetSession(sessionId: string): void {
      pending.delete(sessionId);
    },
  };
}

export type HistoryRecorder = ReturnType<typeof createHistoryRecorder>;
