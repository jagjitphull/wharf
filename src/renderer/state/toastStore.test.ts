import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TOASTS, toast, useToastStore } from "./toastStore";

beforeEach(() => {
  vi.useFakeTimers();
  for (const t of useToastStore.getState().toasts) useToastStore.getState().dismiss(t.id);
});
afterEach(() => vi.useRealTimers());

const messages = () => useToastStore.getState().toasts.map((t) => t.message);

describe("toasts", () => {
  it("shows a toast and removes it after its duration", () => {
    toast.success("Saved");
    expect(messages()).toEqual(["Saved"]);
    vi.advanceTimersByTime(2999);
    expect(messages()).toEqual(["Saved"]);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it("keeps errors on screen longer than successes", () => {
    toast.error("Boom");
    toast.success("Fine");
    vi.advanceTimersByTime(3500);
    expect(messages()).toEqual(["Boom"]);
    vi.advanceTimersByTime(4000);
    expect(messages()).toEqual([]);
  });

  it("dismisses on demand and cancels its timer", () => {
    const id = toast.info("Hello");
    useToastStore.getState().dismiss(id);
    expect(messages()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops the oldest once the stack is full", () => {
    for (let i = 1; i <= MAX_TOASTS + 2; i++) toast.info(`t${i}`);
    expect(messages()).toEqual(["t3", "t4", "t5", "t6"]);
    expect(vi.getTimerCount()).toBe(MAX_TOASTS);
  });

  it("gives every toast its own id and kind", () => {
    toast.success("a");
    toast.error("b");
    const [a, b] = useToastStore.getState().toasts;
    expect(a.id).not.toBe(b.id);
    expect([a.kind, b.kind]).toEqual(["success", "error"]);
  });
});
