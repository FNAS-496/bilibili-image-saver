# Bilibili-Plus

B 站原图和视频的批量下载工具，由一个 Tampermonkey 脚本和一个跑在本机的 Node 服务组成。

浏览器没法直接往硬盘写文件，所以下载这件事交给本地服务：脚本负责在页面上找资源、拿到原始地址，服务负责下载和写盘。

## 安装

需要 Node.js 18 或更高版本（只用内置模块，不用 `npm install`）。

1. 浏览器装 [Tampermonkey](https://www.tampermonkey.net/)
2. 把 `bilibili-save.user.js` 拖进浏览器，安装脚本
3. 双击 `一键启动.bat` 启动本地服务

如果电脑上没有 Node，用 `无需环境直接安装版` 那个文件夹 —— 里面内置了 Node 和 ffmpeg，双击里面的 `一键启动.bat` 即可。

## 用法

**图片**：打开收藏夹、个人动态或作品页，脚本会自动提取原图并保存。不想让它自动跑，就在页面地址后面加 `?bili_auto_save=0`；也可以随时点右下角的「提取并保存」手动触发。

**视频**：点右下角「视频下载」，面板会列出当前视频、分 P 列表，以及页面右侧的订阅合集。勾选之后点「下载选中」。

**审查模式**：在设置里切到「审查模式」后，图片会先逐张预览，按 ↓ 保存当前这张，← → 翻页，Esc 退出。键位可以在面板左侧改。

## 文件存哪

默认保存到桌面的 `B站下载` 文件夹：

```
B站下载/
├── xxx.png          # 图片（文件名是原图 hash）
└── videos/          # 视频
```

想换地方就在脚本的设置面板里填目录，清空则恢复成默认的桌面文件夹。视频的实际保存位置会显示在下载面板底部，不用自己猜。

macOS / Linux 没有 bat，直接跑服务即可，目录可以从命令行或环境变量传入：

```bash
node save_images_server.js ~/Pictures/bili                # 命令行参数
BILI_SAVE_DIR=~/Pictures/bili node save_images_server.js  # 或环境变量
```

## 一些实现细节

- 图片会自动去掉 `@316w_560h` 这类缩略图后缀取原图，webp / avif 尽量转成 jpg
- 视频走 B 站的 playurl 接口拿 DASH 流。装了 ffmpeg 就合并成带声音的 mp4，没装则音视频分开存（`.video.mp4` + `.audio.m4a`）
- ffmpeg 可以放在项目目录的 `ffmpeg\ffmpeg.exe`，也可以用系统 PATH 里的
- 已经下载过的视频会标记「✅ 已下载」，「全选未下载」和下载时都会自动跳过，不会重复占带宽
- 服务端有查重，同一个文件不会重复下载
- 支持收藏夹、动态、作品（opus）以及整个订阅合集的批量下载

## 常见问题

**提示「未连接本地保存服务」**

本地服务没启动。双击 `一键启动.bat`，然后刷新 B 站页面。

**有些图片下载失败**

通常是需要登录才能看的图（私密收藏夹、部分作者的图），属于 B 站的权限限制，本地服务绕不过去。

**视频列表是空的，或者拿不到下载地址**

先确认本地服务在运行。如果只是个别视频失败，可能该视频有会员或地区限制。

**下载的视频没有声音**

没装 ffmpeg。装好后重新下载，或者直接用配套的 `.audio.m4a`。

**怎么更新脚本**

Tampermonkey 会按脚本里的 `@updateURL` 自动检查更新，也可以手动删掉旧脚本重新导入一次。

## 许可

[CC BY-NC-SA 4.0](LICENSE) —— 可以随意使用和修改，但要保留署名、不能商用、改完也要用同样的协议开源。

作者：FNAS-496（sijiudeliu@outlook.com）

觉得好用的话，欢迎请我喝杯咖啡 ☕ 脚本的打赏面板里有收款码。

想换成自己的收款码，就用新图覆盖 `watermark/wechat_qr.jpg`，再重新生成脚本里内嵌的 base64：

```bash
node -e "const fs=require('fs');const b=fs.readFileSync('watermark/wechat_qr.jpg');const s=fs.readFileSync('bilibili-save.user.js','utf8');fs.writeFileSync('bilibili-save.user.js',s.replace(/const DONATE_QR = '[^']*';/,'const DONATE_QR = \'data:image/jpeg;base64,'+b.toString('base64')+'\';'))"
```

然后重新导入脚本即可。
