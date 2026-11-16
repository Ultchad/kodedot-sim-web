# Style sheet for the starter apps

Derived from kui (`components/kui`), kodeOS's own screens (`KodeOS/components/kgui`), the real screenshots in `docs/kodeos-shots/`, the SDK examples and the catalog rules (`kode-apps/RULES.md`, D1 to D9). The aim is "the same style as Kode's apps, not identical": every number below is one of kui's tokens, never a new one.

## Ground and colour

- The page is true black (`KUI_COLOR_BG`, AMOLED pixels off). No gradients, no shadows, no borders. A row is `KUI_COLOR_SURFACE` (0x212121), a pressed row `KUI_COLOR_REST`.
- Text is Light Grey (`KUI_COLOR_TEXT_ON_BG`), secondary text Medium Grey (`KUI_COLOR_TEXT_MUTED`), never an opacity. Dark ink (`KUI_COLOR_TEXT`) only on a lit fill.
- Bold Yellow (`KUI_COLOR_ACTION`) is what you press: the one answer button of a screen, a level's fill, the focus ring. Kody Blue (`KUI_COLOR_ACCENT`) is for the app's own colour in discs and "connection" things. Green (`KUI_COLOR_OK`) is done, red (`KUI_COLOR_DANGER`) is an ending: Delete, Stop. Nothing else is coloured.

## Type

Outfit and DM Sans only, through kui's faces: `kui_font_heading` (a page title on a header, 34 ExtraBold), `kui_font_display_40` (the big line of an empty or result state), `kui_font_title` (34 Bold), `kui_font_name` (28 Bold: a row's name, the back bar), `kui_font_body` (28), `kui_font_caption` (22: a row's second line), `kui_font_code` / `code_80` / `hero_160` (DM Sans digits: UIDs, degrees, counters). Outfit has no digits of its own; kui falls back on DM Sans, so mixed text just works. Sentence case, no trailing full stops on titles, ASCII only.

## Shapes and sizes (glass 410 x 502, corners R114)

- Rows are **pills**: `kui_pill_create`, 346 x 80, fully round (`KUI_RADIUS_GLASS`), a 56 px round slot on the left (letter, count or a kui line glyph), a bold name and a muted caption. 12 px between two pills, 32 px side margin, so every row clears the glass corners between y 53 and y 448.
- The one answer button is kui's action capsule (`kui_style_action`): 60 px high, Bold Yellow, dark bold word. Wide variant 346 px when it is the page's single action. A destructive row is a pill dressed red, always asked twice.
- Levels are `kui_level_create` (12 px track, round knob), swatches `kui_swatch_create` (48 px discs, ringed when chosen), lamps and discs are round. Radii are never smaller than a pill's.
- Touch targets are at least 60 px high. Anything smaller is a decoration, not a control.

## Screens

- **Back bar** (kgui_backbar pattern): the page title centred at y 12, 44 px line, Outfit Bold 28, with a 12 x 22 round-capped chevron to its left on every page but the app's first; the list passes under it into a black that fades.
- **List page**: a back bar and a column of pills. The first page is the app's own list; the title is the app's name.
- **Result / empty / waiting**: centred, a big disc (112 px, kui header-disc), a `display_40` title, a body-face line in muted grey, then the single yellow button at the foot. The empty state of every list says what to do ("Nothing saved yet", "Hold a tag to the back"). A waiting state shows what it waits for and that it will stop on its own; an error says what happened and what to try, in plain words.
- **Sheet card**: for anything that asks (delete, rename): `kui_sheet` pattern, header disc left with title and subtitle, one yellow answer, the other way out is BOT.

## Navigation and hardware buttons (kodeOS's grammar)

- **UP / DOWN** move the focus ring (yellow, outside the pill) from row to row; **TOP** acts on the focused row; **LEFT / RIGHT** step a focused level. **BOT** goes back one level (short press); at the app's first page it does nothing. A swipe right is the same as BOT. Touch: tap a row. A press that travels more than 10 px acts on nothing (kui does this itself).
- **Holding BOT returns to kodeOS** (`CONFIG_KODEOS_HOME_HOLD` stays on). The apps never give the hold a meaning: BOT acts on release of a short press only, and a press that turned into a hold is ignored.
- The ring is drawn only after the pad was used; touching hides it.

## Behaviour rules the screens follow

- Nothing waits on the Active Object: every device request is an event, answered later; the screen shows a waiting state meanwhile and a timeout ends it.
- A destructive action asks, then confirms (D7). A control that cannot work says why instead of going grey.
- Saved items live in a small file in the app's own folder on `/storage`, written through `kode_sys_file_*` after every change.

## Icons and store

Each app has `appdata/icon.png`, 64 x 64 (what the board reads, 12 288 bytes as .k64), flat: a Light Grey line glyph on a disc in the app's `color`, no text. `app.json` holds only `color` (one of the palette's accents), `description` (up to 52 characters) and `icon`. Screenshots are 410 x 502, 1 to 4 per app, taken from the running simulator.
