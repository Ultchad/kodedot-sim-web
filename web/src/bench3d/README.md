# Bench3D: the model kit of the Workbench

Everything that stands on the Workbench table has a body built in code with this kit: the wireless bench objects
(tags, readers, router, TV ...) and the wired parts (boards, passives, motors ...). One part, one file, found by its
file name. You can build and judge a model alone, without the page.

```
web/src/bench3d/
  contract.ts     the contract (types, budgets, the check)            <- the law
  shape.ts        Shape: bevelled solids merged into one mesh per material family
  materials.ts    PAL (finishes) and INK (print colours)
  parts.ts        builders: pcb, pinHeader, lead, soic/qfp/qfn, moduleCan, usbC/usbB/microUsb/barrelJack,
                  tactButton, electrolytic, ledDome, screwTerminal, heatsink, shaft, gear
  print.ts        print(): silkscreen and legends as decals; drawing helpers
  nodes.ts        lamp(), glowing(), screen(), part(); instantiate() for hosts
  registry.ts     finds models/**/*.model.ts
  index.ts        import everything from here
  models/<family>/<part-id>.model.ts
  harness/        the model stand (one model, the Workbench's table and light)
```

## Run one model

```
cd web
node scripts/model-shot.mjs --model wifi.router            # front, back, side, low, top + every example state
node scripts/model-shot.mjs --model ref.led-5mm --state '{"brightness":0.4}'
node scripts/model-shot.mjs --all                           # every model; exit code 1 if one breaks the contract
node scripts/model-shot.mjs --list
node scripts/model-gallery.mjs [--filter led]               # contact sheet: screenshots/models/_gallery.png
npx vitest run src/bench3d                                  # the contract check for every model, in node, in a second
npx vite src/bench3d/harness                                # by hand: http://localhost:5173/?model=<id>&view=front&state=<name>
```

Shots land in `web/screenshots/models/<id>/`. `top.png` is a drawing: the footprint, the terminals with their ids and
a millimetre scale. The script prints triangles against the budget and what the check found. Look at your shots at
full size before you call a model done, next to the three reference models.

## The contract

```ts
// web/src/bench3d/models/<family>/<part-id>.model.ts
import { PAL, Shape, defineModel, print, topQuad, lamp, setLamp } from '../../index';

export default defineModel<MyState>({
  id: 'family.part-id',                 // unique: the part's manifest id, or the bench kind (wireless objects)
  title: 'Plain name',
  footprintMm: { w: 30, d: 20, h: 12 }, // the box the model stays inside (X, Z, Y). Real size.
  build(ctx) { ...; return root; },     // ONCE per model: a template
  plugMm: 0,                            // legs that reach below y = 0 to plug in (optional)
  terminals: [{ id: 'A', pos: [x, y, z], dir: [0, 1, 0], kind: 'pin' }],   // wired parts: terminalsFromManifest(manifest)
  animate(state, obj, env) { ... },     // per copy: show the live state. No allocation.
  states: { off: {...}, on: {...}, burning: {...} },   // examples; the harness renders each
});
```

Nobody edits a registry: the file name `*.model.ts` under `models/` is the registration. Two models with one id fail
the build with both paths in the message.

### Coordinates

- Millimetres. Never scale a model to "look right": use the datasheet.
- Origin: the centre of the footprint, on the table. **X to the right, Z towards the viewer, Y up.** The model stands on
  `y = 0` and stays inside `|x| <= w/2`, `|z| <= d/2`, `0 <= y <= h`.
- The front of a part (what the user reads, a connector's mouth, a screen) faces **+Z**.
- The Workbench turns a model in quarter turns about Y (clockwise seen from above) and never scales it. Builders take
  `turn` in the same sense (`turn: 1` makes a +Z mouth face -X).

### Wired parts: the manifest is the source

The parts engine ships each part as `parts/<id>/manifest.json` (docs/STATUS-parts.md, "Page wiring" 12 and 14). The
manifest already holds the body size and every pin's position in millimetres and the face it is on. **The model's id
is the manifest's `id`** (`dotbench.led`, `dotbench.uno-r3`), its footprint is the manifest's body, and its terminals
are the manifest's pins: never type those numbers a second time.

The manifest's frame has its origin at the **top-left corner** of the footprint seen from above (x right, y down the
picture, z up from the table); the model frame has it at the **centre**. The mapping is exact and is in the kit:

| Manifest | Model |
|---|---|
| `body: { w_mm, d_mm, h_mm }` | `footprintMm = footprintOf(body)` = `{ w: w_mm, d: d_mm, h: h_mm }` |
| `pin.mm.x` | `X = mm.x - w_mm / 2` |
| `pin.mm.y` (down the picture) | `Z = mm.y - d_mm / 2` (towards the viewer) |
| `pin.mm.z` (up) | `Y = mm.z`; when missing: `top` -> `h_mm`, `bottom` -> `0`, a side face -> `h_mm / 2` |
| `pin.face` | `dir`: top `[0,1,0]`, bottom `[0,-1,0]`, left `[-1,0,0]`, right `[1,0,0]`, front (y = d_mm) `[0,0,1]`, back (y = 0) `[0,0,-1]` |
| `pin.name` | `terminal.id` (the wiring's `<instance>.<pin>`) |
| `picture.svg` (top view, `picture.width / w_mm` px per mm) | the model's top view: `top.png` of the shot script must match it |

```ts
import manifest from '../../../../../parts/led/manifest.json';       // read-only; from web/src/bench3d/models/<family>/
import { defineModel, footprintOf, terminalsFromManifest, fromManifestMm, type PartState } from '../../index';
const terminals = terminalsFromManifest(manifest);                    // ids, positions, directions
export default defineModel<PartState>({ id: manifest.id, footprintMm: footprintOf(manifest.body), terminals, ... });
```

Build the pins and sockets where the terminals are (`fromManifestMm(body, pin.mm, pin.face)` gives the point; place
`pinHeader` rows from the first and last pin of the row), so the body and the wiring can never disagree.

- `h_mm` is the height above the **seating plane** `y = 0`. Legs that plug into a breadboard or a socket (`face:
  'bottom'`) reach below it: declare how far with `plugMm` and build them down to `y = -plugMm`. The host puts the
  legs into holes or raises the part on them.
- A manifest may allow the part to reach outside its body (`body.overhang_mm` per side: a breadboard's dovetail
  tabs, a connector): declare `overhangMm: overhangOf(manifest.body)` and the check lets geometry go that far out.
  The footprint (what the table keeps clear) stays the body.
- The model's state is the part's entry of `bench.state().parts[]`, typed `PartState`: `outputs.brightness`,
  `outputs.burnt`, `outputs.angle`, `power.on`, `fields`, `pins[<name>].mv` ... (the list is in "Page wiring" 14).
  The engine's hazard outputs (`overcurrent`, `burnt`, `burst`, `stalled`) are the hazard looks to build.
- `manifest.visuals[]` tells where the 2D picture shows an effect (a glow at x, y): put the 3D effect at the same
  place (`fromManifestMm` after dividing the pixels by `picture.width / w_mm`).

### Terminals (where wires attach)

`pos` is the point where a wire's end sits, in the model frame: the tip of a pin, the mouth of a socket, the middle of
a pad or of a screw clamp, the end of a lead. `dir` is the unit vector along which the wire leaves (default straight
up; a side entry points sideways). The builders return these points (`pinHeader` gives one per pin, `screwTerminal`
one per way, `usbC` the mouth), so compute your terminals from what the builders return instead of typing numbers
twice. `id` is what the wiring uses (`'D13'`, `'GND'`, `'A'`); keep it equal to the part engine's pin name.

### Static body and moving parts

`build` returns a root made with `shape.toObject()`. What is **directly under the root** from `Shape.toObject()` and
`print()` is the static body: the Workbench draws all copies of it as instances (one draw call per material family per
model, whatever the number of copies). What changes goes in a **named child**:

| Need | Make it with | Drive it in `animate` with |
|---|---|---|
| an indicator light, a light bar | `lamp(name, pos, size)` | `setLamp(obj, name, 0xRRGGBB, level)` |
| a moulded part that glows (LED dome, light pipe) | `glowing(name, shape)` | `setLamp(...)` |
| a display, a picture that changes | `screen(name, quad, ppm, { lit })` | `drawScreen(obj, name, key, (g, w, h) => ...)` |
| something that moves (horn, shaft, button cap) | `otherShape.toObject('name')`, added to the root | `part(obj, 'name')!.rotation.y = ...` |

Lean variants: `flatLamp(name, quad)` is a lit patch of two triangles (an SMD LED's top, a pixel); `lamp` is an
80-triangle lens; `halo(name, pos, r)` is the soft light a lamp throws on the board round it (a flat additive disc,
shown by `setLamp`). A part that heats up or burns: a `glowing` shell hidden until the hazard.

**Controls** (what the pointer works in 3D: a button cap, a switch lever, a knob): mark the moving child with
`markControl(node, mark)`; for a wired part `markControl(node, controlFromManifest(manifest, field))`. The Workbench
ray-casts the marked children of the copy under the pointer and, by `mark.mode`, holds the field at `values[1]` while
the pointer is down (`momentary`), steps it on a click (`toggle`, `nextValue`) or follows the pointer round the
knob's axis (`rotate`, `turnValueAt`); a press on a control never drags the part. The model only shows the state it
is given. See `controls.ts`; the infrared remote's caps are the example.

A board's own buttons (reset, EN, BOOT) are controls of its manifest too, and since parts batch 5 the manifest says
where each is (`controls[].mm`, the frame of the pins; `visuals[].mm` does the same for the on-board LED): build the
switch there and mark its plunger with `controlFromManifest`. A plunger is a 2 mm target: give the marked node a
`hitPad` the size of the switch's top (an unseen box that answers the ray), and show the press so that it reads from
the table's camera (the boards lower the plunger and light a small `halo` over the switch). What a press does is the
parts engine's, from the control's `action`: the model only shows the field it is given.

`animate(state, obj, env)` is called when the state changes and then every frame for as long as it returns `true`
(blink, spin). It runs for every copy: **no `new`, no array or object literals, no closures** in it. `part()` caches
its look-ups; `setLamp` and `drawScreen` do nothing when nothing changed. Do not touch the shared family materials.

The state of a wired part is `PartState` (see above); list example states with `partState({...})`, hazards included.
A hazard must be visible from the default camera, not a subtle tint. The wireless bench objects all take
`models/wireless/state.ts`.

### Budgets

Default triangle budget by footprint area (`budgetFor`): under 150 mm² 1,200; under 900 mm² 2,500; under 3,600 mm²
6,000; under 12,000 mm² 12,000; above 20,000. Override with `budget` and say why in a comment. At most 24 meshes per
model (aim for under 8): merge. `ctx.seg(n)` scales segment counts with the level of detail; use it for every round
thing. Textures: one per print, 6 to 12 px/mm, capped at 1024 px.

## The reference models

- `models/wireless/nfc-tag.model.ts` (simple): two solids, one print. 398 triangles, 3 draw calls.
- `models/wireless/wifi-router.model.ts` (complex): body in three families, feet, antennas, a print with legends, three
  lamps with a state machine in `animate`, four example states. 1,486 triangles.
- `models/reference/kit-sampler.model.ts`: every builder of `parts.ts` on one made-up, unbranded board, with silkscreen and
  terminals computed from what the builders return. Copy from it.
- `models/reference/led-5mm.model.ts` (wired): size and terminals from the manifest, legs with `plugMm`, a glowing
  dome, `PartState`, the hazard states `overcurrent` and `burnt`.

Their shots are in `web/screenshots/models/`. A new model should look at home next to them and next to the Dot.

## Quality bar

Do:
- Take the dimensions from the datasheet or the mechanical drawing, and write the source in the file's header.
- Bevel every edge a real part has rounded (`bevel` of prisms and boxes; 0.2 to 0.6 mm reads as moulded plastic,
  1.5+ as a soft case). A sharp box is a brick.
- Use `PAL` finishes. Metal is `tin`, `gold`, `copper`, `steel`; boards are `pcb*` with the FR4 look built in.
- Add the small printed things that make a part recognisable: silkscreen outline and reference, pin labels
  (`pinLabels`), polarity marks, a rating, a port's name, a button's symbol. Draw them in `print()`.
- Give boards their real details: drilled mounting holes (`pcb({ holes })`), the header rows where they really are,
  the crystal, the regulator, the reset button.
- A board with through-hole parts does not lie flat: its pins and solder joints poke out of the underside, so give
  `pcb` a `y` of 1.3 (the check fails a model that goes under the table without a `plugMm`).
- Check the top view: terminals on the pins, footprint tight round the model.

Don't:
- No white bricks, no single-colour blobs, no parts floating above the table or sinking into it.
- **No brands of any kind, real or invented** (the owner's rule for everything on the Workbench): no maker's name,
  no logo or logo-like mark, no wordmark, printed, debossed or shown on a screen; and nothing that says or contains
  "kode", "dot" or "dotbench". Print only functional, generic markings: pin and port names, LED legends, ratings
  ("5 V 2 A", "8 GB", "125 kHz"), polarity, reference designators (U1, C3), a revision, button symbols, generic
  standard signs (the contactless waves, the power sign). Where a real board carries its maker's name or logo, leave
  that area blank. Live data the user typed (a network name on a screen) is data, not a brand.
- No per-frame allocation, no timers, no listeners in a model. No random numbers in `build` (models must be the same
  on every visit).
- No textures from files, no fetches: everything is built in code.
- No new shared materials: if a finish is missing, ask for it in `PAL` (additive changes to the kit are welcome).
- Do not edit `contract.ts`, `registry.ts` or another model to make yours work.

## Colours

Give colours as sRGB hex, the way they should look (`'#1d6a45'`); the kit converts them once. (Until the commit that
fixed it, `Shape.add` converted twice and everything came out darker and redder: a model that compensated for that,
for instance with an `asSeen()` helper, must drop the compensation.)

## Planned for the kit (do not wait for it: keep your own copy in your family folder until it lands)

Builders written by the model families that belong here and will be moved in, names kept where possible: pins-down
header (`legRow`), radio module with antenna, SMD switch, chip passives, SOT-23/223, SOD-123, DPAK, DIP in a socket,
crystal, DC jack, JST-SH, shrouded header, finned heatsink, crimp housing, jumper cap, wire and ribbon, slide
switch, PP3 snaps, 3.81 mm screw terminal, right-angle header, socket strip, SMA jack, FPC connector, `outlineBoard`,
`printOnCylinder`, `extrude` and `roundLoop`. Changes to the kit are additive: what a model imports today keeps
working.

## For hosts (the Workbench, the stand)

```ts
import { MODELS, getModel } from './registry';
import { instantiate, makeCtx } from './index';
const template = model.build(makeCtx());        // once
const copy = instantiate(template);             // per copy; { dynamicOnly: true } when the static body is instanced
model.animate?.(state, copy, { time, dt });     // again every frame while it returns true
```

`inspectModel(model)` is the contract check used by the unit test and the shot script.
