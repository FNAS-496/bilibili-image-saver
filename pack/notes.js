#!/usr/bin/env node
/**
 * 发行包里的「备注」来源：每个文件干啥用的、能不能改、能不能删。
 *
 * 备注有两处落脚点：
 *   1. 打进 zip 的每个文本文件开头插一小段【备注】（JS / TXT / MD 按各自语法写）；
 *   2. 生成同目录的「文件说明.txt」，把整包文件逐个列出来说明。
 *
 * 新增/改名文件时在这里补一条，pack.js 缺备注会直接报错（宁可不发，也别发一个看不懂的包）。
 */
'use strict';

// 仓库内相对路径（/ 分隔）→ 备注正文
const NOTES = {
    'save_images_server.js': '本地保存服务（默认端口 8765）。浏览器脚本只管页面操作，真正把图片/视频写进硬盘、用 ffmpeg 合并音画、提供图片相册页的都是它。由「一键启动.bat」启动，关掉它的黑窗口就停服务。',
    '一键启动.bat': '双击本文件就完事：检查文件是否齐全 →（缺收款码时）从本文件里释放内嵌的收款码 → 找 Node（优先用本目录 node\\node.exe，没有就用系统装的）→ 启动 save_images_server.js → 打开 B 站。文件末尾那一大串是内嵌的收款码数据，别删别改。（本文件是 GBK 编码，用记事本/VS Code 打开都能正常显示中文。）',
    'node/node.exe': '内置的 Node.js（运行环境）。「一键启动.bat」会优先用它，所以你不用自己装 Node。删了它就得靠系统里的 Node 了。',
    'ffmpeg/ffmpeg.exe': '内置的 FFmpeg，只干一件事：把 B 站分开的视频流和音频流合并成一个带声音的 mp4。删了也不影响图片下载，只是视频可能变成「画面.mp4 + 声音.m4a」两个文件。',
    'watermark/wechat_qr.jpg': '收款码图片：本地服务的 /qr 接口会读它（打赏面板用的是脚本里内嵌的同一张图，所以删掉也不影响打赏；「一键启动.bat」首次运行会自动释放一份）。',
    'LICENSE': '开源协议正文：CC BY-NC-SA 4.0（署名、非商用、改完也要用同样的协议开源）。',
    '文件说明.txt': '就是你正在看的这份：把本包里每个文件是干啥的、能不能删，一条条写清楚。',
    'README.md': '项目总说明：两个版本的区别、功能、安装、常见问题、开发构建，都在这。',
    'package.json': 'Node 项目清单：版本号、入口、以及 npm run build / test / pack 这些命令。',
    '.gitignore': 'Git 忽略清单：下载出来的图片、内置运行时、发行包等不入库的文件都写在这。',
    'build.js': '构建脚本：把 src/ 下的源码生成「环境版」和「便携版」两份用户脚本（npm run build）。',
    'src/bilibili-save.user.js': '用户脚本的唯一手写源码。要加功能、改功能就改它，改完跑 npm run build 重新生成两份产物；直接改生成物会被下次构建覆盖。',
    'src/lib/browser-save.js': '便携版内核源码：文件名转义、ZIP 打包与分批、下载记账（IndexedDB）。构建时会被内联进用户脚本，所以别放 Node 专用代码进来。',
    'src/lib/dash-merge.js': '便携版的音视频合并源码：用 MP4Box 把 DASH 的两条流（video.m4s + audio.m4s）重排成一个能直接播放的 mp4，不重新编码、无画质损失。构建时内联进便携版用户脚本，Node 单测直接 require 同一份文件（保证「测的代码」和「发的代码」是同一份）。',
    'src/lib/mp4box.min.js': '第三方库 MP4Box.js（github.com/gpac/mp4box.js，BSD-3-Clause）的 esbuild 打包产物，只用它的 mp4 解析/封装能力做音视频合并。只内联进便携版；环境版不带它（环境版交给 ffmpeg 合并）。别手改，要升级就重新打包一份。',
    'src/lib/wbi.js': 'B 站 wbi 签名源码（w_rid / wts，内含手写 MD5）：给 playurl 请求加签名以降低风控概率；拿不到两个 key、或带签名取不到数据，会自动退回未签名请求（实测不签名也能正常取流，签名只是锦上添花）。构建时内联进两个版本，Node 单测直接 require 同一份文件。',
    'tests/browser-save.test.js': '便携版内核的单测（npm test）。ZIP 结构的期望值由独立的 Python 实现算出，属于跨语言比对，不是自己验自己；另含取流/清晰度/合并等回归守卫。',
    'tests/dash-merge.test.js': '音视频合并的单测（npm test）：拿 tests/fixtures 里的真实 fMP4 分片合并后读回，确认音视频两条轨都在、编码与样本数不变、超限与坏输入会被明确拒绝。',
    'tests/wbi.test.js': 'wbi 签名的单测（npm test）：MD5 用 RFC 1321 标准向量 + Node 自带 crypto 双重对照，签名串按接口规则逐条断言。',
    'tests/fixtures/video.m4s': '测试用的极小 fMP4 视频分片（ffmpeg 生成的黑帧，约 2KB），只给合并单测用；里面没有任何真实视频内容。',
    'tests/fixtures/audio.m4s': '测试用的极小 fMP4 音频分片（ffmpeg 生成的正弦波，约 3KB），只给合并单测用。',
    'tests/pack.test.js': '打包工具链的单测：ZIP 写入器结构/CRC、备注注入、发行包清单是否齐全。',
    'pack/pack.js': '打包脚本：构建 + 把源码、脚本、运行时按版本装进不同的 zip（npm run pack）。',
    'pack/publish.js': '发布脚本：把 发行版/*.zip 传到 GitHub Release（npm run release）。',
    'pack/zip.js': '打包用的 ZIP 写入器（纯 Node）：中文文件名按 UTF-8 并置 EFS 标志，发布前会回读校验 CRC。',
    'pack/notes.js': '发行包备注表：每个文件是干啥的、能不能改，都写在这里，会注入到包内文件和「文件说明.txt」。',
    'pack/release-notes.md': 'GitHub Release 的发行说明模板（里面 @@VERSION@@ 之类的占位符由 pack.js 替换）。',
    'pack/usage-env.txt': '环境版的使用说明，打包时打进「使用说明.txt」（只有 @@VERSION@@ 会被替换）。',
    'pack/usage-full.txt': '完整版的使用说明，打包时打进「使用说明.txt」（只有 @@VERSION@@ 会被替换）。',
    'pack/usage-source.txt': '源码版的使用说明，打包时打进「使用说明.txt」（只有 @@VERSION@@ 会被替换）。',
    '便携版/使用说明.txt': '便携版的使用说明（手写文档，不是生成物）：仓库里给用户看的是它，打便携版包时也直接用它。'
};

// 名称固定、但内容随版本不同的文件（备注也就跟着版本走）
const BY_KIND = {
    'bilibili-save.user.js': {
        env: '「环境版」浏览器脚本：装进 Tampermonkey 后负责页面功能（原图提取、审查模式、视频面板、已下载标记），下载与落盘交给同目录的 save_images_server.js。有 @updateURL，装好后会自动更新。生成物，别手改。',
        full: '「环境版」浏览器脚本：装进 Tampermonkey 后负责页面功能（原图提取、审查模式、视频面板、已下载标记），下载与落盘交给同目录的 save_images_server.js。有 @updateURL，装好后会自动更新。生成物，别手改。',
        portable: '「便携版」浏览器脚本：一切都在浏览器里跑——图片打包成 ZIP、视频直接下载，高画质（1080P 及以上）会自动把音视频合并成一个 mp4（内置 MP4Box，不需要 ffmpeg），也不连本地服务。不做自动更新（免得被换成需要环境的环境版）。生成物，别手改。'
    },
    '使用说明.txt': {
        env: '本包的使用说明：怎么装、怎么用、文件存哪、常见问题。第一次拿到这个包先看它。',
        full: '本包的使用说明：怎么装、怎么用、文件存哪、常见问题。第一次拿到这个包先看它。',
        portable: '本包的使用说明：怎么装、怎么用、文件存哪、常见问题。第一次拿到这个包先看它。',
        source: '本包的使用说明：需要什么环境、几条命令、代码改哪儿，先看它。'
    }
};

function noteFor(rel, kind) {
    const key = String(rel).replace(/\\/g, '/');
    if (BY_KIND[key] && BY_KIND[key][kind]) return BY_KIND[key][kind];
    if (NOTES[key]) return NOTES[key];
    // 源码版里目录整体收进来时，兜底按目录给一句
    if (key.startsWith('src/')) return '用户脚本源码。改功能改这里，别改生成物。';
    if (key.startsWith('tests/')) return '自动化测试脚本，用来验证内核和打包工具链。';
    if (key.startsWith('pack/')) return '打包/发布工具链的一部分。';
    throw new Error('文件没有备注：' + key + '（请在 pack/notes.js 里补一条，别发看不懂的包）');
}

// 往包内文件里插一段【备注】；返回新的 Buffer（加不了注释的原样返回）
// 注意：
//   ① 「一键启动.bat」是 GBK 编码，备注直接写在源文件里（打包时不动它）；
//   ② 有 `#!` 的文件，备注要插在 shebang 之后，否则 `node 文件` 直接语法错误；
//   ③ 幂等：先去掉上次注入的备注再加，避免「从源码包重打包」时备注层层叠加
//      （比如 pack/usage-*.txt 会变成包里的 使用说明.txt，那一层还会再注入一次）。
const NOTE_JS_RE = /^[ \t]*\/\/ 【备注】[^\r\n]*\r?\n/gm;
const NOTE_TXT_RE = /^【备注】[^\r\n]*\r?\n─+\r?\n/;
const NOTE_HASH_RE = /^# 【备注】[^\r\n]*\r?\n/;
const NOTE_MD_RE = /^> 【备注】[^\r\n]*\r?\n\r?\n/;

function stripInjectedNote(name, text) {
    const lower = name.toLowerCase();
    if (lower.endsWith('.js')) return text.replace(NOTE_JS_RE, '');
    if (lower.endsWith('.txt')) return text.replace(NOTE_TXT_RE, '');
    if (lower.endsWith('.md')) return text.replace(NOTE_MD_RE, '');
    if (lower === '.gitignore') return text.replace(NOTE_HASH_RE, '');
    return text;
}

function insertJsNote(line, text) {
    if (text.startsWith('#!')) {                       // shebang 必须留在第一行
        const nl = text.indexOf('\n');
        return nl === -1 ? text + '\n' + line : text.slice(0, nl + 1) + line + '\n' + text.slice(nl + 1);
    }
    const anchor = '// ==/UserScript==';
    const at = text.indexOf(anchor);
    if (at !== -1) {
        const eol = text.indexOf('\n', at);
        const cut = eol === -1 ? text.length : eol + 1;
        return text.slice(0, cut) + line + '\n' + text.slice(cut);
    }
    return line + '\n' + text;
}

function annotate(rel, data, kind) {
    const name = String(rel).replace(/\\/g, '/');
    const note = noteFor(name, kind);
    const lower = name.toLowerCase();

    if (lower.endsWith('.bat')) return data;            // GBK，备注写源文件里

    const text = stripInjectedNote(name, data.toString('utf8'));
    if (lower.endsWith('.js')) return Buffer.from(insertJsNote('// 【备注】' + note, text), 'utf8');
    if (lower.endsWith('.txt')) return Buffer.from('【备注】' + note + '\n' + '─'.repeat(60) + '\n' + text, 'utf8');
    if (lower.endsWith('.md')) return Buffer.from('> 【备注】' + note + '\n\n' + text, 'utf8');
    if (lower === '.gitignore') return Buffer.from('# 【备注】' + note + '\n' + text, 'utf8');
    return data;                                        // json / 图片等加不了注释，靠「文件说明.txt」
}

function humanSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// 生成「文件说明.txt」正文；items = [{ name, size, note }]
function fileNotesText({ version, edition, items }) {
    const bar = '='.repeat(60);
    const line = '─'.repeat(60);
    const hasReadme = items.some(i => String(i.name).replace(/\\/g, '/').toLowerCase() === 'readme.md');
    const out = [];
    out.push(bar);
    out.push('  Bilibili-Plus v' + version + ' · ' + edition + ' · 文件说明');
    out.push(bar);
    out.push('');
    out.push('  本包共 ' + items.length + ' 个文件，下面一条条说明它们各自是干啥的。');
    out.push('  整个文件夹（或 zip 包）直接发给别人就能用，不用装别的东西。');
    out.push('');
    out.push('  【三条须知】');
    out.push('   1. 写着「生成物」的文件别手改，下次构建会被覆盖；');
    out.push('   2. 写着「本地数据」的目录是你下载的内容，可以放心删；');
    out.push(hasReadme
        ? '   3. 想改功能、重新打包，看 README.md 里的「开发 / 构建」。'
        : '   3. 想改功能、重新打包，去项目主页看「开发 / 构建」那一节（本包不带 README.md）。');
    out.push('');
    out.push(line);
    for (const it of items) {
        const sizeText = it.size == null ? '大小见文件本身' : humanSize(it.size);
        out.push('【文件】' + it.name + '   （' + sizeText + '）');
        out.push('【备注】' + it.note);
        out.push(line);
    }
    out.push('  项目地址：https://github.com/FNAS-496/bilibili-image-saver');
    out.push('  作者：FNAS-496（sijiudeliu@outlook.com）· 许可：CC BY-NC-SA 4.0');
    out.push('');
    return out.join('\n');
}

module.exports = { noteFor, annotate, fileNotesText, humanSize, stripInjectedNote, NOTES, BY_KIND };
