# The 3D model of the device

The 3D view can show three models. The choice is in the Device menu (on a
phone: Settings), under "3D model":

| Choice | What it is |
| --- | --- |
| Kode model (default) | `model.glb` in this folder: Kode's own model of the Kode Dot, made lighter for the web by `scripts/optimise-model.mjs` (see `NOTICE-model.md`). |
| Simple model | The procedural model built in code at start-up (described below). It is also what the page shows by itself when `model.glb` is missing, cannot be read, or the browser only has WebGL 1. |
| My own… | A `.glb`, or a `.gltf` with everything embedded, picked from disk or dropped on the page. It is kept in this browser (IndexedDB) and never uploaded. |

Whatever the model, the page draws the live 410 x 502 screen on it, makes the
glass touchable and the six controls pressable, and lights the LED.

## Frame, units, origin (procedural model and drop-in model alike)

- Units: **millimetres** (1 unit = 1 mm). The viewer does not rescale.
- Origin: the **centre of the body** (centre of its 46.65 x 77.0 x 19.8 mm bounding box).
- Axes: **+X right, +Y up** (towards the edge with the 20-pin connector), **+Z towards the viewer** (out of the screen).
- Front face on the plane z = +9.9, flat back plate on z = -9.9.

## Where the procedural model comes from

| What | Source |
| --- | --- |
| Outline 46.65 x 77.0 mm, screen 410 x 502 px, button and D-pad centres and sizes, button colours, light-guide and lanyard boxes | `kode-dot.json` (data) |
| Body corner radius 4.27 mm, black glass 3.0 mm wider than the picture at the sides and 3.3 mm above and below, glass corner radius 11.45 mm, inlay diameters (blue 5.97 mm, red 3.47 mm), D-pad inner radius | measured on `kode-dot.png` (the maker's orthographic front render) |
| Everything along Z, the walls and the back | estimates from the owner's reference pictures (not in the repository) |

The estimates are named constants with a comment each, in
`src/lib/bodyModel.ts`. The main ones:

| Constant | Value | Why |
| --- | --- | --- |
| `DEPTH_MM_ESTIMATE` | 19.8 | Edge-on reference: depth / height = 0.2585, so 19.9 mm for 77.0 mm. Angled reference, with the camera solved from the front-face features: best fit between 19.5 and 20.0 mm. |
| `FRONT_FILLET_MM_ESTIMATE`, `FRONT_FILLET_DEPTH_MM_ESTIMATE` | 1.8, 2.7 | The front edge is an elliptical fillet: 1.8 mm of the face (every front feature stays 2.0 mm clear of the outline), 2.7 mm down the wall. |
| `REAR_FILLET_MM_ESTIMATE` | 1.8 | Fillet between walls and back. |
| `REAR_SLOPE_BOTTOM_ESTIMATE` | 3.75 mm over 11.2 mm | The lower part of the back is a broad facet rising towards the front. |
| `REAR_SLOPE_TOP_ESTIMATE` | 1.5 mm over 12.3 mm | The same, gentler, at the top. |
| `BUTTON_PROUD_MM_ESTIMATE`, `DPAD_PROUD_MM_ESTIMATE` | 1.15, 1.45 | How far the controls stand proud. |
| `SIDE_FEATURES_ESTIMATE` | | Right wall: glossy window 12.7 x 9.0 mm at mid height. Left wall: 16-hole grille (5 + 6 + 5) and a 12.5 mm card slot near the front. Top wall: two rows of ten slots at 2.54 mm pitch. |
| `BACK_FEATURES_ESTIMATE` | | Blank debossed panel (the real device has the maker's logo there; it is deliberately not reproduced), pill with five contact pads (one silver towards +X, four gold), hex screw. |

Not modelled, because no reference shows them: the bottom wall (it is plain
here) and the inside of the lanyard passage (it is a straight hole from the
front face to the bottom facet of the back).

## How it is built

- `src/device3d/bodyMesh.ts`: the shell is a loft. The outline is sampled once
  into stations; rings run front cap edge, front fillet, wall, rear fillet,
  back edge. Flat regions (front face, the four walls, the facets of the back)
  are polygons with holes whose boundary is the neighbouring ring, so the mesh
  is watertight (unit-tested). Openings are real recesses. Normals are
  analytic. About 6,700 triangles for the shell, 13,300 for the whole model.
- UVs: one sheet laid out in millimetres (`src/device3d/atlas.ts`): front
  island, back island, four wall strips. No stretching, same scale everywhere.
- `src/device3d/parts.ts`: glass, lit picture, light guide, side window, pads,
  screw, the two round buttons (black body + coloured inlay), the D-pad (four
  arm meshes on one rocker).
- Front: geometry and materials only. `kode-dot.png` is not used as a texture
  in 3D (it stays the 2D view's picture).
- Materials: matte plastic `#ebe6dc` with a fine generated grain (normal map);
  black glass with a faint reflection; the lit picture is unlit and never
  tone-mapped, so it is exactly the app's sRGB pixels, dimmed by the backlight.
- Occlusion: baked. Recess walls and floors carry it in vertex colours; the
  contact shadows around the controls, the seams and the back cover's hairline
  are painted once into the UV sheet (`src/device3d/textures.ts`).
- Light: a small studio (key softbox upper right, fill left, front panel, top
  strip, two rim strips, a light floor bounce) rendered once into a prefiltered
  environment map (`src/device3d/studio.ts`). The glass and the side window
  mirror a second, darker version of the same studio, so the picture keeps its
  blacks. Neutral tone mapping.
  No shadow maps, no post-processing. A soft blob follows the footprint on the
  ground.

## How a model file is read

`src/device3d/prepare.ts` loads the file (Draco or meshopt geometry, WebP
textures) and `src/device3d/analyse.ts` finds the device in it. Names come
first; when a name is missing, shape and position decide, so a file that
knows nothing about this page still works:

| Part | By name | Otherwise |
| --- | --- | --- |
| Frame | | The tilt of the scene is removed, the outline is scaled to 46.65 x 77.0 mm and centred; the screen side becomes +Z, the edge nearer the screen +Y. |
| Screen | node `screen`, or a node, mesh or material name containing "screen", "display" or "lcd" | the largest flat surface on a big face. A part larger than the picture stays as the glass and the picture sits in its middle. |
| Round buttons | nodes `btn_top`, `btn_bottom`, or a name containing a control word ("button", "btn", "dpad", "key", "cross", "arrow") at the button's place | a part of the right size at the button's place. Two buttons in one mesh are cut apart. |
| D-pad | nodes `dpad_up`, `dpad_down`, `dpad_left`, `dpad_right` (four arms) or `dpad` (one rocker), or a name containing a control word at the D-pad's place | a part of the right size at the D-pad's place; one piece rocks towards the pressed arm. |
| LED | node `led`, or a name with "led" or "light guide" | a glowing part in the top right corner; with none, a small overlay is drawn there. |

A control that has no mesh of its own stays clickable through an invisible
target; it just does not move. What was matched how is listed under "Details"
next to the model's name in the menu.

"Lighter materials" (on by default for your own model) swaps clear coat,
transmission and the like for plain materials, joins static parts that share a
material and scales textures down to 1024 px.

### Making your own

Use the frame, units and origin given below. From Blender: model in
millimetres (or scale on export so that 1 glTF unit = 1 mm), device upright
with the screen facing -Y in Blender, export with "+Y up" ticked (the
default): Blender's -Y becomes glTF +Z. Name the nodes as in the table above
and nothing has to be guessed. Keep the pressable nodes directly under an
un-rotated parent (their parent's Z must be the model's Z), or they will not
move straight in.

## Rebuilding the bundled model

    cd web
    node scripts/optimise-model.mjs <Kode's original .glb>     # writes public/device/model.glb and NOTICE-model.md
    node scripts/model-shots.mjs --kode                          # shots (screenshots/model-kode-*.png) and checks
    npm run build && node scripts/og/make-og.mjs                 # the link-preview picture, with the new model

Numbers of the current file: 48,706 triangles (the original has 144,817),
416 kB (1005 kB), one 1024 px normal map and the pin labels as textures,
25 draw calls in the page.

## Screenshots and checks

    cd web
    node scripts/model-shots.mjs          # builds the model stand, writes screenshots/model-*.png, checks them
    node scripts/model-shots.mjs --kode   # the bundled Kode model (model-kode-*.png)
    node scripts/model-shots.mjs --custom <file.glb>   # a file loaded as a user would, through the model store
    node scripts/model-shots.mjs --glb    # the documented node names, on a synthetic GLB
    node scripts/model-shots.mjs --page   # the same through the real page (adds model-in-page.png)

The script builds into `/tmp/dotbench-model-dist` and serves on port 4391
(`MODEL_DIST`, `MODEL_PORT` to change); it never touches `web/dist`.
