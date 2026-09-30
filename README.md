# Bilibili-Plus

B 站图片和视频的批量下载工具。

一个油猴脚本 + 一个跑在本机的 Node 服务。

为啥还要个服务？因为浏览器没法直接往硬盘写文件啊，所以「下载」这件事只能交给它来做。

## 装

需要 Node.js 18 以上（其实没有额外依赖，纯内置模块，不用 npm install）。

1. 浏览器装 [Tampermonkey](https://www.tampermonkey.net/)
2. 把 `bilibili-save.user.js` 拖进去安装
3. 双击 `一键启动.bat`

电脑上没 Node 的话，用 `无需环境直接安装版` 那个文件夹，里面塞了 Node 和 ffmpeg，双击里面的 `一键启动.bat` 就能跑。

## 用

**图片**：打开收藏夹、动态、作品页，它会自己开始存。不想让它自动跑，就在地址后面加个 `?bili_auto_save=0`；想手动存就点右下角的「提取并保存」。

**视频**：点右下角「视频下载」，当前视频、分 P、还有页面右边那个订阅合集都会列出来，勾上点下载就完事。

**审查模式**：设置里切过去之后，图片会一张张给你看，↓ 存当前这张，← → 翻页，Esc 退出。键位嫌不顺手可以在左边改。

## 文件存哪

默认丢到桌面的 `B站下载` 文件夹：

```
B站下载/
├── xxx.png          # 图片，文件名是原图 hash
└── videos/          # 视频
```

想换地方在设置面板里填就行，清空就恢复成默认的。视频存哪下载面板底下会写出来，不用自己满硬盘找。

macOS / Linux 没有 bat，直接跑服务就行，目录可以从命令行或者环境变量传：

```bash
node save_images_server.js ~/Pictures/bili                # 命令行
BILI_SAVE_DIR=~/Pictures/bili node save_images_server.js  # 或者环境变量
```

## 一些细节

- 图片会自动把 `@316w_560h` 这种缩略图后缀去掉取原图，webp / avif 也尽量转成 jpg
- 视频走 B 站的 playurl 接口拿 DASH 流。装了 ffmpeg 就合并成一个带声音的 mp4，没装就音视频分开存（`.video.mp4` + `.audio.m4a`）
- ffmpeg 放项目目录的 `ffmpeg\ffmpeg.exe` 也行，或者系统 PATH 里有就行
- 下过的视频会标上「✅ 已下载」，「全选未下载」和下载的时候都会跳过，不至于白白浪费流量
- 服务端那边也做了查重，同一个文件不会重复下
- 支持收藏夹、动态、作品（opus），以及整个订阅合集的批量下载

## 常见问题

**提示「未连接本地保存服务」**

服务没启动。双击 `一键启动.bat`，然后刷新 B 站页面。

**有些图片下不了**

一般是得登录才能看的图（私密收藏夹、部分作者的图），B 站那边的权限限制，本地服务绕不过去。

**视频列表是空的，或者拿不到下载地址**

先看看服务是不是在跑。要是只有个别视频不行，可能是那视频有会员或者地区限制。

**视频下下来没声音**

没装 ffmpeg。装上重新下一遍，或者直接用配套的 `.audio.m4a`。

**怎么更新**

Tampermonkey 会按脚本里的 `@updateURL` 自动检查更新，也可以删掉旧的重新导入一次。

## 许可

[CC BY-NC-SA 4.0](LICENSE) —— 随便用随便改，但要留着署名、不能拿去商用、改完了也得用一样的协议开源。

作者：FNAS-496（sijiudeliu@outlook.com）

想换成自己的收款码，就拿新图覆盖 `watermark/wechat_qr.jpg`，再重新生成脚本里内嵌的那串 base64：

```bash
node -e "const fs=require('fs');const b=fs.readFileSync('watermark/wechat_qr.jpg');const s=fs.readFileSync('bilibili-save.user.js','utf8');fs.writeFileSync('bilibili-save.user.js',s.replace(/const DONATE_QR = '[^']*';/,'const DONATE_QR = \'data:image/jpeg;base64,'+b.toString('base64')+'\';'))"
```

然后重新导入脚本就完事。
