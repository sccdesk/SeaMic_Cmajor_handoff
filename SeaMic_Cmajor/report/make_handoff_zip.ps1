<#
    make_handoff_zip.ps1 — empaqueta el proyecto para continuarlo en otra máquina.

    Incluye todo lo versionado (fuentes Cmajor, tools .NET, docs, informe PDF) +
    HANDOFF_PROMPT.md + las capturas de control visual. Excluye deliberadamente
    tools/cmaj.exe (65 MB, pertenece a la extensión VSCode), node_modules/ y bin/obj/,
    porque se regeneran y harían el paquete enviado por correo inasumible.

    Uso:  powershell -ExecutionPolicy Bypass -File report\make_handoff_zip.ps1
#>
$ErrorActionPreference = 'Stop'
$src   = Split-Path $PSScriptRoot -Parent                  # raiz del repositorio
$stage = Join-Path $env:TEMP 'SeaMic_handoff_stage\SeaMic_Cmajor'
$zip   = Join-Path (Split-Path $src -Parent) 'SeaMic_Cmajor_handoff.zip'

if (Test-Path (Split-Path $stage -Parent)) { Remove-Item (Split-Path $stage -Parent) -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Set-Location $src

# 1) todo lo versionado: fuentes, parches, herramientas .NET, documentacion e informe PDF
foreach ($f in (git ls-files)) {
    $d = Join-Path $stage $f
    New-Item -ItemType Directory -Force -Path (Split-Path $d) | Out-Null
    Copy-Item -LiteralPath $f -Destination $d -Force
}

# 2) prompt de continuacion (puede estar sin commitear) + capturas de control visual
if (Test-Path 'HANDOFF_PROMPT.md') { Copy-Item HANDOFF_PROMPT.md $stage -Force }
$qa = Join-Path $stage 'report\qa'
New-Item -ItemType Directory -Force -Path $qa | Out-Null
if (Get-ChildItem 'report\qa_*.png' -ErrorAction SilentlyContinue) {
    Copy-Item report\qa_*.png $qa -Force
}

# 3) manifiesto para quien recibe el correo
$sha = (git rev-parse --short HEAD).Trim()
$m = @()
$m += 'SeaMic / SeaTime DSP - paquete de continuacion'
$m += 'empaquetado ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + ' | git commit ' + $sha
$m += 'empezar por: HANDOFF_PROMPT.md'
$m += 'excluido a proposito: tools/cmaj.exe (65 MB, viene de la extension VSCode Cmajor Tools),'
$m += '                   node_modules/, bin/obj/, render_*.wav intermedios  (todo se regenera)'
$m += ''
$m += 'contenido:'
$m += (git ls-files | Sort-Object)
$m | Out-File (Join-Path $stage 'MANIFEST.txt') -Encoding utf8

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal

Get-Item $zip | Select-Object FullName, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 2) } } |
    Format-List | Out-String -Width 120

Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($zip)
'entradas: ' + $z.Entries.Count
$z.Entries | Where-Object { $_.FullName -notmatch '/$' } |
    Select-Object -First 10 -ExpandProperty FullName
$z.Dispose()
