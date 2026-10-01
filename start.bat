@echo off
title Technology Risk Developer Interview App
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Download the LTS version from https://nodejs.org
  echo  then run this file again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=v." %%v in ('node -v') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
  echo.
  echo  Node.js 22.13 or later is required. You have:
  node -v
  echo  Download the LTS version from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if "%PORT%"=="" set PORT=8420
start "" "http://localhost:%PORT%"
node --disable-warning=ExperimentalWarning server.js
pause
