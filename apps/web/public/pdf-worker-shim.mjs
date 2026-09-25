// Polyfills Map.prototype.getOrInsertComputed/getOrInsert (the TC39
// "Upsert" proposal) inside the pdfjs-dist worker's own realm, then
// loads the real worker — lib/scanning/load-pdf-file.ts points
// GlobalWorkerOptions.workerSrc at this file instead of the vendored
// worker directly, since a module Worker has its own separate global
// Map, untouched by lib/scanning/map-upsert-polyfill.ts's main-thread
// patch. See that file's doc comment for the full explanation of why
// this is needed at all; keep both in sync if either changes.
if (!Map.prototype.getOrInsertComputed) {
  Map.prototype.getOrInsertComputed = function (key, callback) {
    if (!this.has(key)) this.set(key, callback(key));
    return this.get(key);
  };
}
if (!Map.prototype.getOrInsert) {
  Map.prototype.getOrInsert = function (key, value) {
    if (!this.has(key)) this.set(key, value);
    return this.get(key);
  };
}

import('/vendor/pdfjs/pdf.worker.min.mjs');
