import type { LogLevel, LogLine, LogStream, Observable, Unsubscribe } from './types';

/** Minimal mutable Observable. Notifies only when the value actually changes (Object.is). */
export class Atom<T> implements Observable<T> {
  private listeners = new Set<(v: T) => void>();
  constructor(private value: T) {}

  get = (): T => this.value;

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const l of [...this.listeners]) l(next);
  }

  subscribe = (listener: (v: T) => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/** Capped log buffer. Each append replaces the array so snapshots stay immutable. */
export class LogBuffer implements LogStream {
  private atom = new Atom<readonly LogLine[]>([]);
  private nextId = 1;
  constructor(private cap = 2000) {}

  get = (): readonly LogLine[] => this.atom.get();
  subscribe = (l: (v: readonly LogLine[]) => void): Unsubscribe => this.atom.subscribe(l);

  push(level: LogLevel, text: string, ts = Date.now()): void {
    const line: LogLine = { id: this.nextId++, ts, level, text };
    const cur = this.atom.get();
    const next = cur.length >= this.cap ? [...cur.slice(cur.length - this.cap + 1), line] : [...cur, line];
    this.atom.set(next);
  }

  clear = (): void => this.atom.set([]);
}
