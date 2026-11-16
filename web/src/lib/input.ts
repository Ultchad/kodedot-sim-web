import { Atom } from '../device/observable';
import type { ButtonId, KodeDevice, Observable } from '../device/types';

/**
 * Single input layer shared by the 2D view, the 3D view and the keyboard.
 *
 * Buttons are reference counted per "source" (a key, a pointer id), so a button
 * held by two fingers/keys is released only when both let go. Touch follows ONE
 * pointer at a time (the first one down); other pointers are ignored.
 */
export class InputController {
  private holds = new Map<ButtonId, Set<string>>();
  private _pressed = new Atom<ReadonlySet<ButtonId>>(new Set());
  private touchPointer: number | string | null = null;
  private lastTouch = { x: 0, y: 0 };

  readonly pressed: Observable<ReadonlySet<ButtonId>> = this._pressed;

  constructor(private getDevice: () => KodeDevice) {}

  press(id: ButtonId, source: string): void {
    let set = this.holds.get(id);
    if (!set) this.holds.set(id, (set = new Set()));
    if (set.has(source)) return;
    const was = set.size > 0;
    set.add(source);
    if (!was) {
      this.getDevice().setButton(id, true);
      this.publish();
    }
  }

  release(id: ButtonId, source: string): void {
    const set = this.holds.get(id);
    if (!set || !set.delete(source)) return;
    if (set.size === 0) {
      this.holds.delete(id);
      this.getDevice().setButton(id, false);
      this.publish();
    }
  }

  /** Release everything a source holds (e.g. a pointer that was cancelled). */
  releaseSource(source: string): void {
    for (const id of [...this.holds.keys()]) this.release(id, source);
  }

  touchDown(pointerId: number | string, x: number, y: number): boolean {
    if (this.touchPointer !== null) return false;
    this.touchPointer = pointerId;
    this.lastTouch = { x, y };
    this.getDevice().setTouch(x, y, true);
    return true;
  }

  touchMove(pointerId: number | string, x: number, y: number): void {
    if (this.touchPointer !== pointerId) return;
    this.lastTouch = { x, y };
    this.getDevice().setTouch(x, y, true);
  }

  touchUp(pointerId: number | string, x?: number, y?: number): void {
    if (this.touchPointer !== pointerId) return;
    if (x !== undefined && y !== undefined) this.lastTouch = { x, y };
    this.touchPointer = null;
    this.getDevice().setTouch(this.lastTouch.x, this.lastTouch.y, false);
  }

  get touching(): boolean {
    return this.touchPointer !== null;
  }

  /** Page hidden, window blurred, device swapped: nothing stays held. */
  releaseAll(): void {
    if (this.touchPointer !== null) this.touchUp(this.touchPointer);
    for (const [id] of [...this.holds]) {
      this.holds.delete(id);
      this.getDevice().setButton(id, false);
    }
    this.publish();
  }

  private publish(): void {
    this._pressed.set(new Set(this.holds.keys()));
  }
}
