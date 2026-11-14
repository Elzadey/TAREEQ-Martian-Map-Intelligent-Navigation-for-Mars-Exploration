@echo off
setlocal
cd /d "%~dp0frontend"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22 LTS, then run this file again.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js 22 LTS with npm enabled.
  pause
  exit /b 1
)
if not exist package.json (
  echo Could not find frontend\package.json. Extract the complete project ZIP first.
  pause
  exit /b 1
)
if not exist node_modules\react-scripts\scripts\start.js (
  echo Installing project dependencies. This can take several minutes...
  call npm ci
  if errorlevel 1 goto failed
)
echo Starting TAREEQ. Keep this window open while using the site.
call npm start
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" pause
exit /b %RESULT%

:failed
echo Dependency installation failed. Check your internet connection and available disk space.
pause
exit /b 1
