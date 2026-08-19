@echo off
setlocal
chcp 65001 >nul 2>nul
cd /d "%~dp0"

REM 可选自定义保存目录，留空=本目录 bilibili_images
set "SAVE_DIR="

REM ===== 文件完整性校验（一键启动时执行，替代页面弹窗） =====
set "MISSING="
if not exist save_images_server.js set "MISSING=%MISSING% save_images_server.js"
if not exist bilibili-save.user.js set "MISSING=%MISSING% bilibili-save.user.js"
if not exist "watermark\wechat_qr.jpg" if not exist "watermark\wechat_qr.png" if not exist "watermark\wechat_qr.jpeg" if not exist "watermark\wechat_qr.webp" set "MISSING=%MISSING% watermark\收款码图片"

if defined MISSING (
  echo [校验] 以下文件缺失：%MISSING%
  echo [校验] 完整版请从 GitHub 下载：https://github.com/FNAS-496/bilibili-image-saver
  echo [校验] 若仅缺收款码，脚本仍可正常下载图片，仅打赏面板不显示收款码。
  pause
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