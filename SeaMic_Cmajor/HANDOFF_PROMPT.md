# PROMPT DE CONTINUACIÓN — SeaMic / SeaTime DSP (handoff desde ZIP)

> **Cómo usar este archivo:** descomprime el ZIP, abre la carpeta en tu editor, y pega
> **todo el contenido de este archivo** (desde la línea siguiente) en tu asistente de
> coding, añadiendo al final la tarea concreta que quieras atacar. El archivo es
> autocontenido: no necesita acceso a la máquina de origen.

---

Actúa como ingeniero senior de DSP y audio en tiempo real, a cargo del proyecto descrito.
Idioma de trabajo: español. Estilo: incremental, medido, con verificación ejecutable antes
de afirmar cualquier resultado. No cambies parámetros acústicos sin justificación ni
regresión medida.

## 1. Qué es el proyecto

**SeaMic** (producto final: **SeaTime**) es una cadena de procesamiento de micrófono en
tiempo real que sustituye dos controles manuales del usuario (ganancia de micrófono y umbral
de activación) por un pipeline adaptativo:

```
input → DC-block (2× one-pole, τ=0.05 s) → K-weighting (BS.1770, re-maleada a 16 kHz)
      → VADv2 (puro: produce gate 0/1, con histéresis + hold)
      → AGC (freeze-on-speech, objetivo −19 dBFS) → soft-gate (−10 dB) → limiter (look-ahead 4 ms, techo −1 dBFS)
      → output → Opus a 16 kHz mono (fuera de este repositorio)
```

Está implementado en **Cmajor** (lenguaje de DSP compilado a C++/VST). El repositorio
contiene la cadena prototipo, una batería de *probes* mono-bloque, tres bancos de
depuración, herramientas de medida en .NET 8 y un informe académico en PDF.

**Objetivo de producto:** que un periodista con micrófono de solapa, lejos y hablando bajo,
no toque nada; que el ruido de fondo se corte en las pausas para que Opus/DTX ahorre
banda; y que no se pierdan sílabas iniciales ni finales.

## 2. Estado verificado al cerrar el ZIP (2026-09-29)

| Hito | Estado |
|---|---|
| `chain1`–`chain4`, `chain6`–`chain13` (probes), `SeaMic`, `SeaMicLive` | compilan (0 errores / 0 avisos) |
| Validación offline en 16 kHz (7 s de estímulo sintético) | **R1–R5 cumplidas** |
| MVP en vivo por WASAPI con hardware real (ZOOM F Series) | **funcionando a 16 kHz** |
| Informe académico PDF (22 páginas, A4) | generado y corregido (UTF-8) |
| Test subjetivo con auriculares (M5) | **pendiente** ← siguiente paso |
| Integración Opus/DTX y port al motor C++ de SeaTime | **pendiente** |

Números de referencia (bloque final, `SeaMic/analysis_final.txt`, generado con `anwav2`):

| Métrica | Valor | Criterio |
|---|---|---|
| Muestras > 0 dBFS | 0 | R4 |
| Pico verdadero | 0,936 | ≤ 1,0 |
| Habla fuerte (10 % duty, seg2) | −14,0…−15,3 dBFS | objetivo −19 → **queda 4–5 dB corta** |
| Habla floja (20 % duty, seg4) | pasa con +0,4 dB de margen de arranque | R5 |
| Silencio (seg6) | gated a −110 dB | R3 |
| Fuga post-habla | ≤ 1,0 s (hold de 1000 ms) | aceptado como coste |

**Trade-off abierto:** el techo real de ganancia lo fija el limiter (−1 dBFS), no el objetivo
de loudness → el habla fuerte termina en −15…−16 dBFS en vez de −19 dBFS. La otra opción
(sube el gain previo al limiter) recorta picos de sílabas. **Decisión de producto pendiente.**

## 3. Invariantes (no tocar sin una razón medida)

- **16 kHz** fijos: Opus wideband es suficiente y el usuario lo decidió así; las
  coefficientes K-weighting están **re-maleadas a 16 kHz**, no son las de 48 kHz de la
  librería `cMajorDSP` (ver `SeaMic/LITERATURE_NOTES.md`).
- El **VAD entrega gate puro 0/1**; la atenuación del gate vive en `chain3`
  (`mix(gate, gate×0.3162, …)`). En `chain4` esa atenuación se aplica **dos veces**: es
  intencional y está documentada (mantener silencio es más crítico que el valor exacto).
- Rampa de gate **128 muestras** = 8 ms: es *sample-accurate*, **no** `Smooth`.
- Salida de `Block` = 0/1: la entrada de una unidad booleana se interpreta como bloque de
  audio de una muestra (`min` colapsaría a 0).
- `Render` + `anwav2` son el banco de medida determinista; el banco *live* **debe**
  desactivar `mic.gain` con `if false` o enmascararía todo.

## 4. Mapa del repositorio

```
SeaMic/
  chain1_dc_k_weighting.cmajor   bloque 1 de la cadena
  chain2_vad.cmajor              VADv2 (puro)
  chain3_agc.cmajor              AGC + soft-gate
  chain4_limiter.cmajor          limiter + cadena completa
  chain6..chain13_*.cmajor       probes mono-bloque usados en la biseción (M4)
  SeaMic.cmajorpatch             debug (outs) — da error de carga en algunos dispositivos
  SeaMicLive.cmajorpatch         MVP para auriculares / WASAPI  <- usa éste
  stimulus16k.wav                estímulo de 7 s: silence/roar/strong/floor/weak/silence
  render_final.wav analysis_final.txt   evidencia citada por el informe
  mkstim/ anwav2/ dumpwav/ vadprobe/    utilidades .NET 8 (generador, analizador RMS/peak,
                                        volcado de muestras, probe de VAD por beep 440 Hz)
  BUGFIXES.md                    erratas de sintaxis Cmajor encontradas (M1)
  VAD_DEBUG.md                   análisis de causa raíz + tabla FINAL STATUS
  MIC_TEST.md                    protocolo de escucha con auriculares
  LITERATURE_NOTES.md            notas de literatura (VAD estadístico, mu-law, Kelly-Walker,
                                 hangover, bs1770gain, WebRTC VAD)
report/
  p01.html ... p16.html          fuente del informe (UTF-8, editar éstos)
  assemble.js                    ensamblado UTF-8 estricto  <- NUNCA usar Get-Content
  run_pdf.ps1                    HTML -> PDF con Chrome + puppeteer-core
  topdf.js / qa_shots.js         impresión y capturas de control visual
  SeaTime_DSP_Report.pdf         informe (22 págs.: arquitectura, literatura, decisiones,
                                 registro de 8 errores, validación)
README_SESION.md                 estado de sesión y comandos (en turco)
```

## 5. Entorno en una máquina nueva

1. **VSCode + extensión "Cmajor Tools"** (`cmajorsoftware.cmajor-tools`, v1.0.3209 o
   posterior). Copia el CLI al repositorio:
   - Windows: `%USERPROFILE%\.vscode\extensions\cmajorsoftware.cmajor-tools-<ver>-win32-x64\bin\cmaj.exe` -> `tools\cmaj.exe`
   - Linux/macOS: binario equivalente en la carpeta de extensiones -> `tools/cmaj`
   - Alternativa: compila el CLI desde el repositorio `cmajor/cMajorTools`.
2. **.NET SDK 8** (`dotnet --version` >= 8.0) para `mkstim`, `anwav2`, `dumpwav`, `vadprobe`.
3. **Node >= 18** sólo para el informe: `cd report && npm i puppeteer-core`.
4. **Chrome/Chromium** instalado (impresión del informe).
5. **Windows** para la fase live (WASAPI). En Linux/macOS la validación offline y el informe
   siguen funcionando; para pruebas en vivo usa el VST o `cmaj play` con ALSA/CoreAudio.

El ZIP **no** incluye `tools/cmaj.exe` (65 MB), `node_modules/`, `bin/`, `obj/` ni los
`render_*.wav` intermedios: se regeneran.

## 6. Verificación en 5 minutos (debe reproducir los números de la tabla §2)

```powershell
cd SeaMic
dotnet run --project mkstim              # regenera stimulus16k.wav
..\tools\cmaj.exe render SeaMic.cmajorpatch --rate=16000 --blockSize=128 `
    --input=stimulus16k.wav --output=render_final.wav
dotnet run --project anwav2 -- render_final.wav analysis_final.txt
```

Esperado: 0 muestras > 0 dBFS; pico 0,936; seg0 negro (calentamiento del motor de render:
**ignóralo**, no es un bug de la cadena); silencio gated a -110 dB; sin avisos del
compilador. Banco de depuración: `chain1/2/3` dan el mismo RMS por bloque y `chain4` lo
divide por 10 (`gate^2`). Si algo no coincide, **no sigas adelante**: reproduce y depura.

## 7. Trampas ya pagadas (no las vuelvas a pagar)

**Cmajor (v1.0.3209):** `in` es palabra reservada -> usa `in0`; `pow` devuelve void -> usa
`x*x`; `max`/`min` son **binarios**; `&&` y `||` no compilan -> `min(a,b) > 0.5`; no se puede
indexar un array con variable -> declara `var x[9]` y usa nombres explícitos; las
declaraciones dentro de `if` tienen su propio bloque (declara en el bloque padre); un
parámetro con default de expresión no funciona; `if` sin `else` seguido de asignación se
comporta mal -> usa ternario; el `var` de `Block` vive una línea; una salida bool de `Block`
se interpreta como señal de una muestra (un `min` posterior colapsa a 0).

**Banco de medida:** `anwav` usaba `BitConverter.DoubleToInt64Bits` sobre `float[]` (salida
basura) -> `anwav2` usa `ReadSingle`/`SingleToUInt32Bits`. No asumas 16/24 bits: comprueba
`fmt` y la extensión `KSDATAFORMAT_SUBTYPE_IEEE_FLOAT` (WASAPI entrega float32 `EXTENSIBLE`).

**Loudness:** mide por segmento con tu analizador RMS antes de culpar a la cadena (error M3:
el pico del banco *live* lo provocaba `mic.gain` activo, no el limiter).

**Informe/PDF:** PowerShell 5.1 lee UTF-8 sin BOM como ANSI y corrompe acentos y rayas
(«—» -> «â€”»). Ensambla siempre con `node report/assemble.js` y exige
`mojibakeMarkers: []`. Edge headless no imprime PDF en este equipo: usa Chrome +
`puppeteer-core`.

## 8. Tareas pendientes (orden recomendado)

- **P0 — Escucha subjetiva (M5):** aplica `SeaMic/MIC_TEST.md` con auriculares sobre
  `SeaMicLive.cmajorpatch`. Registra: sílabas iniciales recortadas, respiraciones audibles,
  «bombeo» del AGC, finales de frase cortados. Escribe resultados en `MIC_TEST.md`.
- **P1 — Decisión de loudness:** -19 dBFS con picos recortados vs -15 dBFS sin recorte.
  Opciones: (a) dejar el limiter y documentar -15; (b) +4 dB de gain previo aceptando recorte
  controlado; (c) bajar el techo del limiter a -3 dBFS. Mide las tres con `anwav2` y decide.
- **P2 — Fuga post-habla de ~1 s:** acorta `hold` o implementa *adaptive hangover* (idea M8:
  VAD primario = mínimo de la ventana K, con histéresis mucho más corta cuando la derivada es
  negativa). Meta: fuga <= 300 ms sin violar R2 (cohesión de frase).
- **P3 — Integración SeaTime:** port del grafo al motor C++/JUCE del producto, Opus DTX/CELT,
  control real de `mic.gain`, prueba con micrófonos de solapa y USB a 16 kHz.
- **P4 — Higiene:** CI que compile todos los `*.cmajorpatch`, corra el banco offline y compare
  contra `analysis_final.txt`; borrar probes obsoletos; alinear cifras del informe con la
  última corrida.

## 9. Reglas de trabajo

1. Todo cambio acústico: banco offline -> actualizar `analysis_final.txt` **y** la sección 7
   del informe en el mismo commit.
2. Un commit por fase, con problema y resultado en el mensaje.
3. Cada error nuevo se documenta en `SeaMic/BUGFIXES.md` y, si es de diseño, en la sección 6
   del informe: causa raíz -> señal que lo delató -> corrección -> salvaguardia.
4. El PDF sólo se regenera con `report/run_pdf.ps1`; el control visual es
   `node report/qa_shots.js`.
5. Ninguna afirmación sin comando y salida: «suena bien» no es evidencia.

## 10. Preguntas abiertas para el usuario

1. ¿Se confirma -19 dBFS como objetivo de entrega o se aceptan -15 dBFS sin recorte?
2. ¿El motor del producto ya aplica DTX / comfort noise? Determina cuánto debe atenuar el gate.
3. ¿Hay que soportar algún muestreo distinto de 16 kHz (p. ej. 48 kHz nativo del driver)?
4. El port a SeaTime, ¿conserva las unidades Cmajor (VST) o se reescribe en el DSP interno?

**Primer paso:** confirma que el repo compila y que el banco offline reproduce la tabla §2 en
esta máquina; luego propón el plan de la tarea que te pida y espera mi aprobación antes de
tocar parámetros acústicos.

