@echo off
setlocal
cd /d "G:\sentryFi"

echo === Clearing stale git lock file ===
if exist ".git\index.lock" del /f /q ".git\index.lock"

echo.
echo === Staging the resolved conflict ===
git add src\components\finance\SpendingBudgetView.tsx

echo.
echo === Checking no other files are still conflicted ===
for /f %%f in ('git diff --name-only --diff-filter^=U') do (
  echo STILL CONFLICTED: %%f
  echo Resolve this before continuing - do not proceed.
  goto :end
)

echo.
echo === Completing the merge commit ===
git commit --no-edit
if errorlevel 1 (
  echo Commit failed - check the output above.
  goto :end
)

echo.
echo === Pushing to GitHub ===
git push origin main
if errorlevel 1 (
  echo Push failed - check the output above.
  goto :end
)

echo.
echo Done. The merge is complete and pushed. If your dev server still shows
echo the "Failed to fetch dynamically imported module" error, stop it
echo (Ctrl+C) and run "npm run dev" again - it was serving a file that had
echo raw git conflict markers in it, which is now fixed.

:end
echo.
pause
