@echo off
rem Double-click to open the OUC Study app on Windows (starts it in the background if it isn't running).
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Install Node.js from https://nodejs.org first.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node -e "const f=require('fs');process.exit(f.readdirSync('semesters').some((s)=>f.existsSync('semesters/'+s+'/semester.json'))?0:1)" 2>nul
if errorlevel 1 (
  echo Not set up yet: starting the installer.
  node bin\setup.mjs
  pause
  exit /b
)
if not exist node_modules call npm install
node bin\ouc.mjs open
