// The compiler's own description of what a sketch can use (runtime/cc/boards.mjs, copied by scripts/prepare-cc.mjs).
declare module '*/generated/cc/boards.mjs' {
  interface Item {
    id: string;
    text: string;
  }
  export const BOARDS: Record<string, { partDir: string; family: string }>;
  export const SUPPORTED: Item[];
  export const UNSUPPORTED: Item[];
  export const FAMILY_NOTES: Record<string, Item[]>;
}
