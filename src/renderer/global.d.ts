import type { WharfApi } from "@shared/api";

declare global {
  interface Window {
    wharf: WharfApi;
  }
}

export {};
