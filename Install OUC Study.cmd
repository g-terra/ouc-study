@echo off
rem Double-click to set up OUC Study on Windows (first time, or to add courses / a new semester).
cd /d "%~dp0"
where node >nul 2>nul || (
  echo OUC Study needs Node.js ^(free^). Opening https://nodejs.org: install the LTS version, then double-click this again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node bin\setup.mjs %*
echo.
pause
