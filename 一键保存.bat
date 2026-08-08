@echo off
setlocal
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title B站原图保存服务

REM ============================================================
REM  自定义保存目录（可选）
REM  留空 = 保存到本目录下的 bilibili_images
REM  示例：set "SAVE_DIR=D:\bilibili_pics"
REM ============================================================
set "SAVE_DIR="

echo ================================================
echo    B站原图保存服务 - 一键启动
echo    图片会自动保存到本目录 bilibili_images
echo ================================================
echo.

if not exist save_images_server.js (
  echo [错误] 未找到 save_images_server.js，请确认脚本在本目录。
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先到 https://nodejs.org 安装后重试。
  pause
  exit /b 1
)

echo [1/3] 检查本地保存服务是否已在运行 (端口 8765)...
netstat -ano 2>nul | findstr ":8765" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo       服务已在运行，直接复用。
  goto open
)

echo [2/3] 启动本地保存服务（新窗口：B站原图保存服务）...
if defined SAVE_DIR (
  echo       保存目录：%SAVE_DIR%
  set "BILI_SAVE_DIR=%SAVE_DIR%"
) else (
  echo       保存目录：本目录下的 bilibili_images
)
start "B站原图保存服务" cmd /k "node save_images_server.js"

set /a tries=0
:wait
timeout /t 1 /nobreak >nul
set /a tries+=1
netstat -ano 2>nul | findstr ":8765" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 goto ready
if %tries% lss 10 goto wait
echo       服务启动较慢或失败，请看上面的服务窗口是否有报错。
goto open

:ready
echo       服务已就绪：http://127.0.0.1:8765

:open
echo [3/3] 打开浏览器（请打开你的收藏夹 / 动态 / 作品页面）...
start "" "https://www.bilibili.com"

echo.
echo 使用说明：
echo   - 打开 B 站收藏夹、动态或作品页后，页面右下角会自动开始提取并保存原图，无需任何操作。
echo   - 图片默认保存在本目录的 bilibili_images 文件夹（可改本文件顶部的 SAVE_DIR）。
echo   - 关闭"B站原图保存服务"窗口即可停止。
echo.
pause
