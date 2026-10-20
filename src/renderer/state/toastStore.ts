import { create } from "zustand";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

/** Most toasts on screen at once; the oldest is dropped to make room. */
export const MAX_TOASTS = 4;

const DURATION_MS: Record<ToastKind, number> = {
  success: 3000,
  info: 4000,
  // Errors say what went wrong, so they stay long enough to read.
  error: 7000,
};

interface ToastState {
  toasts: Toast[];
  show(kind: ToastKind, message: string): number;
  dismiss(id: number): void;
}

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  show(kind, message) {
    const id = nextId++;
    const kept = get().toasts.slice(-(MAX_TOASTS - 1));
    for (const dropped of get().toasts.filter((t) => !kept.includes(t))) get().dismiss(dropped.id);
    set({ toasts: [...kept, { id, kind, message }] });
    timers.set(
      id,
      setTimeout(() => get().dismiss(id), DURATION_MS[kind]),
    );
    return id;
  },

  dismiss(id) {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Fire-and-forget helpers, usable outside React. */
export const toast = {
  success: (message: string) => useToastStore.getState().show("success", message),
  error: (message: string) => useToastStore.getState().show("error", message),
  info: (message: string) => useToastStore.getState().show("info", message),
};
