/**
 * What the page and the 3D scene share about the Workbench besides the bench itself: the selection, and commands the
 * page sends to the scene (focus on the Dot, show the whole table). Not persisted.
 */
import { DOT_ID, SD_ID } from './layout';

export type WorkbenchCommand = { type: 'focus-dot' } | { type: 'frame-all' } | { type: 'focus'; id: string } | { type: 'shake' };

const NONE: ReadonlySet<string> = new Set();

/** Ids of bench objects, plus `DOT_ID` for the Dot itself and `SD_ID` for the microSD card. */
export class Selection {
  private ids: ReadonlySet<string> = NONE;
  private listeners = new Set<() => void>();

  get = (): ReadonlySet<string> => this.ids;
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  has(id: string): boolean {
    return this.ids.has(id);
  }
  /** The bench objects among the selection (not the Dot, not the card). */
  objects(): string[] {
    return [...this.ids].filter((id) => id !== DOT_ID && id !== SD_ID);
  }
  /** The one selected thing, when exactly one is. */
  single(): string | null {
    return this.ids.size === 1 ? [...this.ids][0] : null;
  }
  set(ids: Iterable<string>): void {
    const next = new Set(ids);
    if (next.size === this.ids.size && [...next].every((id) => this.ids.has(id))) return;
    this.ids = next.size ? next : NONE;
    for (const l of [...this.listeners]) l();
  }
  only(id: string): void {
    this.set([id]);
  }
  toggle(id: string): void {
    const next = new Set(this.ids);
    if (!next.delete(id)) next.add(id);
    this.set(next);
  }
  clear(): void {
    this.set([]);
  }
  /** Drops ids that no longer exist. */
  keep(alive: (id: string) => boolean): void {
    if ([...this.ids].some((id) => !alive(id))) this.set([...this.ids].filter(alive));
  }
}

export class WorkbenchBus {
  private listeners = new Set<(c: WorkbenchCommand) => void>();
  /** The kind being dragged out of the palette (its range shows on the table), or null. */
  dragKind: string | null = null;
  private dragListeners = new Set<() => void>();
  /** The board whose code editor is open (its instance id), or null. */
  code: string | null = null;
  private codeListeners = new Set<() => void>();
  openCode(id: string | null): void {
    if (this.code === id) return;
    this.code = id;
    for (const l of [...this.codeListeners]) l();
  }
  onCode = (l: () => void): (() => void) => {
    this.codeListeners.add(l);
    return () => this.codeListeners.delete(l);
  };
  getCode = (): string | null => this.code;
  /** The small menu opened on a thing of the table (right click, long press): where (client px) and for what (an id, or DOT_ID). */
  menu: { x: number; y: number; target: string } | null = null;
  private menuListeners = new Set<() => void>();
  openMenu(m: { x: number; y: number; target: string } | null): void {
    if (!m && !this.menu) return;
    this.menu = m;
    for (const l of [...this.menuListeners]) l();
  }
  onMenu = (l: () => void): (() => void) => {
    this.menuListeners.add(l);
    return () => this.menuListeners.delete(l);
  };
  getMenu = (): { x: number; y: number; target: string } | null => this.menu;
  /**
   * A picture of the table as it is on the screen now, about `maxWidth` pixels wide (set by the scene while the table
   * is shown; null otherwise). For the project export's cover.
   */
  capture: ((maxWidth?: number) => HTMLCanvasElement | null) | null = null;
  /** The pointer moves things, or draws wires between terminals. */
  tool: 'move' | 'wire' = 'move';
  /** The colour the next wire gets. */
  wireColor = '#d9412b';
  private toolListeners = new Set<() => void>();
  private toolSnap = { tool: this.tool, wireColor: this.wireColor };

  setTool(tool: 'move' | 'wire', color?: string): void {
    if (this.tool === tool && (color === undefined || color === this.wireColor)) return;
    this.tool = tool;
    if (color) this.wireColor = color;
    this.toolSnap = { tool: this.tool, wireColor: this.wireColor };
    for (const l of [...this.toolListeners]) l();
  }
  onTool = (l: () => void): (() => void) => {
    this.toolListeners.add(l);
    return () => this.toolListeners.delete(l);
  };
  getTool = (): { tool: 'move' | 'wire'; wireColor: string } => this.toolSnap;

  send(c: WorkbenchCommand): void {
    for (const l of [...this.listeners]) l(c);
  }
  on(l: (c: WorkbenchCommand) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  setDragKind(k: string | null): void {
    if (this.dragKind === k) return;
    this.dragKind = k;
    for (const l of [...this.dragListeners]) l();
  }
  onDragKind(l: () => void): () => void {
    this.dragListeners.add(l);
    return () => this.dragListeners.delete(l);
  }
}

/** MIME type of a palette tile dragged onto the table. */
export const KIND_MIME = 'application/x-dotbench-kind';
