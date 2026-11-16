# The Kode Dot 3D model (model.glb)

`model.glb` is the 3D model of the Kode Dot, made by Kode (KODE DIY SL), the
maker of the device. It comes from the model shown on Kode's web site and is
used here as the default device model, with Kode's word to its community that
material from its site may be used in community projects. The design, the
shapes, the colours and the mark on the back are Kode's.

`scripts/optimise-model.mjs` makes this file from Kode's original so that it
loads and draws quickly in a web page:

- placement: the model is in millimetres, centred, front towards +Z, top edge
  towards +Y;
- names: the parts are named `screen`, `btn_top`, `btn_bottom`, `dpad`,
  `led` (see MODEL.md); the two round buttons, one mesh in the original, are
  two;
- screen: the picture baked on the glass is replaced by a flat `screen`
  surface on which the simulator draws the live screen;
- geometry: 144817 triangles become 48706 (meshoptimizer); the back
  cover, the glass, the light guide, the button inlays and the side window keep
  every triangle, and the shell's edges round the glass and the controls stay
  in place;
- materials: plain metallic-roughness materials with Kode's colours; the
  shared colour palette becomes one material per colour;
- textures: the pin labels and the back cover's normal map, at 1024 px;
- compression: meshopt; 1005 kB become 416 kB.
