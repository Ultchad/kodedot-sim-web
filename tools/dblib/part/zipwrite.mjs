// SPDX-License-Identifier: GPL-3.0-or-later
// The Node ZIP writer: zipcore.mjs with node:zlib (deflate level 9, so the bytes are what they have always been).
import { deflateRawSync, crc32 } from "node:zlib";
import { writeZipWith } from "./zipcore.mjs";
/** @param {[string, Uint8Array][]} files @returns {Uint8Array} */
export const writeZip = (files) => writeZipWith(files, { deflate: (b) => deflateRawSync(b, { level: 9 }), crc32 });
