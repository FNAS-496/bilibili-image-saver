#!/usr/bin/env node
/**
 * 发行版打包用的 ZIP 写入器（纯 Node，无第三方依赖）
 *
 * 规矩跟 src/lib/browser-save.js 里的 zipStore 一致：条目名按 UTF-8 编码并置
 * EFS 标志位（0x0800），否则中文文件名在部分解压工具里会变成乱码。
 * 这里多支持 DEFLATE（exe / js / txt 能小一半多），并复用 lib 里那份 CRC32。
 *
 * 用法：writeZip(out, [{ name: '使用说明.txt', src: 'D:\\...' }])
 *      listZip(out) / verifyZip(out) 用于回读校验。
 */
'use strict';

const fs = require('fs');
const zlib = require('zlib');
const { crc32 } = require('../src/lib/browser-save.js');

const ZIP_FLAGS_UTF8 = 0x0800;              // EFS：条目名为 UTF-8
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

// 本身就是压缩格式的内容不再 deflate：省时间，体积也几乎不变
const NO_DEFLATE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif',
    '.mp4', '.m4a', '.zip', '.rar', '.7z', '.gz', '.xz'];

function defaultStore(name) {
    const lower = String(name).toLowerCase();
    return NO_DEFLATE_EXT.some(ext => lower.endsWith(ext));
}

function dosTime(d) {
    // 用 UTC 而不是本地时间：否则同一份源码在不同时区的机器上打出的字节不同（可复现性只在同机同区成立）
    const year = Math.max(1980, d.getUTCFullYear());     // DOS 年份下限是 1980，早于此的文件别写出负数
    const time = ((d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1)) & 0xffff;
    const date = (((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()) & 0xffff;
    return { time, date };
}

function normalize(entry) {
    if (!entry || !entry.name) throw new Error('ZIP 条目缺少 name');
    const name = String(entry.name).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name || name.endsWith('/')) throw new Error('ZIP 条目名不合法：' + entry.name);
    // 拒绝对外逃逸的条目名（zip-slip）：name 由调用方给，别指望调用方永远可信
    if (name.split('/').includes('..')) throw new Error('ZIP 条目名不能含 ".."：' + entry.name);
    if (/^[a-zA-Z]:/.test(name)) throw new Error('ZIP 条目名不能是盘符路径：' + entry.name);
    let data, mtime;
    if (entry.data !== undefined) {
        data = Buffer.from(entry.data);
        mtime = entry.mtime || new Date();
    } else {
        if (!entry.src) throw new Error('ZIP 条目既没有 data 也没有 src：' + name);
        const st = fs.statSync(entry.src);
        if (!st.isFile()) throw new Error('ZIP 只收文件，收到目录：' + entry.src);
        data = fs.readFileSync(entry.src);
        mtime = entry.mtime || st.mtime;
    }
    return { name, data, mtime, store: entry.store === undefined ? defaultStore(name) : !!entry.store };
}

function build(entry) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    if (nameBuf.length > MAX_U16) throw new Error('ZIP 条目名过长：' + entry.name);
    if (entry.data.length > MAX_U32) throw new Error('ZIP 条目超过 4GB：' + entry.name);

    let method = METHOD_STORE;
    let payload = entry.data;
    if (!entry.store) {
        const packed = zlib.deflateRawSync(entry.data, { level: 9 });
        if (packed.length < payload.length) {
            method = METHOD_DEFLATE;
            payload = packed;
        }
    }

    const crc = crc32(entry.data) >>> 0;
    const { time, date } = dosTime(entry.mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);          // 本地头签名
    local.writeUInt16LE(20, 4);                  // 解压所需版本 2.0
    local.writeUInt16LE(ZIP_FLAGS_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);                  // extra 长度
    return { entry, nameBuf, method, crc, payload, local };
}

// 写 ZIP：entry = { name, src|data, store?, mtime? }，name 里的 \ 会统一成 /
function writeZip(outPath, entries) {
    if (!Array.isArray(entries) || !entries.length) throw new Error('ZIP 至少要有一个条目');
    if (entries.length > MAX_U16) throw new Error('ZIP 条目数超过 65535 上限');

    const built = entries.map(normalize).map(build);
    const locals = [], central = [];
    let offset = 0;
    let rawTotal = 0, packedTotal = 0;

    for (const b of built) {
        locals.push(b.local, b.nameBuf, b.payload);
        // 4GB 守卫必须放在写字段之前：writeUInt32LE 越界会抛 ERR_OUT_OF_RANGE，那报错没人看得懂
        if (offset > MAX_U32) throw new Error('ZIP 超过 4GB 上限（本工具不做 Zip64），请拆包');
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);         // 中央目录头签名
        cd.writeUInt16LE(20, 4);                 // 生成者版本 2.0
        cd.writeUInt16LE(20, 6);                 // 解压所需版本 2.0
        cd.writeUInt16LE(ZIP_FLAGS_UTF8, 8);
        cd.writeUInt16LE(b.method, 10);
        cd.writeUInt16LE(b.local.readUInt16LE(10), 12);
        cd.writeUInt16LE(b.local.readUInt16LE(12), 14);
        cd.writeUInt32LE(b.crc, 16);
        cd.writeUInt32LE(b.payload.length, 20);
        cd.writeUInt32LE(b.entry.data.length, 24);
        cd.writeUInt16LE(b.nameBuf.length, 28);
        cd.writeUInt32LE(offset, 42);            // 本地头偏移
        central.push(cd, b.nameBuf);
        offset += b.local.length + b.nameBuf.length + b.payload.length;
        rawTotal += b.entry.data.length;
        packedTotal += b.payload.length;
    }

    const cdOffset = offset;
    let cdSize = 0;
    for (const p of central) cdSize += p.length;
    if (cdOffset > MAX_U32 || cdOffset + cdSize > MAX_U32) {
        throw new Error('ZIP 超过 4GB 上限（本工具不做 Zip64），请拆包');
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(built.length, 8);
    eocd.writeUInt16LE(built.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);

    fs.writeFileSync(outPath, Buffer.concat([...locals, ...central, eocd]));
    const bytes = fs.statSync(outPath).size;
    return {
        path: outPath,
        entries: built.map(b => ({
            name: b.entry.name,
            method: b.method === METHOD_DEFLATE ? 'deflate' : 'store',
            size: b.entry.data.length,
            packed: b.payload.length
        })),
        rawBytes: rawTotal,
        bytes
    };
}

// 读回中央目录（不依赖任何第三方库）
function listZip(file) {
    const buf = fs.readFileSync(file);
    if (buf.length < 22) throw new Error('不是合法的 ZIP（文件太短）：' + file);
    const eocd = buf.length - 22;
    if (buf.readUInt32LE(eocd) !== 0x06054b50) throw new Error('不是合法的 ZIP（找不到 EOCD）：' + file);
    const count = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    if (cdOffset + cdSize !== eocd) throw new Error('中央目录位置/长度与 EOCD 对不上：' + file);

    const entries = [];
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录头签名不对：' + file);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const cmtLen = buf.readUInt16LE(p + 32);
        entries.push({
            name: buf.toString('utf8', p + 46, p + 46 + nameLen),
            flags: buf.readUInt16LE(p + 8),
            method: buf.readUInt16LE(p + 10),
            crc: buf.readUInt32LE(p + 16),
            packed: buf.readUInt32LE(p + 20),
            size: buf.readUInt32LE(p + 24),
            offset: buf.readUInt32LE(p + 42)
        });
        p += 46 + nameLen + extraLen + cmtLen;
    }
    return entries;
}

// 回读校验：本地头 / 压缩方式 / 长度 / 解压后的 CRC 全查一遍（发布前跑，别发坏包）
function verifyZip(file) {
    const buf = fs.readFileSync(file);
    const entries = listZip(file);
    const broken = [];
    for (const e of entries) {
        const o = e.offset;
        if (buf.readUInt32LE(o) !== 0x04034b50) broken.push(e.name + ': 本地头签名不对');
        if (buf.readUInt16LE(o + 8) !== e.method) broken.push(e.name + ': 本地头压缩方式不一致');
        if (buf.readUInt32LE(o + 14) !== e.crc) broken.push(e.name + ': 本地头 CRC 不一致');
        const nameLen = buf.readUInt16LE(o + 26);
        const extraLen = buf.readUInt16LE(o + 28);
        if (buf.toString('utf8', o + 30, o + 30 + nameLen) !== e.name) broken.push(e.name + ': 本地头条目名不一致');
        if (/[^\x20-\x7e]/.test(e.name) && !(e.flags & ZIP_FLAGS_UTF8)) broken.push(e.name + ': 非 ASCII 名没置 EFS 标志');
        const start = o + 30 + nameLen + extraLen;
        if (start + e.packed > buf.length) {           // 条目数据越过文件末尾（截断）——早点说清楚，别让 inflate 抛天书
            broken.push(e.name + ': 条目数据超出文件长度（包被截断了？）');
            continue;
        }
        const raw = buf.subarray(start, start + e.packed);
        const data = e.method === METHOD_DEFLATE ? zlib.inflateRawSync(raw) : raw;
        if (data.length !== e.size) broken.push(e.name + ': 解压后长度不符');
        else if ((crc32(data) >>> 0) !== e.crc) broken.push(e.name + ': 数据 CRC 校验失败');
    }
    if (broken.length) throw new Error('ZIP 自校验失败：\n  ' + broken.join('\n  '));
    return entries;
}

module.exports = { writeZip, listZip, verifyZip, ZIP_FLAGS_UTF8, METHOD_STORE, METHOD_DEFLATE };
