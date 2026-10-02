# Rebuild the academic report: assemble HTML parts -> print PDF.
# NOTE: uses installed Google Chrome. Headless Edge on this machine exits 0 without
# writing a PDF, so Chrome is the reliable renderer (see report/README note).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$parts = Get-ChildItem "$PSScriptRoot\p*.html" | Sort-Object Name
# Assemble with Node (strict UTF-8): PowerShell 5.1 Get-Content would read the BOM-less
# UTF-8 parts as ANSI and double-encode accents/em dashes into mojibake.
node "$PSScriptRoot\assemble.js"
if ($LASTEXITCODE -ne 0) { throw "assemble.js failed" }
"HTML assembled: SeaTime_DSP_Report.html  (parts: " + (($parts.Name) -join ", ") + ")"

if (-not (Test-Path "$PSScriptRoot\node_modules\puppeteer-core")) {
    & npm.cmd install puppeteer-core --no-fund --no-audit
}
node "$PSScriptRoot\topdf.js"

$f = Get-Item "$PSScriptRoot\SeaTime_DSP_Report.pdf"
"PDF: $($f.FullName)  ($([math]::Round($f.Length/1KB)) KB)"
