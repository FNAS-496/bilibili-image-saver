# Changelog / 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

All notable changes to this project are documented in this file.

---

## [0.9.0] - 2026-08-08

### Added / 新增
- 「下载成功」打赏面板：下载完成后展示作者、GitHub、邮箱、微信收款码与打赏语「觉得好用的话就打赏一杯奶茶钱吧 ☕」。
- 服务器新增 `GET /qr` 接口：提供 `watermark/` 目录中的收款码图片（支持 png/jpg/webp/gif）。
- 新增 `watermark/` 目录与 `package.json`。

### Removed / 移除
- 移除服务器端图片水印（sharp 依赖及 `applyWatermark`），改为浏览器端打赏面板。

## [0.8.0] - 2026-08-08

### Added / 新增
- 脚本应用到**整个 B 站**（`@match *://*.bilibili.com/*`），不再限制具体路径。
- 新增**智能页面识别** `detectPageType()`：自动判断收藏夹 / 动态列表 / 动态详情 / 作品 / 空间 / 视频等页面类型，仅对含图片的页面自动运行，其余页面零干扰。
- 新增**个人 / 他人空间检测** `detectOwnership()`（通过"编辑资料 / 投稿管理" vs "关注按钮"判断）。

### Changed / 变更
- 自动运行逻辑改为基于页面类型检测，空结果自动重试 3 次（应对 SPA 懒加载）。

## [0.7.0] - 2026-08-08

### Fixed / 修复
- 修复个人动态页无法识别：补全 `<picture><source srcset>` 图片提取。

### Added / 新增
- 动态列表页滚动自动增量保存（`MutationObserver` + scroll）。
- 页面内「⚙️ 保存位置」设置窗口；服务器新增 `/setdir`、`/getdir` 接口。
- 抓取上限提升到 200。

## [0.6.0] - 2026-08-08

### Added / 新增
- 支持动态页（`t.bilibili.com` 详情、`space/.../dynamic` 列表）。
- 自定义保存目录（环境变量 / 命令行参数 / 一键脚本配置）。
- 双语元数据，适配更多浏览器。

## [0.5.0] - 2026-08-08

### Added / 新增
- 自动运行 + 进度浮窗；并发下载；智能去重；一键启动脚本。

## [0.4.0] - 2026-08-08

### Fixed / 修复
- 修复缩略图被过滤、`\u002F` 转义解析、Node 18+ `res.body.pipe` 崩溃等问题，使原图提取真正可用。
