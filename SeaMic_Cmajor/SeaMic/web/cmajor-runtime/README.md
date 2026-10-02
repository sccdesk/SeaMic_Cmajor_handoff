# Runtime WebAudio de Cmajor

Esta instalación de Cmajor Tools 1.0.3209 no incluye un runtime genérico llamado `cmajor-performance-session.js` ni una clase global `PerformanceSession`. No copies ni crees archivos con esos nombres: no corresponden a la API comprobada de esta versión.

El flujo oficial comprobado genera un runtime específico para cada patch. Desde la raíz del proyecto:

```powershell
& "$env:LOCALAPPDATA\Programs\Cmajor\bin\cmaj.exe" generate --target=webaudio-html --output=web/generated/SeaMicLive SeaMicLive.cmajorpatch
```

Cmajor crea allí el módulo `cmaj_SeaMicLive.js`, los helpers requeridos en `cmaj_api/` y una página de ejemplo. La página SeaMic carga el módulo generado y sus helpers desde `web/generated/SeaMicLive/`. La salida compilada lleva el código WebAssembly del patch; esta versión no requiere copiar manualmente un `cmajor-performance-session.wasm` independiente.

No edites ni reemplaces manualmente los archivos dentro de `web/generated/`: vuelve a generar la salida con la herramienta Cmajor cuando cambie el patch. Este directorio contiene únicamente esta guía.

## Herramienta de generación

- En este equipo, el CLI verificado está en `%LOCALAPPDATA%\Programs\Cmajor\bin\cmaj.exe`.
- La extensión Cmajor Tools de VS Code suele estar bajo `%USERPROFILE%\.vscode\extensions\cmajorsoftware.cmajor-tools-<versión>-win32-x64\`, pero no se confirmó que distribuya allí un runtime WebAudio genérico para copiar.
- En macOS y Linux no se confirmó una ruta de runtime copiable. Busca la extensión `cmajorsoftware.cmajor-tools-*` y el ejecutable `cmaj` en la instalación local; usa su comando `generate --target=webaudio-html`.

Los módulos ES y los recursos que genera Cmajor deben servirse por HTTP local. Consulta [../README.md](../README.md) y [../../scripts/serve.md](../../scripts/serve.md).
