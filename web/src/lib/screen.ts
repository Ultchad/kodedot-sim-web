import { SCREEN_HEIGHT, SCREEN_WIDTH, type KodeDevice } from '../device/types';

/**
 * Pulls frames from the device and paints them into ONE offscreen-style canvas
 * (410x502). The 2D view mounts this canvas in the DOM; the 3D view uses it as
 * a texture source. Also measures the painted frame rate.
 */
export class ScreenPainter {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private device: KodeDevice | null = null;
  private raf = 0;
  private lastSeq = -1;
  private listeners = new Set<() => void>();
  private frames = 0;
  private windowStart = 0;
  fps = 0;
  /** Increments every time new pixels were painted. */
  version = 0;
  private lastFrame: ImageData | null = null;
  private overActive = false;
  private overlay: ((ctx: CanvasRenderingContext2D, w: number, h: number) => boolean) | null = null;

  /**
   * Something the page draws on top of the Dot's picture (the hold-to-go-home bar). Called once per animation frame; it
   * returns true when it drew, and is called once more after its last true so the picture is wiped. Because it lives in
   * this canvas, the 2D view, the 3D device and the Workbench Dot all show it the same way.
   */
  setOverlay(draw: ((ctx: CanvasRenderingContext2D, w: number, h: number) => boolean) | null): void {
    this.overlay = draw;
  }

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SCREEN_WIDTH;
    this.canvas.height = SCREEN_HEIGHT;
    this.canvas.setAttribute('data-testid', 'screen-canvas');
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas not available');
    this.ctx = ctx;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  attach(device: KodeDevice): void {
    this.device = device;
    this.lastSeq = -1;
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  onFrame(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.listeners.clear();
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const dev = this.device;
    if (!dev) return;
    const f = dev.getFrame();
    const changed = f.seq !== this.lastSeq;
    if (changed) {
      this.lastSeq = f.seq;
      this.lastFrame = new ImageData(f.data as Uint8ClampedArray<ArrayBuffer>, f.width, f.height);
    }
    // The picture is laid down again when it changed or when a bar stands on it (a new bar is drawn over a clean one);
    // the overlay says whether it drew, and a frame after its last bar wipes it.
    const wasOver = this.overActive;
    if (this.lastFrame && (changed || wasOver)) this.ctx.putImageData(this.lastFrame, 0, 0);
    const drew = this.overlay && this.lastFrame ? this.overlay(this.ctx, SCREEN_WIDTH, SCREEN_HEIGHT) : false;
    this.overActive = drew;
    if (changed || drew || wasOver) {
      this.version++;
      this.frames++;
      for (const l of this.listeners) l();
    }
    if (now - this.windowStart >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.windowStart || 1));
      this.frames = 0;
      this.windowStart = now;
    }
  };
}
