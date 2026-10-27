import { writeFile } from "node:fs/promises";
import { dialog, ipcMain } from "electron";
import { IPC, type TranscriptContent, type TranscriptInfo, type TranscriptSearchResult, type TranscriptSettings } from "../../shared/types";
import { getTranscriptSettings, setTranscriptSettings } from "../services/store";
import { transcripts } from "../services/transcripts";

function plainText(content: TranscriptContent): string {
  const { info, lines } = content;
  const header = `# ${info.hostName} — ${new Date(info.startedAt).toLocaleString()}\n\n`;
  return header + lines.map((l) => l.text).join("\n") + "\n";
}

export function registerTranscriptsIpc(): void {
  // Honors a retention limit that has come due since the last launch.
  void transcripts.prune();

  ipcMain.handle(IPC.transcripts.list, (): Promise<TranscriptInfo[]> => transcripts.list());
  ipcMain.handle(IPC.transcripts.read, (_e, id: string): Promise<TranscriptContent | null> => transcripts.read(String(id)));
  ipcMain.handle(IPC.transcripts.search, (_e, query: string): Promise<TranscriptSearchResult> => transcripts.search(String(query)));
  ipcMain.handle(IPC.transcripts.remove, (_e, id: string): Promise<void> => transcripts.remove(String(id)));
  ipcMain.handle(IPC.transcripts.clear, (): Promise<void> => transcripts.clear());

  ipcMain.handle(IPC.transcripts.saveAs, async (_e, id: string): Promise<string | null> => {
    const content = await transcripts.read(String(id));
    if (!content) return null;
    const stamp = new Date(content.info.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const safeHost = content.info.hostName.replace(/[^\w.-]+/g, "_");
    const result = await dialog.showSaveDialog({
      title: "Save transcript",
      defaultPath: `${safeHost}-${stamp}.txt`,
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, plainText(content), "utf8");
    return result.filePath;
  });

  ipcMain.handle(IPC.transcripts.getSettings, (): TranscriptSettings => getTranscriptSettings());
  ipcMain.handle(IPC.transcripts.setSettings, (_e, settings: TranscriptSettings): TranscriptSettings => {
    const saved = setTranscriptSettings(settings);
    void transcripts.prune(); // a shorter retention applies to what is already stored
    return saved;
  });
}
