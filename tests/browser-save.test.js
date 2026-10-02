/**
 * 便携版核心单测（运行：node tests/browser-save.test.js）
 *
 * 关键点：测试直接 require 被内联进 userscript 的同一份源码；
 * 期望值由独立的 Python 实现算出（跨语言比对），不是自己验自己。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BS = require('../src/lib/browser-save.js');

const ROOT = path.join(__dirname, '..');
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

// ── 独立实现的 ZIP 结构解析（不依赖任何第三方库）──
function parseStoredZip(buf) {
    const u16 = o => buf.readUInt16LE(o);
    const u32 = o => buf.readUInt32LE(o);
    const eocd = buf.length - 22;
    assert.strictEqual(u32(eocd), 0x06054b50, 'EOCD 签名不对');
    const count = u16(eocd + 10);
    const cdSize = u32(eocd + 12);
    const cdOff = u32(eocd + 16);
    assert.strictEqual(cdOff + cdSize, eocd, '中央目录位置/长度与 EOCD 不一致');

    const entries = [];
    let p = cdOff;
    for (let i = 0; i < count; i++) {
        assert.strictEqual(u32(p), 0x02014b50, '中央目录头签名不对');
        const flags = u16(p + 8);
        const method = u16(p + 10);
        const crc = u32(p + 16);
        const csize = u32(p + 20);
        const usize = u32(p + 24);
        const nlen = u16(p + 28);
        const elen = u16(p + 30);
        const clen = u16(p + 32);
        const localOff = u32(p + 42);
        const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');

        assert.strictEqual(u32(localOff), 0x04034b50, '本地头签名不对：' + name);
        assert.strictEqual(u16(localOff + 6), flags, '本地头与中央目录标志位不一致：' + name);
        assert.strictEqual(u16(localOff + 8), method, '本地头与中央目录压缩方式不一致');
        assert.strictEqual(u32(localOff + 14), crc, '本地头与中央目录 CRC 不一致');
        const lNlen = u16(localOff + 26);
        const lElen = u16(localOff + 28);
        const dataStart = localOff + 30 + lNlen + lElen;
        const data = buf.slice(dataStart, dataStart + csize);

        entries.push({
            name, flags, method, crc, csize, usize, data,
            actualCrc: BS.crc32(new Uint8Array(data))
        });
        p += 46 + nlen + elen + clen;
    }
    return entries;
}

console.log('browser-save 单测');

// ── CRC32 ──
check('crc32 标准向量（"123456789" -> 0xCBF43926）', () => {
    assert.strictEqual(BS.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});
check('crc32 空输入 -> 0', () => {
    assert.strictEqual(BS.crc32(new Uint8Array(0)), 0);
});
check('crc32 期望值（0x470B99F4 / 0x3ABCFCEE）', () => {
    assert.strictEqual(BS.crc32(new Uint8Array([1, 2, 3, 4, 5])), 0x470B99F4);
    assert.strictEqual(BS.crc32(Uint8Array.from({ length: 300 }, (_, i) => i & 0xFF)), 0x3ABCFCEE);
});

// ── 文件名规则（必须与本地服务端一致，两个版本产出同样的名字）──
check('hashFileNameFromUrl：去 @ 缩略参数并转 jpg', () => {
    assert.strictEqual(
        BS.hashFileNameFromUrl('https://i0.hdslb.com/bfs/archive/c2c33ea113.jpg@316w_560h_1c.webp'),
        'c2c33ea113.jpg');
});
check('hashFileNameFromUrl：普通原图名保持不变', () => {
    assert.strictEqual(
        BS.hashFileNameFromUrl('https://i1.hdslb.com/bfs/archive/5242750857.jpg'),
        '5242750857.jpg');
});
check('sanitizeFilename：净化非法字符、去掉结尾点与空格', () => {
    assert.strictEqual(BS.sanitizeFilename('b:ad*name?.png'), 'b_ad_name_.png');
    assert.strictEqual(BS.sanitizeFilename('name.  '), 'name');
    assert.strictEqual(BS.sanitizeFilename(''), '_');
});
check('buildZipName：时间戳格式稳定', () => {
    assert.strictEqual(
        BS.buildZipName(new Date(2026, 9, 2, 18, 15, 30)),
        'B站图片_20261002_181530.zip');
});

// ── ZIP：跨语言哈希比对 + 结构自校验 ──
const entries = [
    { name: 'abc123.jpg', data: new Uint8Array([1, 2, 3, 4, 5]) },
    { name: 'def456.png', data: Uint8Array.from({ length: 300 }, (_, i) => i & 0xFF) }
];

const runZipChecks = async () => {
    const blob = BS.zipStore(entries);
    const buf = Buffer.from(await blob.arrayBuffer());

    check('zipStore：Blob 类型为 application/zip', () => {
        assert.strictEqual(blob.type, 'application/zip');
    });
    check('zipStore：总字节数 = 519（与 Python 实现一致）', () => {
        assert.strictEqual(buf.length, 519);
    });
    check('zipStore：SHA-256 与 Python 独立实现一致', () => {
        assert.strictEqual(
            crypto.createHash('sha256').update(buf).digest('hex'),
            '24b56099ad7fa28b7946d4f32a098f368f42a25245a1715dea3ed9dce5a5c56b');
    });
    check('zipStore：结构自校验（签名 / 偏移 / CRC / STORE 方式）', () => {
        const parsed = parseStoredZip(buf);
        assert.strictEqual(parsed.length, 2);
        assert.deepStrictEqual(parsed.map(e => e.name), ['abc123.jpg', 'def456.png']);
        for (const e of parsed) {
            assert.strictEqual(e.method, 0, '必须是 STORE（图片已压缩，不做二次压缩）');
            assert.ok(e.flags & 0x0800, 'EFS(UTF-8) 标志未设置：' + e.name);
            assert.strictEqual(e.csize, e.usize);
            assert.strictEqual(e.actualCrc, e.crc, 'CRC 字段与实际内容不符：' + e.name);
        }
        assert.deepStrictEqual([...parsed[0].data], [1, 2, 3, 4, 5]);
        assert.deepStrictEqual([...parsed[1].data], [...entries[1].data]);
    });
    const cn = Buffer.from(await BS.zipStore([{ name: '测试 图片_01.jpg', data: new Uint8Array([7]) }]).arrayBuffer());
    check('zipStore：非 ASCII 条目名声明 EFS 且能用 UTF-8 原样读回', () => {
        const parsed = parseStoredZip(cn);
        assert.strictEqual(parsed[0].name, '测试 图片_01.jpg');
        assert.ok(parsed[0].flags & 0x0800);
    });
    const empty = Buffer.from(await BS.zipStore([]).arrayBuffer());
    check('zipStore：空集合生成合法空包（22 字节 EOCD）', () => {
        assert.strictEqual(empty.length, 22);
        assert.strictEqual(empty.readUInt32LE(0), 0x06054b50);
    });
    check('zipOverheadBytes：按条目计算额外开销', () => {
        assert.strictEqual(BS.zipOverheadBytes(entries), 22 + (30 + 46) * 2 + (10 + 10) * 2);
    });
    check('planZipBatches：条目数超限自动分包（65535 + 1）', () => {
        const many = Array.from({ length: 0x10000 }, (_, i) => ({ name: 'i' + i + '.jpg', data: new Uint8Array(0) }));
        const batches = BS.planZipBatches(many);
        assert.strictEqual(batches.length, 2);
        assert.strictEqual(batches[0].length, 0xFFFF);
        assert.strictEqual(batches[1].length, 1);
    });
    check('planZipBatches：按体积分包，单条超限单独成批', () => {
        const GB = 1024 * 1024 * 1024;
        const list = [
            { name: 'a.bin', data: { length: 3 * GB } },
            { name: 'b.bin', data: { length: 3 * GB } },
            { name: 'c.bin', data: { length: 5 * GB } }
        ];
        assert.deepStrictEqual(BS.planZipBatches(list).map(b => b.length), [1, 1, 1]);
        assert.deepStrictEqual(BS.planZipBatches(list, 2 * GB).map(b => b.length), [1, 1, 1]);
    });
    check('planZipBatches：小批量不分包', () => {
        const batches = BS.planZipBatches(entries);
        assert.strictEqual(batches.length, 1);
        assert.strictEqual(batches[0].length, entries.length);
    });
    check('zipStore：条目数超过 65535 时明确抛错（不静默产出坏包）', () => {
        const many = Array.from({ length: 0x10000 }, (_, i) => ({ name: 'i' + i + '.jpg', data: new Uint8Array(0) }));
        assert.throws(() => BS.zipStore(many), /65535/);
    });
    check('zipStore：总大小超过 4GB 时明确抛错（不静默产出坏包）', () => {
        assert.throws(() => BS.zipStore([{ name: 'big.bin', data: { length: 4 * 1024 * 1024 * 1024 } }]), /4GB/);
    });
    check('zipStore：文件名超过 65535 字节时明确抛错', () => {
        assert.throws(() => BS.zipStore([{ name: 'x'.repeat(0x10000), data: new Uint8Array(0) }]), /文件名过长/);
    });
};

// ── 构建产物集成检查：内联与模式裁剪是否真的生效 ──
const runBuildChecks = () => {
    const portable = path.join(ROOT, '便携版', 'bilibili-save.user.js');
    const full = path.join(ROOT, 'bilibili-save.user.js');

    check('便携版：已内联库、模式正确、无遗留占位符', () => {
        assert.ok(fs.existsSync(portable), '请先运行 node build.js');
        const t = fs.readFileSync(portable, 'utf8');
        assert.ok(t.includes('__biliBrowserSave') && t.includes('function zipStore') && t.includes('function planZipBatches'), '缺少内联的 browser-save 库（函数体未真正内联？）');
        assert.ok(t.includes("const BUILD_MODE = 'portable'"), 'BUILD_MODE 不是 portable');
        assert.ok(!/@@[^@]+@@/.test(t), '仍有未替换占位符');
    });
    check('便携版：不依赖本地服务、不自动更新到环境版', () => {
        const t = fs.readFileSync(portable, 'utf8');
        assert.ok(!/@connect\s+127\.0\.0\.1/.test(t), '不应再声明 127.0.0.1');
        assert.ok(!t.includes('@updateURL'), '便携版不应自动更新');
    });
    check('环境版：保留本地服务与自动更新', () => {
        const t = fs.readFileSync(full, 'utf8');
        assert.ok(/@connect\s+127\.0\.0\.1/.test(t));
        assert.ok(t.includes('@updateURL'));
        assert.ok(t.includes("const BUILD_MODE = 'full'"));
    });
    check('内置运行环境的便携包已同步（本地存在时才检查）', () => {
        const p = path.join(ROOT, '无需环境直接安装版', 'bilibili-save.user.js');
        if (!fs.existsSync(p)) return;
        assert.ok(fs.readFileSync(p, 'utf8').includes("const BUILD_MODE = 'full'"));
    });
};

(async () => {
    await runZipChecks();
    runBuildChecks();
    console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '，存在失败 ❌' : '，全部通过 ✅'));
})();
