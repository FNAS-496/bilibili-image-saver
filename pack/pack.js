#!/usr/bin/env node
/**
 * 打发行包：先构建，再把两个版本的脚本、运行时、说明装进不同的 zip，统一放到 发行版/。
 *
 *   node pack/pack.js                 打全部发行包
 *   node pack/pack.js --only full     只打某一个（portable / env / full / source）
 *   node pack/pack.js --no-build      跳过构建，直接用现有产物
 *   node pack/pack.js --publish       打完顺手发 GitHub Release（tag = v<package.json 里的版本>）
 *
 * 包里每个文本文件都会插一段【备注】，另外生成「文件说明.txt」逐条说明包内文件。
 * 打完包会逐个条目回读校验 ZIP（结构 + CRC），坏了直接抛错，不发坏包。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { writeZip, verifyZip } = require('./zip.js');
const { annotate, fileNotesText, humanSize, noteFor } = require('./notes.js');
const { publishRelease } = require('./publish.js');

const ROOT = path.join(__dirname, '..');
let OUT_DIR = path.join(ROOT, '发行版');                      // 可用 --out 覆盖（单测会指到临时目录）
const BUNDLE_DIR = path.join(ROOT, '无需环境直接安装版');      // 本地放 node/ffmpeg 的目录（不入库）
const NOTES_FILE = '文件说明.txt';
const USAGE_FILE = '使用说明.txt';
// 生成的说明文档用 package.json 的修改时间当时间戳，这样同样源码打出来的 zip 字节一致（可复现）
const STAMP_MTIME = fs.statSync(path.join(ROOT, 'package.json')).mtime;

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const RUNTIME_BUNDLED = [
    '本包已内置运行环境，装都不用装：',
    '    node\\node.exe          内置 Node.js（本地保存服务用它跑）',
    '    ffmpeg\\ffmpeg.exe      内置 FFmpeg（视频音画合并用）',
    '双击「一键启动.bat」即可，一行都不用配。'
].join('\n');

const RUNTIME_MANUAL = [
    '本包不带运行环境，请自备：',
    '    Node.js（必须）      https://nodejs.org/zh-cn/download',
    '    FFmpeg（可选）       https://www.gyan.dev/ffmpeg/builds/',
    '装好 Node 就行——「一键启动.bat」会自动找到它（在系统 PATH 里即可）。',
    'FFmpeg 用来把视频流和音频流合并成一个 mp4：把 ffmpeg.exe 放到本目录的',
    'ffmpeg\\ffmpeg.exe，或者加进系统 PATH。不装也能下视频，只是音画分开存。'
].join('\n');

const MIN_BUNDLE_SIZE = 1024 * 1024;      // 内置运行时不该这么小，多半是没下完的残包

function rel(abs) {
    return path.relative(ROOT, abs).split(path.sep).join('/');
}

// 把目录里所有文件展开成条目（zip 内路径 = 仓库内相对路径）
function dirItems(relDir) {
    const absDir = path.join(ROOT, relDir);
    if (!fs.existsSync(absDir)) throw new Error('目录不存在：' + relDir);
    const out = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (e.name === '.DS_Store' || e.name === 'Thumbs.db' || e.name === 'desktop.ini') continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else out.push({ to: rel(full), src: full });
        }
    })(absDir);
    return out;
}

function bundleItem(to) {
    return { to, bundle: to };
}

function editionSpecs() {
    const envFiles = [
        { to: '一键启动.bat', src: path.join(ROOT, '一键启动.bat') },
        { to: 'save_images_server.js', src: path.join(ROOT, 'save_images_server.js') },
        { to: 'bilibili-save.user.js', src: path.join(ROOT, 'bilibili-save.user.js') },
        { gen: 'usage' },
        { to: 'LICENSE', src: path.join(ROOT, 'LICENSE') }
    ];

    // key：zip 文件名用（GitHub 附件名会把非 ASCII 字符直接抹掉，所以只用 ASCII）；
    // suffix：zip 里的顶层目录名用（中文，解压出来好看）
    return [
        {
            id: 'portable',
            key: 'portable',
            suffix: '便携版',
            title: '便携版（无需环境）',
            kind: 'portable',
            blurb: '纯浏览器运行，零安装、零端口，图片打包成 ZIP、视频直接下载',
            files: [
                { to: 'bilibili-save.user.js', src: path.join(ROOT, '便携版', 'bilibili-save.user.js') },
                { to: USAGE_FILE, src: path.join(ROOT, '便携版', '使用说明.txt') },
                { to: 'LICENSE', src: path.join(ROOT, 'LICENSE') }
            ]
        },
        {
            id: 'env',
            key: 'env',
            suffix: '环境版',
            title: '环境版（需自备 Node）',
            kind: 'env',
            blurb: '功能最全：4K / 音画合并 / 相册页 / 静默自动落盘，需要自己装 Node（ffmpeg 可选）',
            files: envFiles
        },
        {
            id: 'full',
            key: 'full',
            suffix: '完整版',
            title: '完整版（内置 Node.js + FFmpeg·免配置）',
            kind: 'full',
            blurb: '内置 Node.js 与 FFmpeg，开箱即用，双击「一键启动.bat」就跑',
            needsBundle: true,
            files: [
                { to: '一键启动.bat', src: path.join(ROOT, '一键启动.bat') },
                { to: 'save_images_server.js', src: path.join(ROOT, 'save_images_server.js') },
                { to: 'bilibili-save.user.js', src: path.join(ROOT, 'bilibili-save.user.js') },
                bundleItem('node/node.exe'),
                bundleItem('ffmpeg/ffmpeg.exe'),
                bundleItem('watermark/wechat_qr.jpg'),
                { gen: 'usage' },
                { to: 'LICENSE', src: path.join(ROOT, 'LICENSE') }
            ]
        },
        {
            id: 'source',
            key: 'source',
            suffix: '源码版',
            title: '源码版（含构建与打包工具）',
            kind: 'source',
            blurb: '源码 + 构建/打包/发布工具 + 单测，改完跑 npm run build && npm run pack',
            files: [
                ...dirItems('src'),
                ...dirItems('tests'),
                ...dirItems('pack'),
                { to: 'build.js', src: path.join(ROOT, 'build.js') },
                { to: 'package.json', src: path.join(ROOT, 'package.json') },
                { to: 'README.md', src: path.join(ROOT, 'README.md') },
                { to: 'LICENSE', src: path.join(ROOT, 'LICENSE') },
                { to: '.gitignore', src: path.join(ROOT, '.gitignore') }
            ]
        }
    ];
}

function usageText(spec) {
    const tpl = fs.readFileSync(path.join(__dirname, 'usage-env.txt'), 'utf8');
    return tpl
        .replace(/@@VERSION@@/g, VERSION)
        .replace(/@@EDITION@@/g, spec.title)
        .replace(/@@RUNTIME@@/g, spec.kind === 'full' ? RUNTIME_BUNDLED : RUNTIME_MANUAL);
}

// 把条目读成内存数据（生成的说明文档也在这里拼）
function resolveItems(spec) {
    const missing = [];
    const items = [];
    for (const it of spec.files) {
        if (it.gen === 'usage') {
            items.push({ to: USAGE_FILE, data: Buffer.from(usageText(spec), 'utf8'), mtime: STAMP_MTIME, bundle: false, generated: true });
            continue;
        }
        const src = it.src || (BUNDLE_DIR && it.bundle ? path.join(BUNDLE_DIR, ...it.bundle.split('/')) : null);
        if (!src || !fs.existsSync(src)) {
            missing.push(it.bundle || it.to);
            continue;
        }
        const st = fs.statSync(src);
        const data = fs.readFileSync(src);
        if (it.bundle && it.bundle.endsWith('.exe') && st.size < MIN_BUNDLE_SIZE) {
            console.warn('  注意：' + it.to + ' 只有 ' + st.size + ' B，确认运行时文件是完整的');
        }
        items.push({ to: it.to, data, src, mtime: st.mtime, bundle: !!it.bundle, generated: false });
    }
    if (missing.length) {
        if (spec.needsBundle) return { skipped: '缺少内置运行时：' + missing.join('、') + '（放进 ' + rel(BUNDLE_DIR) + '/ 后重试）' };
        throw new Error('缺少文件：' + missing.join('、'));
    }
    return { items };
}

function buildEdition(spec, outDir = OUT_DIR) {
    const resolved = resolveItems(spec);
    if (resolved.skipped) return { spec, skipped: resolved.skipped };

    const items = resolved.items;
    for (const it of items) it.data = annotate(it.to, it.data, spec.kind);

    const noteItems = items.map(i => ({ name: i.to.split('/').join('\\'), size: i.data.length, note: noteFor(i.to, spec.kind) }));
    noteItems.push({ name: NOTES_FILE, size: null, note: noteFor(NOTES_FILE, spec.kind) });   // 大小得写完才知道，就写「见文件本身」
    items.push({
        to: NOTES_FILE,
        data: Buffer.from(fileNotesText({ version: VERSION, edition: spec.title, items: noteItems }), 'utf8'),
        mtime: STAMP_MTIME,
        bundle: false,
        generated: true
    });

    const folder = 'Bilibili-Plus_v' + VERSION + '_' + spec.suffix;
    const zipPath = path.join(outDir, 'Bilibili-Plus_v' + VERSION + '_' + spec.key + '.zip');
    fs.mkdirSync(outDir, { recursive: true });

    const written = writeZip(zipPath, items.map(i => ({
        name: folder + '/' + i.to,
        data: i.data,
        mtime: i.mtime
    })));
    verifyZip(zipPath);

    return { spec, zipPath, written, items };
}

// 让「无需环境直接安装版」文件夹跟 zip 里保持一致：把包内文件（不含它自带的运行时）
// 刷新过去，免得文件夹里的说明是旧的、说的还是错的
function syncBundleFolder(result) {
    if (!fs.existsSync(BUNDLE_DIR)) return;
    const written = [];
    for (const item of result.items) {
        if (item.bundle) continue;                       // 运行时文件本来就在这个文件夹里，别来回拷 190MB
        const dst = path.join(BUNDLE_DIR, ...item.to.split('/'));
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, item.data);
        written.push(item.to);
    }
    console.log('  已刷新 ' + rel(BUNDLE_DIR) + ' 里的 ' + written.length + ' 个文件（跟 zip 内容一致）');
}

function releaseBody(results) {
    const rows = results.map(r => '| `' + path.basename(r.zipPath) + '` | **' + r.spec.suffix + '** · ' +
        r.spec.blurb + ' | ' + humanSize(r.written.bytes) + ' |');
    const table = ['| 下载包 | 这个包里有什么喵 | 体积 |', '|---|---|---|', ...rows].join('\n');
    return fs.readFileSync(path.join(__dirname, 'release-notes.md'), 'utf8')
        .replace(/@@VERSION@@/g, VERSION)
        .replace(/@@ASSET_TABLE@@/g, table);
}

function main() {
    const args = process.argv.slice(2);
    const flag = n => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
    const only = flag('--only');
    const doPublish = args.includes('--publish');
    const out = flag('--out');
    if (out) OUT_DIR = path.resolve(out);

    if (!args.includes('--no-build')) {
        console.log('构建：node build.js');
        execFileSync(process.execPath, [path.join(ROOT, 'build.js')], { cwd: ROOT, stdio: 'inherit' });
        console.log('');
    }

    let specs = editionSpecs();
    if (only) {
        specs = specs.filter(s => s.id === only);
        if (!specs.length) throw new Error('--only 只支持：portable / env / full / source');
    }

    console.log('打包 → ' + rel(OUT_DIR) + '/');
    const results = [];
    for (const spec of specs) {
        const r = buildEdition(spec);
        if (r.skipped) {
            console.log('  跳过[' + spec.id + '] ' + r.skipped);
            continue;
        }
        results.push(r);
        const srcBytes = r.items.reduce((n, i) => n + i.data.length, 0);
        console.log('  ' + path.basename(r.zipPath).padEnd(38) +
            String(r.items.length).padStart(2) + ' 个文件  ' +
            humanSize(r.written.bytes).padStart(9) + '（解压后 ' + humanSize(srcBytes) + '）');
        if (spec.id === 'full') syncBundleFolder(r);
    }
    if (!results.length) throw new Error('一个包都没打出来');
    console.log('完成：' + results.length + ' 个发行包，全部通过 ZIP 回读校验。');

    if (doPublish) {
        const tag = 'v' + VERSION;
        console.log('\n发布 GitHub Release：' + tag);
        return publishRelease({
            tag,
            name: 'Bilibili-Plus ' + tag + ' 🐾',
            body: releaseBody(results),
            assets: results.map(r => r.zipPath)
        }).then(url => console.log('已发布：' + url));
    }
    return null;
}

module.exports = { VERSION, editionSpecs, buildEdition, usageText, releaseBody, ROOT, BUNDLE_DIR };

if (require.main === module) {
    try {
        const pending = main();
        if (pending && typeof pending.catch === 'function') {
            pending.catch(e => { console.error(e.message); process.exit(1); });
        }
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
}
