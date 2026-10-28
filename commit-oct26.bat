@echo off
setlocal
cd /d "G:\sentryFi"

echo === Clearing stale git lock files ===
if exist ".git\index.lock" del /f /q ".git\index.lock"

echo.
echo === Committing: Obligate tab removal + category "+ budget" button removal ===
git add src\components\finance\LivePlaidDashboard.tsx src\components\finance\SpendingBudgetView.tsx
git commit -m "remove Obligate tab from txn detail modal; remove per-category + budget quick-add button"
if errorlevel 1 (
  echo Nothing to commit, or commit failed - check the output above.
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
echo Done.

:end
echo.
pause
