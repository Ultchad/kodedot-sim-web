import type { LogLevel } from '../device/types';

/**
 * Firmware log lines arrive with their own decoration: a shell prompt glued in front ("kode> "), a level marker
 * ("!I ", "!N " for notices, "!W ", "!E ", "!D ") and an ISO timestamp. The console shows one compact time column and the bare message,
 * so this splits a raw line into its parts. Pure: unit-tested in logline.test.ts.
 */
export interface CleanLine {
  /** The message without prompt, level marker and timestamp. */
  text: string;
  /** Device time of the line in epoch ms, when the firmware printed one. */
  time: number | null;
  /** Level named by the firmware's marker, when there was one. */
  level: LogLevel | null;
}

const MARKER: Record<string, LogLevel> = { I: 'info', N: 'info', W: 'warn', E: 'error', D: 'debug', V: 'debug' };
const ISO = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s+/;

export function cleanLogLine(raw: string): CleanLine {
  let s = raw;
  let level: LogLevel | null = null;
  let time: number | null = null;
  // a prompt printed just before an asynchronous log line: drop it (a prompt followed by anything else stays)
  const prompt = /^[\w.-]{1,16}>\s+(?=![A-Z]\s|\d{4}-\d{2}-\d{2}T)/.exec(s);
  if (prompt) s = s.slice(prompt[0].length);
  const marker = /^!([INWEDV])\s+/.exec(s);
  if (marker) {
    level = MARKER[marker[1]];
    s = s.slice(marker[0].length);
  }
  const iso = ISO.exec(s);
  if (iso) {
    const t = Date.parse(iso[1].replace(',', '.'));
    if (!Number.isNaN(t)) {
      time = t;
      s = s.slice(iso[0].length);
    }
  }
  return { text: s, time, level };
}

/** The more severe of the adapter's level and the firmware marker ('input' always wins: it is the user's own line). */
export function effectiveLevel(lineLevel: LogLevel, marker: LogLevel | null): LogLevel {
  if (lineLevel === 'input' || !marker) return lineLevel;
  const rank: Record<LogLevel, number> = { debug: 0, info: 1, input: 1, warn: 2, error: 3 };
  return rank[marker] > rank[lineLevel] || lineLevel === 'info' ? marker : lineLevel;
}
