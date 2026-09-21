@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 or newer from https://nodejs.org/
  echo Then reopen this file. See docs/windows-guide.md for help.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24) process.exit(1)"
if errorlevel 1 (
  echo Dayloom needs Node.js 24 or newer. Please update Node.js.
  pause
  exit /b 1
)
set "DAYLOOM_MODE=local"
set "HOST=127.0.0.1"
set "PUBLIC_ORIGIN="
if not defined PORT set "PORT=8787"
echo Dayloom is starting. Keep this window open while using the app.
echo Open http://127.0.0.1:%PORT% in your browser.
node server.js
echo Dayloom has stopped.
pause
