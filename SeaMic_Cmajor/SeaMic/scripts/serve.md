# Serve the SeaMic web console locally

Cmajor WebAudio uses generated JavaScript modules, AudioWorklet, and WebAssembly. Browsers restrict these resources on `file://` pages, so serve `web/` over HTTP. For the options using port 8000, open `http://localhost:8000/`.

From the `SeaMic/` project root, use an available option:

## Python 3

Open a terminal in `web/` and run:

```powershell
python -m http.server 8000
```

## Node

From the `SeaMic/` project root:

```powershell
npx serve web
```

`npx` may ask to download `serve` if it is not already available.

## PHP

From the `SeaMic/` project root:

```powershell
php -S localhost:8000 -t web
```

## Included PowerShell alternative for this Windows workspace

Python 3, Node/npx, and PHP were not found in the original workspace environment. The available `python` command was only the Microsoft Store alias. A minimal static PowerShell server is included and requires no package installation:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\serve.ps1
```

The server listens only on the local interface and uses port 8001 to avoid the service already using port 8000 on this machine. Open `http://127.0.0.1:8001/`. Press `Ctrl+C` in the terminal to stop it. If port 8001 is occupied, use `-Port 8002`.
