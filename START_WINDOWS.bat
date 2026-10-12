@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python 3 is required. Install Python, then run this file again.
  pause
  exit /b 1
)
start "" http://127.0.0.1:8080
py -m http.server 8080 --directory site-public-cleared --bind 127.0.0.1
pause
