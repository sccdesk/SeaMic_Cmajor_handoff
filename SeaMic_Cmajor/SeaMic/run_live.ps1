# SeaMic live mic MVP — wear HEADPHONES (chain output goes to speakers).
param([int]$Rate = 16000, [int]$Inputs = 1, [int]$Outputs = 1, [int]$Block = 256, [switch]$NoRate)
$cmaj = "$PSScriptRoot\..\tools\cmaj.exe"
$args = @("play", "$PSScriptRoot\SeaMicDSPChain.cmajorpatch",
  "--inputs=$Inputs", "--outputs=$Outputs", "--block-size=$Block")
if (-not $NoRate) { $args += "--rate=$Rate" }
Write-Host "CMD: $cmaj $($args -join ' ')"
& $cmaj @args
# If the device rejects --rate, re-run: .\run_live.ps1 -NoRate
# (chain is fs-agnostic: windows/coeffs derive from processor.frequency).
