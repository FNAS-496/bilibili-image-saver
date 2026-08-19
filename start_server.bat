@echo off
setlocal
chcp 65001 >nul 2>nul
cd /d "%~dp0"

REM 可选自定义保存目录，留空=本目录 bilibili_images
set "SAVE_DIR="

if not exist save_images_server.js (
  echo [ERROR] Missing file: save_images_server.js not found.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)

netstat -ano 2>nul | findstr ":8765" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 goto open

if defined SAVE_DIR set "BILI_SAVE_DIR=%SAVE_DIR%"
start "Bilibili Image Saver" cmd /k "node save_images_server.js"

set /a tries=0
:wait
timeout /t 1 /nobreak >nul
set /a tries+=1
netstat -ano 2>nul | findstr ":8765" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 goto open
if %tries% lss 10 goto wait
echo [WARN] Server failed to start. Check the server window.

:open
start "" "https://www.bilibili.com"
exit /b 0