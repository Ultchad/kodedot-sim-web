import { describe, expect, it } from 'vitest';
import { cleanLogLine, effectiveLevel } from './logline';

describe('cleanLogLine', () => {
  it('strips the firmware ISO time and keeps it as the line time', () => {
    const r = cleanLogLine('2026-11-16T19:55:43.331Z kaos.park the LF front end parked');
    expect(r.text).toBe('kaos.park the LF front end parked');
    expect(r.time).toBe(Date.parse('2026-11-16T19:55:43.331Z'));
    expect(r.level).toBeNull();
  });
  it('drops a prompt and a level marker glued in front of a log line', () => {
    const r = cleanLogLine('kode> !I 2026-11-16T19:55:43.331Z kaos.park the ES8311 not parked');
    expect(r.text).toBe('kaos.park the ES8311 not parked');
    expect(r.level).toBe('info');
    expect(r.time).not.toBeNull();
  });
  it('reads warning and error markers', () => {
    expect(cleanLogLine('!W low battery').level).toBe('warn');
    expect(cleanLogLine('!E 2026-11-16T19:55:43Z nvs: open failed')).toMatchObject({ level: 'error', text: 'nvs: open failed' });
  });
  it('leaves ordinary text, prompts and exclamation marks alone', () => {
    expect(cleanLogLine('kode> help')).toEqual({ text: 'kode> help', time: null, level: null });
    expect(cleanLogLine('!Important: read this')).toEqual({ text: '!Important: read this', time: null, level: null });
    expect(cleanLogLine('2026 was a good year')).toEqual({ text: '2026 was a good year', time: null, level: null });
    expect(cleanLogLine('')).toEqual({ text: '', time: null, level: null });
  });
});

describe('effectiveLevel', () => {
  it('lets the marker raise or set the level, never hide an input line', () => {
    expect(effectiveLevel('info', 'error')).toBe('error');
    expect(effectiveLevel('info', 'debug')).toBe('debug');
    expect(effectiveLevel('warn', 'info')).toBe('warn');
    expect(effectiveLevel('input', 'error')).toBe('input');
    expect(effectiveLevel('error', null)).toBe('error');
  });
});

describe('notice marker', () => {
  it('reads "!N" (notice) as an info line and drops the marker and the stamp', () => {
    expect(cleanLogLine('!N 2026-11-16T22:41:35.687Z kgui assets: source=fat')).toEqual({ text: 'kgui assets: source=fat', time: Date.parse('2026-11-16T22:41:35.687Z'), level: 'info' });
  });
});
