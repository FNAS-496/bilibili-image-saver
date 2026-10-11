# Copilot 指令（本仓库）

## 语言
- **思考过程（reasoning / thinking）和回复一律用中文**。
- 代码注释、提交信息、README 与其它文档沿用仓库现有的中文风格。

## 提交署名
- **提交只署本人**：author、committer 一律为 `FNAS-496 <sijiudeliu@outlook.com>`。
- **不要添加 `Co-authored-by`（尤其 `Co-authored-by: Copilot <…>`）**。
  这类 trailer 会让 GitHub 把 Copilot 记成共同作者、并出现在 Contributors 列表里，
  已经因此重写过一次历史，别再来一次。
- 同理，不要使用任何会把署名指向非本人的自动化（网页端编辑产生的
  `committer: GitHub <noreply@github.com>` 也要避免）。

## 项目速览
- 手写源码只有 `src/bilibili-save.user.js` 和 `src/lib/browser-save.js`；
  根目录的 `bilibili-save.user.js`、`便携版/bilibili-save.user.js` 是 **构建产物，不要手改**。
- 改完源码要跑：`node build.js` 重新生成产物，再跑 `node tests/browser-save.test.js`、
  `node tests/pack.test.js`、`node tests/server.test.js`（等价于 `npm test`）。
- 打包 / 发布：`node pack/pack.js`（构建 + 打包 + ZIP 回读校验，产物在 `发行版/`）；
  `node pack/pack.js --publish`（发 GitHub Release，tag = `v<package.json 版本>`）。
- 发版前 `package.json` 与用户脚本里的 `@version` **必须同步提升**，否则 Tampermonkey
  不会自动更新，已安装的用户收不到修复。
- `发行版/`、`无需环境直接安装版/`、`bilibili_images/` 都是本地产物 / 数据，不入库。
