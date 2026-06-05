@echo off
REM Run this file as Administrator to install Caddy + Helper as startup tasks.
REM Right-click -> "Run as administrator"

echo Installing Homeslice startup tasks...
echo.

REM --- Helper server (no admin needed) ---
schtasks /Create /SC ONLOGON /TN "Homeslice Helper" /TR "'C:\Program Files\nodejs\node.exe' 'C:\Apps\Homeslice\open-dir-server.mjs'" /RL LIMITED /F
echo.

REM --- Caddy reverse proxy (needs admin for port 80) ---
schtasks /Create /SC ONLOGON /TN "Homeslice Caddy" /TR "'C:\Apps\caddy\caddy.exe' run --config 'C:\Apps\caddy\Caddyfile'" /RL HIGHEST /F
echo.

echo Done. Both tasks will run at every logon.
echo.
echo To start them now without rebooting, run:
echo   schtasks /Run /TN "Homeslice Helper"
echo   schtasks /Run /TN "Homeslice Caddy"
pause
