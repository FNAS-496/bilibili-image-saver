@echo off
setlocal
chcp 65001 >nul 2>nul
cd /d "%~dp0"

REM 可选自定义保存目录，留空=本目录 bilibili_images
set "SAVE_DIR="

if not exist save_images_server.js (
  echo [错误] 缺少文件：save_images_server.js 不存在，请确认文件完整。
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 缺少 Node.js，请到 https://nodejs.org 安装后重试。
  pause
  exit /b 1
)

netstat -ano 2>nul | findstr ":8765" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 goto open

if defined SAVE_DIR set "BILI_SAVE_DIR=%SAVE_DIR%"
start "B站原图保存服务" cmd /k "node save_images_server.js"

set /a tries=0
:wait
timeout /t 1 /nobreak >nul
set /a tries+=1
netstat -ano 2>nul | findstr ":8765" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 goto open
if %tries% lss 10 goto wait
echo [警告] 服务启动失败，请查看服务窗口报错。

:open
start "" "https://www.bilibili.com"
exit /b 0