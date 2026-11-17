/** The Bench3D kit: import everything a model needs from here. See README.md. */
export { Shape, FAMILIES, convexHull, tubeIndices, writeTube, type Family, type Finish, type SolidOptions } from './shape';
export { PAL, INK, familyMaterial } from './materials';
export { print, topQuad, frontQuad, movedQuad, quadGeometry, onPrintsRedrawn, rr, text, waves, powerSign, bolt, pinLabels, silkBox, FONT, FONT_HEAD, FONT_MONO, type Quad, type PrintDef } from './print';
export { lamp, flatLamp, halo, glowing, setLamp, screen, drawScreen, part, instantiate, disposeInstance, countTriangles, isStatic } from './nodes';
export {
  defineModel, budgetFor, inspectModel, makeCtx, footprintOf, overhangOf, fromManifestMm, toManifestMm, terminalsFromManifest, partState,
  type PartModel, type Terminal, type BuildCtx, type AnimEnv, type ModelReport, type PartState, type ManifestBody, type ManifestPin, type ManifestFace, type Overhang,
} from './contract';
export * from './parts';
export { markControl, hitPad, controlOf, controlsIn, controlFromManifest, nextValue, turnDeg, turnValueAt, type Control, type ControlMark, type ControlMode, type ControlManifest } from './controls';
export { circleLoop, roundedRectLoop, roundPolygon, type Pt } from '../lib/bodyModel';
export type { V2, V3 } from '../device3d/meshBuilder';
export { Matrix4, Group, type Object3D } from 'three';
