/**
 * Every model in `models/**` is found here by its file name (`*.model.ts`): adding a part is adding a file.
 */
import type { PartModel } from './contract';

const files = import.meta.glob<{ default: PartModel }>('./models/**/*.model.ts', { eager: true });

const byId = new Map<string, PartModel>();
const sources = new Map<string, string>();
for (const [path, mod] of Object.entries(files)) {
  const m = mod.default;
  if (!m || typeof m.id !== 'string' || typeof m.build !== 'function') throw new Error(`${path}: the default export must be defineModel({...})`);
  if (byId.has(m.id)) throw new Error(`${path}: model id "${m.id}" is already used by ${sources.get(m.id)}`);
  byId.set(m.id, m);
  sources.set(m.id, path);
}

export const MODELS: ReadonlyMap<string, PartModel> = byId;
export const getModel = (id: string): PartModel | undefined => byId.get(id);
/** The file a model comes from, relative to this folder (for messages). */
export const modelSource = (id: string): string | undefined => sources.get(id);
