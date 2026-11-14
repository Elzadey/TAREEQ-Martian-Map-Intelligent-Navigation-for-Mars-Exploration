@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 LTS is required to serve the production build locally.
  pause
  exit /b 1
)
if not exist frontend\build\index.html (
  echo Production build is missing. Run BUILD-TAREEQ-Windows.bat first.
  pause
  exit /b 1
)
node serve-build.js
pause
