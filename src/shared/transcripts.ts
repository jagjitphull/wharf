/** What Session Transcripts keeps — shared by the main process (which applies it) and Settings. */
export interface TranscriptSettings {
  /** Record the text of every new terminal session so it can be searched later. Off by default: output can contain anything. */
  enabled: boolean;
  /** Transcripts older than this many days are deleted; 0 keeps them until removed. */
  retentionDays: number;
}

export const RETENTION_CHOICES = [7, 30, 90, 365, 0] as const;

export const DEFAULT_TRANSCRIPT_SETTINGS: TranscriptSettings = { enabled: false, retentionDays: 30 };

export function normalizeTranscriptSettings(value: Partial<TranscriptSettings> | null | undefined): TranscriptSettings {
  const days = Number(value?.retentionDays);
  return {
    enabled: value?.enabled === true,
    retentionDays: (RETENTION_CHOICES as readonly number[]).includes(days) ? days : DEFAULT_TRANSCRIPT_SETTINGS.retentionDays,
  };
}

/** One recorded session, as listed. */
export interface TranscriptInfo {
  id: string;
  /** null for a local shell. */
  hostId: string | null;
  hostName: string;
  startedAt: number;
  /** When it last received output (still moving while `active`). */
  updatedAt: number;
  bytes: number;
  /** The session is still open and still being recorded. */
  active: boolean;
}

export interface TranscriptLine {
  t: number;
  text: string;
}

export interface TranscriptContent {
  info: TranscriptInfo;
  lines: TranscriptLine[];
}

export interface TranscriptMatch {
  transcriptId: string;
  hostName: string;
  startedAt: number;
  /** 0-based index of the line in its transcript. */
  line: number;
  t: number;
  text: string;
  before: string[];
  after: string[];
}

export interface TranscriptSearchResult {
  matches: TranscriptMatch[];
  /** More matched than were returned. */
  truncated: boolean;
}

export const TRANSCRIPT_SEARCH_LIMIT = 300;
