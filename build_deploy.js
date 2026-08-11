// 临时生成器：把 user.js + server.js 打包成自包含的 一键部署.bat（全部 CRLF 行尾，GBK 编码）
const fs = require('fs');

const files = {
    'bilibili-save.user.js': fs.readFileSync('bilibili-save.user.js'),
    'save_images_server.js': fs.readFileSync('save_images_server.js')
};

function b64wrap(buf) {
    const b = buf.toString('base64');
    const lines = [];
    for (let i = 0; i < b.length; i += 64) lines.push(b.slice(i, i + 64));
    return lines.join('\r\n');
}

const E = [];
E.push('@echo off');
E.push('setlocal enabledelayedexpansion');
E.push('cd /d "%~dp0"');
E.push('title B站原图批量保存 - 一键部署 v1.0');
E.push('echo ================================================');
E.push('echo    B站原图批量保存 - 一键部署 v1.0');
E.push('echo    本文件已内置全部组件，双击即可完成部署。');
E.push('echo ================================================');
E.push('echo.');
E.push('');
E.push('rem ---------- 1. 检查 Node.js ----------');
E.push('where node >nul 2>nul');
E.push('if errorlevel 1 (');
E.push('  echo [错误] 未检测到 Node.js ！');
E.push('  echo 请先安装 Node.js（官网一路默认安装），安装完成后重新双击本文件。');
E.push('  start "" "https://nodejs.org"');
E.push('  pause');
E.push('  exit /b 1');
E.push(')');
E.push('echo [1/4] Node.js 已就绪。');
E.push('echo.');
E.push('');
E.push('rem ---------- 2. 释放内置文件 ----------');
E.push('echo [2/4] 释放内置文件（bilibili-save.user.js / save_images_server.js）...');
E.push('powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference=\'Stop\'; $lines = Get-Content -LiteralPath \'%~f0\' -Encoding Default; $out = @{}; $cur = $null; foreach($l in $lines){ if($l -match \'^::#FILE:(.+)$\'){ $cur = $matches[1].Trim(); $out[$cur] = New-Object System.Text.StringBuilder } elseif($cur -and $l -match \'^::#END\'){ $cur = $null } elseif($cur){ [void]$out[$cur].Append($l.Trim()) } }; foreach($k in $out.Keys){ $bytes = [Convert]::FromBase64String($out[$k].ToString()); [IO.File]::WriteAllBytes((Join-Path (Get-Location) $k), $bytes); Write-Host (\'    released: \' + $k + \' (\' + $bytes.Length + \' bytes)\') }"');
E.push('if errorlevel 1 (');
E.push('  echo [错误] 释放文件失败，请确认本文件完整（未被截断或损坏）。');
E.push('  pause');
E.push('  exit /b 1');
E.push(')');
E.push('echo        文件释放完成。');
E.push('echo.');
E.push('');
E.push('rem ---------- 3. 启动本地保存服务 ----------');
E.push('echo [3/4] 检查本地保存服务（端口 8765）...');
E.push('netstat -ano 2>nul | findstr ":8765" | findstr "LISTENING" >nul 2>nul');
E.push('if not errorlevel 1 (');
E.push('  echo        服务已在运行，直接复用。');
E.push(') else (');
E.push('  echo        正在启动本地保存服务...');
E.push('  start "B站原图保存服务" cmd /k "node save_images_server.js"');
E.push('  set /a tries=0');
E.push('  :wait');
E.push('  timeout /t 1 /nobreak >nul');
E.push('  set /a tries+=1');
E.push('  netstat -ano 2>nul | findstr ":8765" | findstr "LISTENING" >nul 2>nul');
E.push('  if not errorlevel 1 goto ready');
E.push('  if !tries! lss 10 goto wait');
E.push('  echo        服务启动较慢或失败，请看服务窗口的报错。');
E.push('  goto ready');
E.push('  :ready');
E.push('  echo        服务已就绪：http://127.0.0.1:8765');
E.push(')');
E.push('echo.');
E.push('');
E.push('rem ---------- 4. 安装浏览器脚本 ----------');
E.push('echo [4/4] 打开浏览器脚本安装页...');
E.push('echo        若已安装 Tampermonkey，会弹出「安装」确认，点击安装即可。');
E.push('echo        若未安装 Tampermonkey，请先安装扩展后再执行本步骤。');
E.push('if exist bilibili-save.user.js (');
E.push('  start "" "bilibili-save.user.js"');
E.push(') else (');
E.push('  echo [错误] 未找到 bilibili-save.user.js');
E.push(')');
E.push('echo.');
E.push('');
E.push('echo ================================================');
E.push('echo   部署完成！');
E.push('echo   1. 打开 B 站收藏夹 / 动态 / 作品页，自动下载原图');
E.push('echo   2. 图片保存在本目录的 bilibili_images 文件夹');
E.push('echo   3. 下载成功后点「查看图片」可浏览本地相册');
E.push('echo ================================================');
E.push('echo.');
E.push('pause');
E.push('exit /b 0');
E.push('');

let out = E.join('\r\n') + '\r\n';
out += '::#FILE:bilibili-save.user.js\r\n' + b64wrap(files['bilibili-save.user.js']) + '\r\n::#END\r\n';
out += '::#FILE:save_images_server.js\r\n' + b64wrap(files['save_images_server.js']) + '\r\n::#END\r\n';

// 统一 CRLF
out = out.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

fs.writeFileSync('一键部署.bat', out, 'utf8');

// 转 GBK/ANSI（中文 Windows 默认 936）
const { execFileSync } = require('child_process');
execFileSync('powershell', ['-NoProfile', '-Command',
    "$t=[IO.File]::ReadAllText((Join-Path (Get-Location) '一键部署.bat'),[Text.Encoding]::UTF8); [IO.File]::WriteAllText((Join-Path (Get-Location) '一键部署.bat'),$t,[Text.Encoding]::GetEncoding(936))"]);

// 校验：行尾统一、PS 行单行完整、无 BOM
const buf = fs.readFileSync('一键部署.bat');
const raw = buf.toString('latin1');
const crlfCount = (raw.match(/\r\n/g) || []).length;
const lfOnly = (raw.match(/\n/g) || []).length - crlfCount;
const psLine = raw.split('\r\n').find(l => l.startsWith('powershell -NoProfile'));
console.log('GBK bytes:', buf.length, '| CRLF:', crlfCount, '| LF-only lines:', lfOnly, '| BOM:', buf[0] === 0xef);
console.log('PS line single:', psLine ? !psLine.includes('\n') : false, '| PS line len:', psLine ? psLine.length : -1);
