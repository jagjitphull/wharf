import { app } from "electron";
import path from "node:path";
import { createTranscriptStore } from "./transcriptStore";
import { getTranscriptSettings, store } from "./store";
import { getUnlockedKey } from "./unlockedKey";

/** The app's session transcripts: under the data folder, sealed with the master password when there is one. */
export const transcripts = createTranscriptStore({
  dir: () => path.join(app.getPath("userData"), "transcripts"),
  settings: getTranscriptSettings,
  sealing: () => {
    if (!store.get("masterPassword")) return { mode: "none" };
    const key = getUnlockedKey();
    return key ? { mode: "key", key } : { mode: "locked" };
  },
  now: Date.now,
});
