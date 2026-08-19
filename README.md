# 🎨 Bilibili-Plus 哔哩哔哩增强 / Bilibili Enhancement Suite

> B 站**原图 / 视频批量下载**增强工具：收藏夹、动态、作品 (opus) 原图一键保存，视频多 P 批量下载，审查模式 + 只看大图 + 自定义键位，日夜主题。
> A Bilibili enhancement userscript + local server: batch-download **original images & videos**, review mode with fullscreen preview and custom hotkeys, light/dark themes.

<div align="center">

![Version](https://img.shields.io/badge/version-0.9.17-00a1d6)
![License](https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-orange)
![Node](https://img.shields.io/badge/Node.js-%3E%3D18-339933)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Browsers](https://img.shields.io/badge/browsers-Chrome%20%7C%20Edge%20%7C%20Firefox%20%7C%20Safari-4285F4)
![GitHub stars](https://img.shields.io/github/stars/FNAS-496/bilibili-image-saver)
![GitHub forks](https://img.shields.io/github/forks/FNAS-496/bilibili-image-saver)
![GitHub issues](https://img.shields.io/github/issues/FNAS-496/bilibili-image-saver)

</div>

---

## 📑 目录 / Table of Contents

- [项目简介 / About](#项目简介--about)
- [功能特性 / Features](#功能特性--features)
- [支持环境 / Supported Environments](#支持环境--supported-environments)
- [项目结构 / Project Structure](#项目结构--project-structure)
- [快速上手 / Quick Start](#快速上手--quick-start)
- [详细安装指南 / Detailed Installation](#详细安装指南--detailed-installation)
- [使用方法 / How to Use](#使用方法--how-to-use)
- [收款码 / Donate QR](#收款码--donate-qr)
- [自定义保存位置 / Custom Save Location](#自定义保存位置--custom-save-location)
- [常见问题 / FAQ](#常见问题--faq)
- [技术说明 / Technical Notes](#技术说明--technical-notes)
- [说明 / Disclaimer](#说明--disclaimer)
- [贡献指南 / Contributing](#贡献指南--contributing)
- [作者 / Author](#作者--author)
- [许可证 / License](#许可证--license)

---

## 📖 项目简介 / About

B 站页面上的图片通常是经过压缩的缩略图（带 `@446w_...` 之类的参数）。本工具会在浏览器端自动提取页面数据中的**原图地址**，发送给本机的一个小服务，由它下载并保存到你的硬盘。

本方案由两部分组成：

| 组件 / Component | 作用 / Role |
|---|---|
| `bilibili-save.user.js` | 浏览器用户脚本（Tampermonkey 等），负责提取原图/视频链接、审查模式 UI |
| `save_images_server.js` | 本地 Node.js 服务，负责把图片/视频下载到硬盘（含 ffmpeg 合并） |
| `一键启动.bat` | 一键启动本地服务并打开浏览器（Windows） |

> 为什么需要本地服务？因为浏览器出于安全限制，无法直接把文件写入你电脑的任意文件夹。所以由浏览器提取链接 → 本地服务下载写盘。

**🔗 项目地址 / Repository**：https://github.com/FNAS-496/bilibili-image-saver

---

## ✨ 功能特性 / Features

- ✅ **自动运行**：打开收藏夹 / 动态 / 作品页即自动下载，**无需点击任何按钮**
- ✅ **全站支持**：脚本运行在**整个 B 站**，自动识别页面类型（收藏夹 / 动态 / 作品 / 空间 / 视频等），只在含图片的页面自动保存，其余页面零干扰
- ✅ **智能识别**：自动检测当前空间是**你自己的**还是**他人的**（仅影响提示，公开内容均可保存）
- ✅ **原图下载**：自动去除 `@` 缩略参数、还原 `webp/avif` 为原始格式
- ✅ **批量抓取**：收藏夹页自动抓取前 200 个作品的原图
- ✅ **动态自动增量**：动态列表页**滚动加载新动态时会自动继续保存**，无需手动操作
- ✅ **智能去重**：同一张图只下载一次，不会重复占用空间
- ✅ **进度提示**：页面右下角浮窗实时显示进度，可随时「停止」
- ✅ **多页类型**：支持收藏夹、动态列表、动态详情、作品 (opus) 页
- ✅ **视频批量下载**：右下角「📹 视频下载」按钮，支持收藏夹视频、播放页分 P 列表的**多选批量下载**，并**列出每个视频的大小**
- ✅ **审查模式**：逐张预览确认后再下载，支持点赞、全部下载、已下载标记
- ✅ **已下载标记**：打开审查面板自动检测本地已下载的图片，全部图片都会显示，已下载的带 ✅ 标签
- ✅ **点赞/关注/收藏**：自动检测页面当前点赞、关注、收藏状态（已点赞 ❤️ / 未点赞 👍，已收藏 ★ / 未收藏 ☆，已关注 ✔ / 未关注 ＋），一键切换
- ✅ **只看大图**：一键隐藏左右侧栏，中央图片**占满整个屏幕**沉浸式看图
- ✅ **自定义键位**：审查模式下的下一页 / 上一页 / 下载 / 退出快捷键**全部可在设置中自定义**
- ✅ **日夜主题**：右下角一键切换**日间 / 夜间**主题
- ✅ **Bilibili-Plus 根按钮**：所有小功能收纳在右下角「Bilibili-Plus」根按钮内，界面整洁
- ✅ **手动下载优先**：默认**不自动下载**（可在设置中开启「打开页面自动提取」），点击「⬇️ 提取并保存」才下载，避免误操作
- ✅ **自定义目录**：页面内「⚙️ 保存位置」窗口自由指定保存位置
- ✅ **打赏面板**：下载成功后自动弹出提示，显示作者、GitHub、邮箱与微信收款码
- ✅ **多浏览器**：Chrome / Edge / Firefox / Safari / Opera 等均可使用

---

## 🖥️ 支持环境 / Supported Environments

| 项目 / Item | 要求 / Requirement |
|---|---|
| 操作系统 OS | Windows / macOS / Linux |
| Node.js | **18 或更高版本**（用于运行本地保存服务）👉 https://nodejs.org |
| 浏览器 Browser | Chrome / Edge / Firefox / Safari / Opera / Brave / Vivaldi 等现代浏览器 |
| 脚本管理器 | **Tampermonkey**（推荐）/ Violentmonkey / Userscripts / Greasemonkey |
| 网络 Network | 需能访问 B 站（`www.bilibili.com`、`t.bilibili.com`、`*.hdslb.com`） |

> 💡 脚本管理器下载地址：
> - Tampermonkey：https://www.tampermonkey.net
> - Violentmonkey：https://violentmonkey.github.io
> - Safari 用 Userscripts：https://apps.apple.com/app/userscripts/id1463298887

---

## 📁 项目结构 / Project Structure

```
.
├── bilibili-save.user.js      # 浏览器用户脚本（Tampermonkey 等）—— 提取原图链接
├── save_images_server.js      # 本地 Node.js 保存服务 —— 下载图片并写盘
├── 一键启动.bat                # Windows 一键启动（中文界面）
├── start_server.bat           # Windows 一键启动（English UI）
├── watermark/                 # 收款码源图（wechat_qr.jpg，已内嵌进 user.js）
├── README.md                  # 本说明文档（中英双语）
├── LICENSE                    # CC BY-NC-SA 4.0 许可协议
└── .gitignore                 # Git 忽略规则（含 bilibili_images/ 与 watermark/ 源图）
```

> 下载的图片默认保存在 `bilibili_images/`，该目录已加入 `.gitignore`，不会被提交到仓库。

---

## 🚀 快速上手 / Quick Start

只需**两个文件**，之后每次使用也只要一步：

1. **双击 `一键启动.bat`** —— 它会自动完成：检查 Node.js → 启动本地服务 → 打开浏览器
2. 在浏览器打开 B 站收藏夹 / 动态 / 作品页，页面右下角会自动开始保存原图

> 💡 详细步骤见下文「详细安装指南」。

---

## 📦 详细安装指南 / Detailed Installation

### 第 1 步：安装 Node.js（仅第一次）

1. 打开 https://nodejs.org ，下载 **LTS 版本**并安装（一路默认即可）。
2. 验证是否成功：打开终端（CMD 或 PowerShell）输入 `node -v`，能显示版本号（如 `v20.x.x`）即成功。

### 第 2 步：安装浏览器脚本（仅第一次）

1. 安装 Tampermonkey 插件（见上表链接），浏览器右上角会出现它的图标。
2. 手动导入脚本：Tampermonkey 管理面板 → 「添加新脚本」→ 全选删除后粘贴 `bilibili-save.user.js` 的全部内容，`Ctrl+S` 保存。
   > 也可以直接双击 `bilibili-save.user.js` 文件，Tampermonkey 会弹出「安装」确认（需先开启「允许访问文件网址」：Tampermonkey 管理面板 → 设置 → 勾选）。

### 第 3 步：启动本地保存服务（每次使用前）

- **Windows**：双击 `一键启动.bat`（自动检测并启动服务、打开浏览器）。
- **macOS / Linux**：打开终端，进入项目目录后运行：
  ```bash
  node save_images_server.js
  ```
  看到 `save_images_server listening on http://127.0.0.1:8765` 即成功。

> ⚠️ 服务窗口请不要关闭；下载完成后关闭它即可停止服务。

---

## 🧭 使用方法 / How to Use

1. 确认本地服务已启动（终端 / 服务窗口在运行）。
2. 打开以下任意页面，**右下角浮窗会自动开始提取并保存原图**：

| 页面类型 | 示例 URL |
|---|---|
| 收藏夹 Favorites | `https://space.bilibili.com/{你的UID}/favlist?fid=opus&ftype=opus` |
| 动态列表 Dynamic list | `https://space.bilibili.com/{你的UID}/dynamic` |
| 动态详情 Dynamic detail | `https://t.bilibili.com/752328990923952129` |
| 作品详情 Opus detail | `https://www.bilibili.com/opus/1229320370032476179` |

> 收藏夹与动态的 `{你的UID}` 替换成你自己的空间 UID（打开 `space.bilibili.com` 后地址栏里的数字）；`t.bilibili.com` 与 `opus` 为任意动态/作品示例。

3. 下载完成后，右下角浮窗会显示：`保存完成：新增 X 张，已存在 Y 张，失败 Z 张`。
4. 图片默认保存在项目目录的 **`bilibili_images/`** 文件夹（文件名即原图 hash，如 `ea017859....png`）。

**手动重试**：若中途失败或想重新抓取，点击页面右下角的「重新提取并保存」按钮即可。

**暂停自动运行**：在页面 URL 末尾加上 `?bili_auto_save=0` 后访问，脚本将不自动运行。

**动态列表页**：页面只渲染当前看到的动态，**向下滚动时新动态会自动被继续提取保存**；滚动到想看的位置稍等片刻即可。

**智能页面识别**：脚本运行在整个 B 站，会自动判断当前页面类型：
- 收藏夹 / 动态列表 / 动态详情 / 作品页 → 自动提取保存原图
- 空间首页、视频页、番剧页等 → 不自动运行（不影响正常浏览），仍可随时点击右下角按钮手动保存
- 动态列表会提示该空间是「你的空间」还是「他人空间」（他人空间仅能保存公开内容）

**视频批量下载**：点击页面右下角「📹 视频下载」按钮，弹出视频列表面板：
- 自动识别**收藏夹页**与**视频播放页**（含分 P 列表）中的视频
- 面板会**自动获取每个视频的大小与画质**（无需手动操作）
- 勾选要下载的视频 → 点「下载选中」即可批量下载到本地 `videos/` 目录
- 检测到 ffmpeg 时自动把视频流+音频流**合并为带声音的 mp4**；未安装 ffmpeg 则音画分开保存（`.video.mp4` + `.audio.m4a`）

> 需要合并成带声音的 mp4？请安装 [FFmpeg](https://ffmpeg.org) 并加入系统 PATH，或把 `ffmpeg.exe` 放到项目目录的 `ffmpeg\` 子目录（无需环境直接安装版已内置 `ffmpeg\ffmpeg.exe`）。

---

## 💳 收款码 / Donate QR

下载成功后，页面右下角会弹出「下载成功」面板，展示作者、GitHub、邮箱与收款码打赏入口。

收款码已**直接内嵌在 `bilibili-save.user.js` 中**（data URI 形式，随脚本一起分发），无需本地服务器提供，安装脚本即可显示；脚本启动校验会自动检查收款码是否内置（控制台输出 `[check] 收款码: ready / missing`）。

**更换成你自己的收款码**：
1. 微信 → 我 → 收付款 → 二维码收款 → 保存收款码图片
2. 用新图片**同名覆盖** `watermark/wechat_qr.jpg`
3. 生成 base64 并替换脚本中 `DONATE_QR` 常量的数据段：
   ```bash
   node -e "process.stdout.write('data:image/jpeg;base64,'+require('fs').readFileSync('watermark/wechat_qr.jpg').toString('base64'))"
   ```
4. 将生成的 data URI 粘贴到 `bilibili-save.user.js` 的 `const DONATE_QR = '...'` 中，重新在 Tampermonkey 导入脚本

> 没有内置收款码时，面板仍会显示作者/GitHub/邮箱文字，脚本会提示「文件不全，请下载完整版」。
> 收款码随 `bilibili-save.user.js` 一起发布到仓库；若不想公开，可用上面的方法替换成自己的收款码后私有使用。

---

## 📂 自定义保存位置 / Custom Save Location

### 方式 A：页面内设置窗口（推荐，适用于所有系统）
1. 打开任意 B 站页面，点击右下角 **「⚙️ 保存位置」** 按钮。
2. 在弹出的窗口中输入保存目录（例如 `D:\bilibili_pics`），点「保存」。
3. 首次使用本脚本时，该设置窗口会自动弹出一次。

### 方式 B：修改 `一键启动.bat`（Windows）
用记事本打开 `一键启动.bat`，找到文件顶部的这一行：

```bat
set "SAVE_DIR="
```

把保存目录填进去，例如：

```bat
set "SAVE_DIR=D:\bilibili_pics"
```

保存后重新双击即可。留空则使用默认目录 `bilibili_images`。

### 方式 C：命令行参数 / 环境变量（macOS / Linux / 通用）

```bash
# 方式 1：命令行参数
node save_images_server.js "/Users/me/Pictures/bili"

# 方式 2：环境变量
BILI_SAVE_DIR="/Users/me/Pictures/bili" node save_images_server.js
```

> 说明：页面内设置（方式 A）即时生效并**自动记忆**（重启服务后仍然有效）；`一键启动.bat` 与命令行在服务**启动时**设定目录。优先级：环境变量 / 命令行参数 > 页面内设置（持久化）> 默认 `bilibili_images`。

---

## ❓ 常见问题 / FAQ

**Q: 提示「未连接本地保存服务」怎么办？**
A: 说明本地服务没启动。Windows 双击 `一键启动.bat`；macOS/Linux 运行 `node save_images_server.js`，然后**刷新** B 站页面。

**Q: 如何更新脚本到新版本？**
A: 手动重新导入 `bilibili-save.user.js`（覆盖安装即可），然后**刷新** B 站页面。

**Q: 图片保存在哪里？**
A: 默认在项目目录的 `bilibili_images/`；可在 `一键启动.bat` 顶部或命令行指定其他目录（见上节）。

**Q: 有些图片下载失败（显示失败 N 张）？**
A: 多为需要登录 Cookie 才能访问的图片（如私密收藏夹、部分作者的图）。这是 B 站权限限制，本地服务无法绕过。

**Q: 收藏夹 / 动态很多，一次能抓多少？**
A: 收藏夹页默认抓取前 200 个作品；可在 `bilibili-save.user.js` 顶部的 `MAX_CHILD_PAGES` 调整。动态列表页会自动增量抓取（滚动即继续）。

**Q: 不想自动运行，只想手动控制？**
A: URL 加 `?bili_auto_save=0` 关闭自动；需要时点右下角「重新提取并保存」按钮。

**Q: 支持 B 站 App 或移动网页吗？**
A: 脚本匹配的是电脑端网页（`www.bilibili.com`、`t.bilibili.com`、`space.bilibili.com`）。建议使用电脑浏览器。

---

## 🛠️ 技术说明 / Technical Notes

- 浏览器端通过 `GM_xmlhttpRequest` 跨域抓取子页面并解析 `\u002F` 转义、`@` 缩略参数，得到原图 URL。
- 本地服务监听 **127.0.0.1:8765**（仅本机可访问，不暴露到局域网），通过 Referer + User-Agent 模拟浏览器下载，并校验返回的 Content-Type，避免把风控/错误页存成图片。
- 下载并发数默认 8（服务器 `CONCURRENCY`），抓取子页并发数默认 6（脚本 `CHILD_CONCURRENCY`）。
- 视频下载：脚本调用 B 站 `playurl` API 获取 DASH 视频/音频流与大小，发送给本地服务 `/video/save` 下载；检测到 ffmpeg 时自动合并为 mp4（优先查找项目目录 `ffmpeg\ffmpeg.exe`，其次系统 PATH），否则音画分开保存。视频并发默认 2。

---

## ⚖️ 说明 / Disclaimer

本工具仅用于个人学习与备份自己有权访问的内容。请尊重作者版权，勿将下载内容用于商业用途或二次传播。下载速度与成功率受 B 站风控影响，请合理使用。

*This tool is for personal study and backing up content you are authorized to access. Please respect the artists' copyright. Usage is subject to Bilibili's terms and anti-abuse policies.*

---

## 🤝 贡献指南 / Contributing

欢迎任何形式的贡献！如果你发现问题或有改进建议：

1. **提交 Issue**：请说明问题现象、复现步骤、浏览器及脚本版本。
2. **提交 Pull Request**：Fork 本项目 → 修改 → 提交 PR。
   - 代码改动请附带简要说明。
   - 涉及图片提取逻辑的改动，请在 PR 中说明对应的 B 站页面结构（B 站前端会不定期改版）。

### 开发 / Development

```bash
# 启动本地保存服务（开发调试时）
node save_images_server.js

# 浏览器端脚本：将 bilibili-save.user.js 导入 Tampermonkey 即可
```

> 提示：B 站前端经常改版导致提取规则失效，欢迎在 Issue 中反馈，我们会及时跟进。

---

## 👤 作者 / Author

- **GitHub**：[FNAS-496](https://github.com/FNAS-496)
- **邮箱 / Email**：sijiudeliu@outlook.com

如果你觉得这个工具有帮助，欢迎 Star ⭐ 或到 [Issues](https://github.com/FNAS-496/bilibili-image-saver/issues) 反馈问题。

*If you find this tool helpful, please give it a ⭐ or report issues on GitHub.*

---

## 📜 许可证 / License

本项目采用 **CC BY-NC-SA 4.0**（创作共享 · 署名-非商业性使用-相同方式共享）授权：

- ✅ **允许**：分享、复制、修改与演绎
- ✅ **必须署名**原作者（传播与修改时均须署名）
- ✅ **修改必须开源**：衍生作品须基于相同协议发布
- ❌ **禁止商业性使用**

详见 [LICENSE](LICENSE) · [官方许可文本](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode)

*This work is licensed under a Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License. See [LICENSE](LICENSE).*
