@echo off
title Rash - Class 10 AI Study Companion
cd /d "%~dp0"

echo ==============================================
echo   ⚡ Rash - Class 10 AI Study Companion
echo ==============================================
echo.

REM Install dependencies if node_modules is missing
if not exist "node_modules" (
  echo Installing dependencies, please wait...
  call npm install
  echo.
)

REM Start the server
echo Starting Rash at http://localhost:3000
echo Keep this window open. Close it to stop Rash.
echo.
call npm start

pause

