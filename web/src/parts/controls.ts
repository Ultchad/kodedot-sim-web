/**
 * The buttons of a board: what its manifest lists in `controls` as momentary (a reset or EN button, BOOT), for the
 * part's card. In the scene the same controls are the model's marked plungers (bench3d/controls.ts). Both write the
 * part's field in the bench store, true while held; the parts engine does the rest when the field reaches it
 * (`bench.setField`, docs/STATUS-parts.md fifth round): `restart` restarts the sketch when the field goes true,
 * `pull_low` holds the terminal `pin` at 0 V for as long as it stays true.
 */
import type { PartControl, PartField, PartManifest } from './service';

export interface PartButton {
  /** The boolean field the button holds true: also the control's id in the scene (`ControlMark.field`). */
  field: string;
  control: PartControl;
}

/**
 * The controls of a part that the card shows as press-and-hold buttons: momentary controls of a boolean field that
 * do something on the board (`action`), or that belong to a part running a sketch (the firmware reads the field).
 * A plain part's momentary field (the push button's `pressed`) stays the switch it is in the card.
 */
export function buttonsOf(m: Pick<PartManifest, 'controls' | 'fields' | 'behaviour'> | undefined): PartButton[] {
  if (!m) return [];
  const out: PartButton[] = [];
  for (const c of m.controls ?? []) {
    const f = m.fields?.find((x) => x.name === c.field);
    if (c.mode !== 'momentary' || f?.type !== 'boolean') continue;
    if (!c.action && m.behaviour?.type !== 'wasm') continue;
    if (!out.some((b) => b.field === c.field)) out.push({ field: c.field, control: c });
  }
  return out;
}

/** The fields the card shows as inputs: every field but the ones a button works. */
export function inputFieldsOf(m: Pick<PartManifest, 'controls' | 'fields' | 'behaviour'> | undefined): PartField[] {
  const held = new Set(buttonsOf(m).map((b) => b.field));
  return (m?.fields ?? []).filter((f) => !held.has(f.name));
}

/** What a button does, as a message key of the page and its variables. */
export function buttonHint(c: PartControl): { key: 'parts.button.restart' | 'parts.button.pull_low' | 'parts.button.plain'; vars?: { pin: string } } {
  if (c.action === 'restart') return { key: 'parts.button.restart' };
  if (c.action === 'pull_low' && c.pin) return { key: 'parts.button.pull_low', vars: { pin: c.pin } };
  return { key: 'parts.button.plain' };
}
