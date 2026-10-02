param(
    [int] $Port = 8001
)

$ErrorActionPreference = "Stop"
$webRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\web"))
$rootPrefix = $webRoot.TrimEnd("\") + "\"
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$contentTypes = @{
    ".css"  = "text/css; charset=utf-8"
    ".html" = "text/html; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".mjs"  = "text/javascript; charset=utf-8"
    ".svg"  = "image/svg+xml"
    ".wasm" = "application/wasm"
}

function Send-Response {
    param(
        [System.IO.Stream] $Stream,
        [int] $StatusCode,
        [string] $StatusText,
        [string] $ContentType,
        [byte[]] $Body,
        [bool] $SendBody
    )

    $headers = "HTTP/1.1 $StatusCode $StatusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)

    if ($SendBody -and $Body.Length -gt 0) {
        $Stream.Write($Body, 0, $Body.Length)
    }
}

try {
    $listener.Start()
    Write-Output "Sirviendo $webRoot en http://127.0.0.1:$Port/"
    Write-Output "Pulsa Ctrl+C para detener el servidor."

    while ($true) {
        $client = $listener.AcceptTcpClient()

        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new(
                $stream,
                [System.Text.Encoding]::ASCII,
                $false,
                1024,
                $true
            )
            $requestLine = $reader.ReadLine()
            while (-not [string]::IsNullOrEmpty($reader.ReadLine())) { }

            if ($requestLine -notmatch '^(GET|HEAD)\s+(\S+)\s+HTTP/\d\.\d$') {
                Send-Response $stream 405 "Method Not Allowed" "text/plain; charset=utf-8" ([byte[]]@()) $true
                continue
            }

            $method = $Matches[1]
            $requestPath = $Matches[2].Split("?")[0]
            $relativePath = [Uri]::UnescapeDataString($requestPath.TrimStart("/")).Replace("/", "\")
            if ([string]::IsNullOrWhiteSpace($relativePath)) {
                $relativePath = "index.html"
            }

            $filePath = [System.IO.Path]::GetFullPath((Join-Path $webRoot $relativePath))
            if (-not $filePath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                Send-Response $stream 403 "Forbidden" "text/plain; charset=utf-8" ([byte[]]@()) $true
                continue
            }

            if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
                Send-Response $stream 404 "Not Found" "text/plain; charset=utf-8" ([byte[]]@()) $true
                continue
            }

            $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
            $contentType = "application/octet-stream"
            if ($contentTypes.ContainsKey($extension)) {
                $contentType = $contentTypes[$extension]
            }

            $body = [System.IO.File]::ReadAllBytes($filePath)
            Send-Response $stream 200 "OK" $contentType $body ($method -eq "GET")
        } catch {
            Write-Warning $_.Exception.Message
        } finally {
            if ($reader) {
                $reader.Dispose()
            }
            if ($client) {
                $client.Close()
            }
        }
    }
} finally {
    $listener.Stop()
}
