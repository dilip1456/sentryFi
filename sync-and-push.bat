@echo off
setlocal
cd /d "G:\sentryFi"

echo === Clearing stale git lock files ===
if exist ".git\index.lock" del /f /q ".git\index.lock"

echo.
echo === Fetching latest from GitHub ===
git fetch origin
if errorlevel 1 (
  echo Fetch failed - check the output above.
  goto :end
)

echo.
echo === Merging origin/main into your local main ===
echo (Your local repo was behind - a "Tester" branch/PR was merged on GitHub
echo  on 2026-10-20 that your local clone never pulled down.)
git merge origin/main -m "Merge origin/main (PR #25 My Money A work) before pushing local fixes"
if errorlevel 1 (
  echo.
  echo === MERGE CONFLICT ===
  echo Git could not auto-merge. Run "git status" to see which files conflict,
  echo open them, resolve the ^<^<^<^<^<^<^< / ======= / ^>^>^>^>^>^>^> markers by hand,
  echo then run:
  echo   git add ^<resolved files^>
  echo   git commit
  echo   git push origin main
  echo Do NOT push until the conflict is resolved. Come back and tell me what
  echo the conflicting file^(s^) show if you want help picking the right resolution.
  goto :end
)

echo.
echo === Merge clean. Pushing to GitHub ===
git push origin main
if errorlevel 1 (
  echo Push failed - check the output above.
  goto :end
)

echo.
echo Done. Local fixes (Obligate tab removal, "+ budget" button removal) are
echo now merged with the Tester's PR #25 work and pushed to main.

:end
echo.
pause
