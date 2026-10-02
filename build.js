#!/usr/bin/env node
/**
 * 从单一源文件生成两个版本（单一源 = src/bilibili-save.user.js）
 *
 *   环境版  →  bilibili-save.user.js          （配合 save_images_server.js + 一键启动.bat）
 *   便携版  →  便携版/bilibili-save.user.js   （纯浏览器，零 Node / 零 ffmpeg）
 *
 * 用法：node build.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC_FILE = path.join(ROOT, 'src', 'bilibili-save.user.js');
const LIB_DIR = path.join(ROOT, 'src', 'lib');
const BANNER_ANCHOR = '// ==/UserScript==';

const MODES = {
    full: {
        out: path.join(ROOT, 'bilibili-save.user.js'),
        nameSuffix: '',
        nameSuffixEn: '',
        descSuffix: '；需配合“一键启动.bat”启动本地服务）',
        stripLocalConnect: false,
        keepUpdateUrl: true
    },
    portable: {
        out: path.join(ROOT, '便携版', 'bilibili-save.user.js'),
        nameSuffix: '（便携版·无需环境）',
        nameSuffixEn: ' (Portable)',
        descSuffix: '；便携版纯浏览器运行，无需安装任何环境）',
        stripLocalConnect: true,
        keepUpdateUrl: false      // 便携版不做自动更新，避免被更新成环境版
    }
};

// 内联 src/lib/*.js：把标记行换成库文件内容（缩进对齐宿主）
function inlineLibs(text) {
    const re = /^([ \t]*)\/\* @@INLINE:lib\/([\w.-]+)@@ \*\/[ \t]*$/gm;
    let replaced = 0;
    const out = text.replace(re, (m, indent, file) => {
        replaced++;
        const filePath = path.join(LIB_DIR, file);
        if (!fs.existsSync(filePath)) throw new Error('内联失败，找不到库文件：' + filePath);
        const body = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '');
        const indented = body.split('\n').map(l => (l ? indent + l : l)).join('\n');
        return indented;
    });
    // 一个标记都没匹配到 = 标记被改坏/删掉，直接中止，别把没内联的残次品发出去
    if (!replaced) throw new Error('源文件中未找到任何 /* @@INLINE:lib/...@@ */ 内联标记');
    return out;
}

function applyMode(text, mode, cfg) {
    let out = text
        .replace(/@@MODE@@/g, mode)
        .replace(/@@NAME_SUFFIX@@/g, cfg.nameSuffix)
        .replace(/@@NAME_SUFFIX_EN@@/g, cfg.nameSuffixEn)
        .replace(/@@DESC_SUFFIX@@/g, cfg.descSuffix);

    if (cfg.stripLocalConnect) {
        out = out.replace(/^\/\/ @connect\s+127\.0\.0\.1\s*\r?\n/m, '');
    }
    if (!cfg.keepUpdateUrl) {
        out = out.replace(/^\/\/ @(updateURL|downloadURL)\s+.*\r?\n/gm, '');
    }

    const banner = '// ⚠️ 本文件由 build.js 从 src/bilibili-save.user.js 生成，请勿直接修改；\n' +
        '//    改完源文件后运行 `npm run build` 重新生成（模式：' + mode + '）。\n';
    out = out.replace(BANNER_ANCHOR, BANNER_ANCHOR + '\n' + banner);

    const leftover = out.match(/@@[^@]+@@/g);        // 占位符可能带 : / .（如 @@INLINE:...@@）
    if (leftover) throw new Error('仍有未替换的占位符：' + [...new Set(leftover)].join(', '));
    return out;
}

function main() {
    if (!fs.existsSync(SRC_FILE)) {
        console.error('找不到源文件：' + SRC_FILE);
        process.exit(1);
    }
    const src = fs.readFileSync(SRC_FILE, 'utf8').replace(/\r\n/g, '\n');
    const inlined = inlineLibs(src);
    const libBytes = fs.statSync(path.join(LIB_DIR, 'browser-save.js')).size;

    const results = [];
    for (const [mode, cfg] of Object.entries(MODES)) {
        const out = applyMode(inlined, mode, cfg);
        fs.mkdirSync(path.dirname(cfg.out), { recursive: true });
        fs.writeFileSync(cfg.out, out);
        results.push({ mode, file: path.relative(ROOT, cfg.out), bytes: Buffer.byteLength(out) });
    }

    // 若存在「无需环境直接安装版」（内置 node/ffmpeg 的分发包，不入库），一并同步
    const bundled = path.join(ROOT, '无需环境直接安装版');
    if (fs.existsSync(bundled)) {
        const targets = [
            ['bilibili-save.user.js', 'bilibili-save.user.js'],
            ['save_images_server.js', 'save_images_server.js']
        ];
        for (const [from, to] of targets) {
            const srcPath = path.join(ROOT, from);
            const dstPath = path.join(bundled, to);
            if (fs.existsSync(srcPath)) {
                fs.copyFileSync(srcPath, dstPath);
                results.push({ mode: 'sync', file: path.relative(ROOT, dstPath), bytes: fs.statSync(dstPath).size });
            }
        }
    }

    console.log('源文件      : src/bilibili-save.user.js + src/lib/browser-save.js (' + libBytes + ' B)');
    for (const r of results) {
        console.log(('生成[' + r.mode + ']').padEnd(16) + r.file.padEnd(42) + r.bytes + ' B');
    }
    console.log('完成：共 ' + results.length + ' 个产物。');
}

main();
