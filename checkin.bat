@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo  Sentry Finance - Check in changes to Git
echo ============================================

rem ── Guard against a stale lock from a crashed/interrupted git process ──
if exist ".git\index.lock" (
  echo.
  echo WARNING: .git\index.lock already exists.
  echo This usually means a previous git command crashed, or a Git GUI
  echo tool ^(VS Code, GitHub Desktop, etc.^) still has the repo open.
  echo Close those first if you haven't already.
  echo.
  set /p CONFIRM="Delete the stale lock file and continue? (y/N): "
  if /i not "!CONFIRM!"=="y" (
    echo Aborting. Resolve the lock manually and re-run this script.
    exit /b 1
  )
  del ".git\index.lock"
)

echo.
echo --- git status ---
git status
echo.

git add -A

git diff --cached --quiet
if not errorlevel 1 (
  echo No staged changes to commit. Nothing to check in.
  exit /b 0
)

rem ── Commit message: pass one in as an argument, e.g. checkin.bat "fix bug"
rem     otherwise falls back to a timestamped default. ──
set "MSG=%~1"
if "%MSG%"=="" (
  set "MSG=Update %date% %time%"
)

git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo Commit failed. See errors above.
  exit /b 1
)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b

echo.
echo --- Syncing with origin/!BRANCH! ---
git fetch origin
git pull --rebase origin !BRANCH!
if errorlevel 1 (
  echo.
  echo Rebase hit a conflict or failed. Resolve it manually:
  echo   1. Fix the conflicting files
  echo   2. git add ^<file^>
  echo   3. git rebase --continue
  echo   4. Then run: git push origin !BRANCH!
  exit /b 1
)

git push origin !BRANCH!
if errorlevel 1 (
  echo.
  echo Push failed. See errors above.
  exit /b 1
)

echo.
echo Done - changes committed and pushed to origin/!BRANCH!.
endlocal
