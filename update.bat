@echo off
setlocal
cd /d "%~dp0"
rem Downloads the latest version of the game and copies it over this folder.
rem Your scores and wins (the data folder) are kept.
set "UPD_URL=https://github.com/cartoonshort0tt-create/stadium/archive/refs/heads/claude/affectionate-ride-1cpqa5.zip"
set "UPD_ZIP=%TEMP%\stadium-update.zip"
set "UPD_DIR=%TEMP%\stadium-update"

echo.
echo   Downloading the latest version...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -UseBasicParsing $env:UPD_URL -OutFile $env:UPD_ZIP; if (Test-Path $env:UPD_DIR) { Remove-Item $env:UPD_DIR -Recurse -Force }; Expand-Archive $env:UPD_ZIP $env:UPD_DIR -Force"
if errorlevel 1 goto fail

set "UPD_SRC="
for /d %%D in ("%UPD_DIR%\*") do set "UPD_SRC=%%D"
if not defined UPD_SRC goto fail

robocopy "%UPD_SRC%" "%~dp0." /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto fail

rmdir /s /q "%UPD_DIR%" 2>nul
del "%UPD_ZIP%" 2>nul
echo.
echo   Updated! Your scores and wins were kept.
echo   Now double-click start.bat, then press Ctrl+F5 in the browser.
echo.
pause
exit /b 0

:fail
echo.
echo   Update FAILED. Check your internet connection and try again.
echo.
pause
exit /b 1
