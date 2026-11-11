// Entrada para empaquetar el codificador de QR (node-qrcode, MIT, el mismo que usa QeepeR) para el navegador.
// `npm run vendor:qr` genera public/musa/vendor/qrcode.min.js, que deja globalThis.QRCodeLib = { create }.
const core = require("qrcode/lib/core/qrcode");
globalThis.QRCodeLib = { create: core.create };
