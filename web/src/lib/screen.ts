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
    if (f.seq !== this.lastSeq) {
      this.lastSeq = f.seq;
      this.ctx.putImageData(new ImageData(f.data as Uint8ClampedArray<ArrayBuffer>, f.width, f.height), 0, 0);
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
