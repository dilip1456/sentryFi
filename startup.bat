@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo  Sentry Finance - Starting local dev server
echo ============================================

if not exist "node_modules" (
  echo node_modules not found - running npm install first...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. See errors above.
    pause
    exit /b 1
  )
)

echo.
echo Starting Vite dev server on http://localhost:8080
echo (this window IS the server - press Ctrl+C here to stop it)
echo.

rem Opens the browser tab; doesn't spawn any extra console window. The dev
rem server may take a second or two to come up, so the first load might need
rem one manual refresh.
start "" "http://localhost:8080"

call npm run dev

endlocal
