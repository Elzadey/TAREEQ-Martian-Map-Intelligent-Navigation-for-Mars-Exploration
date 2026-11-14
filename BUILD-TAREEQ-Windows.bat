@echo off
setlocal
cd /d "%~dp0frontend"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 LTS is required. Install it, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules\react-scripts\scripts\build.js (
  echo Installing project dependencies. This can take several minutes...
  call npm ci
  if errorlevel 1 goto failed
)
echo [1/4] TypeScript check...
call npm run type-check
if errorlevel 1 goto failed
echo [2/4] Frontend tests...
call npm test -- --watchAll=false --runInBand
if errorlevel 1 goto failed
echo [3/4] Production build...
set "GENERATE_SOURCEMAP=false"
call npm run build
if errorlevel 1 goto failed
echo [4/4] Verifying built site and bundled DEM...
if not exist build\index.html goto failed
if not exist build\data\megt90n000cb.img goto failed
echo Build complete: frontend\build
pause
exit /b 0

:failed
echo Build failed. Read the error above and send it for help.
pause
exit /b 1
