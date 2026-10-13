// Alias para "@jitl/quickjs-ng-wasmfile-release-sync/wasm" (ver [alias] en
// wrangler.toml). El export map del paquete resuelve ese subpath a un .wasm
// con specifier SIN extensión, y wrangler 4.65 no le aplica la regla
// CompiledWasm ("No loader is configured for .wasm files"). Este stub
// reexporta el archivo con un import relativo "*.wasm" para que la regla lo
// convierta en el WebAssembly.Module precompilado que quickjs-emscripten
// espera en newVariant(variantBase, { wasmModule }).
//
// Si se actualiza @jitl/quickjs-ng-wasmfile-release-sync, verificar que la
// ruta y el binario sigan vigentes.
import wasmModule from "../../node_modules/@jitl/quickjs-ng-wasmfile-release-sync/dist/emscripten-module.wasm";

export default wasmModule;
