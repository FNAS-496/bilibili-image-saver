/**
 * 本地服务单测（运行：node tests/server.test.js）
 *
 * 重点盯防「请求体里的字符串被拼成路径」这一类越界写入：ext / 文件名 / 目标目录。
 * 这些函数是纯函数，require 服务模块时不会监听端口（listen 只在直接运行时发生）。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// require 之前先指定保存目录，免得测试真在桌面建「B站下载」
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-server-test-'));
process.env.BILI_SAVE_DIR = TMP;

const S = require('../save_images_server.js');
const BS = require('../src/lib/browser-save.js');

let passed = 0;
const check = (name, fn) => {
    try {
        fn();
        passed++;
        console.log('  ok   ' + name);
    } catch (e) {
        console.error('  FAIL ' + name + '\n       ' + e.message);
        process.exitCode = 1;
    }
};

console.log('save_images_server 单测');

check('被 require 时不监听端口（端口留给真正启动的那次）', () => {
    assert.strictEqual(S.server.listening, false);
});

check('normalizeVideoExt：只放行扩展名，带路径/多段的输入一律退回 mp4', () => {
    assert.strictEqual(S.normalizeVideoExt('mp4'), 'mp4');
    assert.strictEqual(S.normalizeVideoExt('.M4S'), 'm4s');
    assert.strictEqual(S.normalizeVideoExt('mp4'), 'mp4');
    assert.strictEqual(S.normalizeVideoExt(null), 'mp4');
    assert.strictEqual(S.normalizeVideoExt(''), 'mp4');
    assert.strictEqual(S.normalizeVideoExt('..\\..\\..\\pwn'), 'mp4');
    assert.strictEqual(S.normalizeVideoExt('x/../../pwn'), 'mp4');
    assert.strictEqual(S.normalizeVideoExt('a.b'), 'mp4');
    assert.strictEqual(S.normalizeVideoExt('mp4.exe'), 'mp4');
});

check('assertInsideDir：目录内放行，越界一律拒绝', () => {
    const videoDir = path.join(TMP, 'videos');
    const inside = path.join(videoDir, 'ok.mp4');
    assert.strictEqual(S.assertInsideDir(videoDir, inside), path.resolve(inside));
    // ".tmp_1_v.a/../../../pwn" 会被 path.join 归一化成保存目录之外
    const escape = path.join(videoDir, '.tmp_1_1_v...a', '..', '..', '..', 'pwn');
    assert.throws(() => S.assertInsideDir(videoDir, escape), /拒绝越界写入/);
    assert.throws(() => S.assertInsideDir(videoDir, path.join(TMP, 'other', 'x.mp4')), /拒绝越界写入/);
});

check('safeJoin：先把名字净化掉，再保证不出目录', () => {
    assert.strictEqual(S.safeJoin(TMP, 'ok.png'), path.resolve(TMP, 'ok.png'));
    assert.strictEqual(S.safeJoin(TMP, '..\\..\\pwn.jpg'), path.resolve(TMP, '____pwn.jpg'));
    assert.strictEqual(S.safeJoin(TMP, '/etc/passwd'), path.resolve(TMP, '_etc_passwd'));
});

check('fileNameFromUrl：解码 + 去缩略参数 + 净化，穿越字符不残留', () => {
    assert.strictEqual(S.fileNameFromUrl('https://i0.hdslb.com/bfs/archive/c2c33ea113.jpg@316w_560h_1c.webp'), 'c2c33ea113.jpg');
    assert.strictEqual(S.fileNameFromUrl('https://i1.hdslb.com/bfs/archive/5242750857.jpg'), '5242750857.jpg');
    assert.strictEqual(S.fileNameFromUrl('https://x.com/a/%E4%B8%AD%E6%96%87.jpg'), '中文.jpg');
    assert.strictEqual(S.fileNameFromUrl('https://x.com/..%2F..%2Fpwn.jpg'), '____pwn.jpg');
    assert.strictEqual(S.fileNameFromUrl('not a url'), '');
});

check('fileNameFromUrl 与便携版内核同名（含 %编码 / @缩略 / 穿越 三种输入）', () => {
    const urls = [
        'https://i0.hdslb.com/bfs/archive/c2c33ea113.jpg@316w_560h_1c.webp',
        'https://i1.hdslb.com/bfs/archive/5242750857.jpg',
        'https://x.com/a/%E4%B8%AD%E6%96%87.jpg',
        'https://x.com/..%2F..%2Fpwn.jpg',
        'https://x.com/pic.webp'
    ];
    for (const u of urls) {
        assert.strictEqual(S.fileNameFromUrl(u), BS.hashFileNameFromUrl(u), u);
    }
});

check('normalizeImageUrl：补协议 / 去缩略参数 / webp→jpg / 去 hash', () => {
    assert.strictEqual(S.normalizeImageUrl('//i0.hdslb.com/bfs/a.jpg@100w.webp'), 'https://i0.hdslb.com/bfs/a.jpg');
    assert.strictEqual(S.normalizeImageUrl('https://i0.hdslb.com/bfs/a.webp'), 'https://i0.hdslb.com/bfs/a.jpg');
    assert.strictEqual(S.normalizeImageUrl('https://i0.hdslb.com/bfs/a.jpg#frag'), 'https://i0.hdslb.com/bfs/a.jpg');
});

try {
    fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) { /* 临时目录删不掉不影响结果 */ }

console.log('通过 ' + passed + ' 项' + (process.exitCode ? '，有失败 ❌' : '，全部通过 ✅'));
