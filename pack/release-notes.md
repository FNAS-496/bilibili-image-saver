## 🐾 Bilibili-Plus v@@VERSION@@

B 站原图 / 视频批量下载工具，两个版本任选，四个包任挑：

@@ASSET_TABLE@@

---

### 怎么选喵

- **只想快点用上** → 便携版（`portable`），拖进浏览器就行，零安装喵
- **要 4K / 音画合并 / 相册页** → 环境版或完整版
- **电脑上没装 Node** → 完整版（`full`），里面塞好了 Node 和 ffmpeg，双击 `一键启动.bat` 就能跑
- **想自己改功能** → 源码版（`source`），改 `src/bilibili-save.user.js` 后跑 `npm run build` 与 `npm run pack` 重新打包喵

### 安装喵

1. 浏览器装 [Tampermonkey](https://www.tampermonkey.net/)
2. 把包里的 `bilibili-save.user.js` 拖进浏览器窗口，点「安装」
3. 环境版 / 完整版再双击 `一键启动.bat` 启动本地服务（便携版不用）

每个包里都有一份「使用说明.txt」和「文件说明.txt」：前者讲怎么用，后者把包内每个文件是干啥的写清楚了喵。

### 包里都有啥喵

| 包 | 内容 | 体积 |
|---|---|---|
| `portable` | 只有用户脚本 + 说明 | 几百 KB |
| `env` | 用户脚本 + 本地服务 + 一键启动 | 几百 KB |
| `full` | 上面这些 + 内置 Node.js 与 FFmpeg | 约 70 MB |
| `source` | 源码 + 构建/打包工具 + 单测 | 几百 KB |

> 所有 zip 里的中文文件名都按 UTF-8 并置了 EFS 标志位，解压不会乱码喵；
> 打包时会逐个条目回读校验 CRC，坏包发不出来。

---

**完整变更历史**：见 [提交记录](https://github.com/FNAS-496/bilibili-image-saver/commits/main)
