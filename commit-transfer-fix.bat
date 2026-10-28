@echo off
setlocal
cd /d "G:\sentryFi"

echo === Clearing stale git lock files ===
if exist ".git\index.lock" del /f /q ".git\index.lock"
if exist "sentryfi-history-scrubbed\.git\index.lock" del /f /q "sentryfi-history-scrubbed\.git\index.lock"

echo.
echo === Committing the internal-transfer detection fix ===
git add src\components\finance\LivePlaidDashboard.tsx supabase\functions\analyze-finances\index.ts
git commit -m "fix: require both legs transfer-flavored + unique match for internal-transfer detection"
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
echo Done. Once this reaches GitHub, Vercel will rebuild the web app and
echo the Android workflow will build a new APK with the fix included.

:end
echo.
pause
