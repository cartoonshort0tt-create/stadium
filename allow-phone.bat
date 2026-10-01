@echo off
rem Lets your phone (on the same Wi-Fi) open the game controller.
rem Opens the game's port in Windows Firewall and removes old "block" rules for Node.js.
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo Asking for administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "PORT=3000"
for /f %%P in ('powershell -NoProfile -Command "(Get-Content -Raw '%~dp0config.json' | ConvertFrom-Json).port"') do set "PORT=%%P"

echo.
echo   Removing old Node.js firewall rules (they may be blocking the phone)...
netsh advfirewall firewall delete rule name="Node.js JavaScript Runtime" >nul 2>&1
netsh advfirewall firewall delete rule name="node.exe" >nul 2>&1
netsh advfirewall firewall delete rule name="Messi vs Ronaldo" >nul 2>&1

echo   Allowing port %PORT% on all networks...
netsh advfirewall firewall add rule name="Messi vs Ronaldo" dir=in action=allow protocol=TCP localport=%PORT% profile=any >nul
for /f "delims=" %%N in ('where node 2^>nul') do (
  netsh advfirewall firewall add rule name="Messi vs Ronaldo" dir=in action=allow program="%%N" enable=yes profile=any >nul
)

echo.
echo   Done! Now restart start.bat and open on your phone:
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%B in ("%%A") do echo       http://%%B:%PORT%/control
echo   (use the 192.168.x.x one if there are several)
echo.
pause
