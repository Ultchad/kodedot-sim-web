/**
 * The file extension of an app package (the zip the build tool makes from a kode-sdk app folder), with its dot.
 * Texts that name the file take it from here, so they follow when the extension changes.
 */
export const APP_PACKAGE_EXT = '.zip';

/** Names the page takes as an app package: the zip, and the name older builds of the tool gave it. */
export const APP_PACKAGE_RE = /\.(zip|dotbench)$/i;
