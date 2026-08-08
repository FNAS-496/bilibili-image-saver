@echo off
setlocal
cd /d "%~dp0"
title Bilibili Image Saver Server

REM ============================================================
REM  Optional: custom save directory
REM  Leave empty = save to .\bilibili_images
REM  Example: set "SAVE_DIR=D:\bilibili_pics"
REM ============================================================
set "SAVE_DIR="

echo ================================================
echo    Bilibili Image Saver - one-click launcher
echo    Images will be saved to .\bilibili_images
echo ================================================
echo.

if not exist save_images_server.js (
  echo [ERROR] save_images_server.js not found in this folder.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install it from https://nodejs.org
  pause
  exit /b 1
)

echo [1/3] Checking whether the local server is already running (port 8765)...
netstat -ano 2>nul | findstr ":8765" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo       Server is already running. Reusing it.
  goto open
)

echo [2/3] Starting the local save server (new window: Bilibili Image Saver)...
if defined SAVE_DIR (
  echo       Save directory: %SAVE_DIR%
  set "BILI_SAVE_DIR=%SAVE_DIR%"
) else (
  echo       Save directory: .\bilibili_images
)
start "Bilibili Image Saver" cmd /k "node save_images_server.js"

set /a tries=0
:wait
timeout /t 1 /nobreak >nul
set /a tries+=1
netstat -ano 2>nul | findstr ":8765" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 goto ready
if %tries% lss 10 goto wait
echo       Server started slowly or failed - check the server window for errors.
goto open

:ready
echo       Server is ready: http://127.0.0.1:8765

:open
echo [3/3] Opening browser (open your favorites / dynamics / opus page)...
start "" "https://www.bilibili.com"

echo.
echo How to use:
echo   - Open a Bilibili favorites, dynamics or opus page. The script will
echo     automatically extract and save original images. No clicking needed.
echo   - Images are saved to .\bilibili_images by default (edit SAVE_DIR above).
echo   - Close the "Bilibili Image Saver" window to stop the server.
echo.
pause
