@echo off
REM Fallback commit script for when Claude's sandbox can't clear a stuck
REM .git lock file. Run this directly in Windows (double-click it, or run
REM from cmd/PowerShell) - it uses your normal Windows git, which isn't
REM subject to the sandbox's mount restriction.
REM
REM Usage: commit-helper.bat "your commit message here"
REM If you don't pass a message, it'll ask for one.

cd /d "%~dp0"

echo.
echo Clearing any stuck git lock files...
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\HEAD.lock" 2>nul
del /f /q ".git\objects\maintenance.lock" 2>nul

set MSG=%~1
if "%MSG%"=="" (
    set /p MSG=Enter commit message:
)

echo.
echo Staging changes...
git add -A

echo.
echo Committing...
git commit -m "%MSG%"

echo.
echo Done. Current status:
git status

pause
