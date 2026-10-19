@echo off
setlocal

echo ============================================================
echo  SentryFi history scrub - finalize
echo  This pushes the cleaned git history to GitHub, then helps
echo  you swap in a fresh working copy. Read each pause carefully.
echo ============================================================
echo.
pause

echo.
echo === Step 1: Push scrubbed history to GitHub (force) ===
cd /d "G:\sentryFi\sentryfi-history-scrubbed"
if errorlevel 1 (
  echo ERROR: could not find G:\sentryFi\sentryfi-history-scrubbed
  goto :end
)
git push --force --all origin
if errorlevel 1 (
  echo ERROR: push --all failed. Stopping here, nothing else will run.
  goto :end
)
git push --force --tags origin
if errorlevel 1 (
  echo ERROR: push --tags failed. Stopping here.
  goto :end
)
echo Push succeeded.
echo.
pause

echo.
echo === Step 2: Delete the old unscrubbed clone ===
cd /d "G:\sentryFi"
rmdir /s /q "sentryFi-scrub"
echo Done.
echo.
pause

echo.
echo === Step 3: Check your main working folder for pending changes ===
cd /d "G:\sentryFi"
git status
echo.
echo Look at the output above. If there is real uncommitted work you
echo need to keep, STOP NOW and copy it out before continuing.
echo.
set /p CONTINUE="Type YES to rename this folder aside and clone fresh: "
if /i not "%CONTINUE%"=="YES" (
  echo Skipped. You can re-run this script later to finish step 3 and 4.
  goto :end
)

cd /d "G:\"
ren "sentryFi" "sentryFi-old-OCT19"
git clone https://github.com/dilip1456/sentryFi.git sentryFi
if errorlevel 1 (
  echo ERROR: clone failed. Your old folder is safe at G:\sentryFi-old-OCT19
  goto :end
)
echo.
echo Fresh clone is ready at G:\sentryFi.
echo.
echo === Step 4: Cleanup (do this ONLY after you verify the new ===
echo === G:\sentryFi works correctly, builds, and has what you need) ===
echo   rmdir /s /q "G:\sentryFi-old-OCT19"
echo   rmdir /s /q "G:\sentryFi\sentryfi-history-scrubbed"
echo.
echo These are NOT run automatically. Run them yourself once you're sure.

:end
echo.
echo Script finished.
pause
