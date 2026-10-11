/**
 * 便携版音视频合并单测（运行：node tests/dash-merge.test.js）
 *
 * 最重要的是「合出来的文件真的能播」：把两个真实 fMP4 分片合起来再读回，
 * 确认里面是 1 条视频轨 + 1 条音频轨、编码没变、样本数没丢。
 * 尤其盯 hdlr：写成 vide 的话音轨会被当成视频轨，播放器直接不认（这个坑踩过）。
 * fixture 是 ffmpeg 用 lavfi 生成的黑帧 + 正弦波，才几 KB，直接入库，测试不依赖 ffmpeg。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DM = require('../src/lib/dash-merge.js');
const MP4Box = require('../src/lib/mp4box.min.js');

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
const checkAsync = async (name, fn) => {
    try {
        await fn();
        passed++;
        console.log('  ok   ' + name);
    } catch (e) {
        console.error('  FAIL ' + name + '\n       ' + e.message);
        process.exitCode = 1;
    }
};

const FIX = path.join(__dirname, 'fixtures');
const videoFixture = fs.readFileSync(path.join(FIX, 'video.m4s'));
const audioFixture = fs.readFileSync(path.join(FIX, 'audio.m4s'));

// 用 MP4Box 读回一个 mp4 的轨道信息（合并结果好不好，看这里）
function readTracks(bytes) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    ab.fileStart = 0;
    const file = MP4Box.createFile();
    let info = null;
    file.onReady = i => { info = i; };
    file.appendBuffer(ab);
    file.flush();
    return info;
}

console.log('dash-merge 单测（便携版音视频合并）');

check('byteLength：数字 / TypedArray / ArrayBuffer / Blob 都算得对', () => {
    assert.strictEqual(DM.byteLength(1234), 1234);
    assert.strictEqual(DM.byteLength(0), 0);
    assert.strictEqual(DM.byteLength(-5), 0);
    assert.strictEqual(DM.byteLength(new Uint8Array(8)), 8);
    assert.strictEqual(DM.byteLength(new ArrayBuffer(16)), 16);
    assert.strictEqual(DM.byteLength(new Blob([new Uint8Array(32)])), 32);
    assert.strictEqual(DM.byteLength(null), 0);
});

check('shouldMerge：正常体积放行，超限与非法值挡住', () => {
    assert.strictEqual(DM.shouldMerge(12 * 1024 * 1024), true);
    assert.strictEqual(DM.shouldMerge(DM.MAX_MERGE_BYTES), true);
    assert.strictEqual(DM.shouldMerge(DM.MAX_MERGE_BYTES + 1), false);
    assert.strictEqual(DM.shouldMerge(0), false, '0 字节不该去试合并');
    assert.strictEqual(DM.shouldMerge(undefined), false);
    assert.strictEqual(DM.shouldMerge(5000, 1000), false, '给上限时按上限判断');
});

check('合并上限不能调太大（实测内存约 2.3 倍输入，超了会把标签页搞崩）', () => {
    assert.ok(DM.MAX_MERGE_BYTES <= 512 * 1024 * 1024,
        '上限超过 512MB：按实测「内存 ≈ 2.32 倍输入 + 9MB」，峰值会超过 1.2GB');
    assert.ok(DM.MAX_MERGE_BYTES >= 64 * 1024 * 1024, '上限太小，白白放弃合并能力');
});

check('合并组件可用（MP4Box 已内联 / 可 require）', () => {
    const MP4 = DM.getMP4Box();
    assert.ok(MP4, '取不到 MP4Box');
    assert.strictEqual(typeof MP4.createFile, 'function');
});

check('fixture 本身是合法的 fMP4 分片', () => {
    const v = readTracks(videoFixture);
    const a = readTracks(audioFixture);
    assert.ok(v && a, 'fixture 解析失败');
    assert.strictEqual(v.tracks.length, 1);
    assert.strictEqual(a.tracks.length, 1);
    assert.strictEqual(v.tracks[0].type, 'video');
    assert.strictEqual(a.tracks[0].type, 'audio');
});

(async () => {
    let merged = null;
    await checkAsync('合并两个分片：输出是 1 视频 + 1 音频，编码与样本数都不变', async () => {
        const out = await DM.mergeDashStreams(videoFixture, audioFixture);
        merged = out;
        assert.ok(out && out.byteLength > 0, '合并输出为空');
        const info = readTracks(out);
        assert.ok(info, '合并结果无法解析');
        assert.strictEqual(info.tracks.length, 2, '应该是音视频各一条轨道，实际 ' + info.tracks.length);
        const vt = info.tracks.find(t => t.type === 'video');
        const at = info.tracks.find(t => t.type === 'audio');
        assert.ok(vt, '缺视频轨（hdlr 写成 soun 了？）');
        assert.ok(at, '缺音频轨（hdlr 写成 vide 了？）');
        assert.ok(/^avc1/.test(vt.codec), '视频编码变了：' + vt.codec);
        assert.ok(/^mp4a/.test(at.codec), '音频编码变了：' + at.codec);
        assert.strictEqual(vt.nb_samples, 10, '视频样本数对不上');
        assert.strictEqual(at.nb_samples, 19, '音频样本数对不上');
    });

    await checkAsync('合并结果里参数没丢：分辨率 / 采样率 / 声道', async () => {
        const info = readTracks(merged);
        const vt = info.tracks.find(t => t.type === 'video');
        const at = info.tracks.find(t => t.type === 'audio');
        assert.strictEqual(vt.video.width, 128);
        assert.strictEqual(vt.video.height, 96);
        assert.strictEqual(at.audio.sample_rate, 44100);
        assert.strictEqual(at.audio.channel_count, 1);
    });

    await checkAsync('体积超限直接拒绝（不会先下完再失败）', async () => {
        await assert.rejects(() => DM.mergeDashStreams(videoFixture, audioFixture, 100),
            /超出合并上限/);
    });

    await checkAsync('不是 mp4 的输入会被拒绝，而不是产出坏文件', async () => {
        await assert.rejects(() => DM.mergeDashStreams(Buffer.from('this is definitely not an mp4'), audioFixture),
            /没读到样本数据|分片解析失败|没有找到轨道|sample entry/);
    });

    await checkAsync('分片被截断时会报错（不静默产出残缺文件）', async () => {
        const truncated = audioFixture.slice(0, 900);
        await assert.rejects(() => DM.mergeDashStreams(videoFixture, truncated),
            /没读到样本数据|分片解析失败|没有找到轨道|sample entry|输出为空/);
    });

    console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '，存在失败 ❌' : '，全部通过 ✅'));
})();
