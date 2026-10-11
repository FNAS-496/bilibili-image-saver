// ============================================================================
// DASH 音视频合并：把 B 站的 video.m4s + audio.m4s 合成一个能直接播放的 mp4
// 便携版没有 ffmpeg，靠这个模块在浏览器里合并 —— 只重排 mp4 box、不重新编码，
// 所以没有画质损失，也不需要 WebCodecs 那一套。
// 该文件被 build.js 内联进便携版 userscript，同时可直接被 Node require 做单测，
// 保证「测试的代码」与「发布的代码」是同一份。
// 依赖 src/lib/mp4box.min.js（MP4Box.js / gpac/mp4box.js，BSD-3-Clause）
// ============================================================================
(function (root, factory) {
    const api = factory(root);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.__biliDashMerge = api;                         // 供浏览器内自检 / 冒烟测试
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    // 合计超过这个大小就不合并：合并要把音视频两份原始数据 + 输出同时放进内存。
    // 实测（Node，已热身 / --expose-gc）：内存 ≈ 2.32 倍输入 + 9MB 固定开销，耗时约 4.2ms/MB，
    // 所以 512MB 输入的峰值约 1.2GB；再往上（比如 1GB）要 2.4GB，标签页容易崩，不值当。
    // 超限的走「音画分开存」，并提示用户用环境版（服务端 ffmpeg 流式落盘，不吃内存）。
    const MAX_MERGE_BYTES = 512 * 1024 * 1024;

    let cachedMP4Box = null;

    // 取 MP4Box：内联进 userscript 时它在同一作用域；Node 单测时走 require
    function getMP4Box() {
        if (cachedMP4Box) return cachedMP4Box;
        if (typeof MP4BoxLib !== 'undefined' && MP4BoxLib) cachedMP4Box = MP4BoxLib;
        else if (root && root.MP4BoxLib) cachedMP4Box = root.MP4BoxLib;
        else if (typeof require === 'function') {
            try { cachedMP4Box = require('./mp4box.min.js'); } catch (e) { }
        }
        return cachedMP4Box;
    }

    // 各种「字节」形态统一算长度（数字 / ArrayBuffer / TypedArray / Blob）
    function byteLength(bytes) {
        if (typeof bytes === 'number') return bytes > 0 ? bytes : 0;
        if (!bytes) return 0;
        if (typeof bytes.byteLength === 'number') return bytes.byteLength;
        if (typeof bytes.size === 'number') return bytes.size;          // Blob
        if (typeof bytes.length === 'number') return bytes.length;
        return 0;
    }

    // 转成 ArrayBuffer（mp4box 只认 ArrayBuffer）
    function toArrayBuffer(bytes) {
        if (bytes instanceof ArrayBuffer) return bytes;
        if (ArrayBuffer.isView(bytes)) {
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        }
        return new Uint8Array(bytes).buffer;
    }

    function toArrayBufferAsync(bytes) {
        if (typeof Blob !== 'undefined' && bytes instanceof Blob) return bytes.arrayBuffer();
        return Promise.resolve(toArrayBuffer(bytes));
    }

    // 解析一个 DASH 分片（本质是 fMP4）：拿到轨道信息、全部样本，
    // 以及原始 sample entry（avcC / esds 这些解码器参数就在里面，合并时要原样带过去）
    function parseFragment(MP4Box, bytes) {
        return new Promise(function (resolve, reject) {
            const file = MP4Box.createFile();
            const samples = [];
            let info = null;
            let failed = null;
            file.onError = function (e) { failed = failed || ('分片解析失败：' + e); };
            file.onReady = function (i) {
                if (!i || !i.tracks || !i.tracks.length) { failed = failed || '分片里没有找到轨道'; return; }
                info = i;
                const t = i.tracks[0];
                file.setExtractionOptions(t.id, null, { nbSamples: t.nb_samples });
                file.start();
            };
            file.onSamples = function (id, user, list) {
                for (let i = 0; i < list.length; i++) samples.push(list[i]);
            };
            toArrayBufferAsync(bytes).then(function (ab) {
                ab.fileStart = 0;
                file.appendBuffer(ab);
                file.flush();                                    // 样本回调是同步跑完的，下面再让出一次事件循环兜底
                setTimeout(function () {
                    if (failed) { reject(new Error(failed)); return; }
                    if (!info || !samples.length) { reject(new Error('没读到样本数据（可能不是标准 fMP4 分片）')); return; }
                    const trak = file.moov && file.moov.traks && file.moov.traks[0];
                    const entry = trak && trak.mdia.minf.stbl.stsd.entries[0];
                    if (!entry) { reject(new Error('分片缺少 sample entry（解码器参数）')); return; }
                    resolve({ track: info.tracks[0], entry: entry, samples: samples });
                }, 0);
            }, reject);
        });
    }

    // 把两条轨道写进一个新文件：音视频同一个容器，直接就能播
    // 注意 hdlr 必须给对（vide / soun），否则播放器会把音轨当成视频轨
    function buildMerged(MP4Box, v, a) {
        const out = MP4Box.createFile();
        const videoId = out.addTrack({
            hdlr: 'vide', type: v.entry.type,
            timescale: v.track.timescale, duration: v.track.duration,
            width: v.track.video.width, height: v.track.video.height,
            description_boxes: v.entry.boxes
        });
        const audioId = out.addTrack({
            hdlr: 'soun', type: a.entry.type,
            timescale: a.track.timescale, duration: a.track.duration,
            samplerate: a.track.audio.sample_rate,
            channel_count: a.track.audio.channel_count,
            samplesize: a.track.audio.sample_size,
            description_boxes: a.entry.boxes
        });
        if (!videoId || !audioId) {
            throw new Error('不支持的编码组合（' + v.entry.type + ' + ' + a.entry.type + '）');
        }
        const copy = function (trackId, samples) {
            for (let i = 0; i < samples.length; i++) {
                const s = samples[i];
                out.addSample(trackId, s.data, {
                    duration: s.duration, dts: s.dts, cts: s.cts, is_sync: s.is_sync
                });
            }
        };
        copy(videoId, v.samples);
        copy(audioId, a.samples);
        const stream = out.getBuffer();
        const buf = stream && stream.buffer;
        if (!buf || !buf.byteLength) throw new Error('合并输出为空');
        return buf;
    }

    // 该不该尝试合并：体积超限的直接不试，省得下完了才发现白下
    function shouldMerge(totalBytes, maxBytes) {
        const total = byteLength(totalBytes);
        return total > 0 && total <= (maxBytes || MAX_MERGE_BYTES);
    }

    // 合并入口：失败就抛错，由调用方回退成音画分开保存（不能把用户的数据弄丢）
    function mergeDashStreams(videoBytes, audioBytes, maxBytes) {
        const MP4Box = getMP4Box();
        if (!MP4Box) return Promise.reject(new Error('合并组件未加载（请更新到最新版便携版）'));
        const total = byteLength(videoBytes) + byteLength(audioBytes);
        if (!shouldMerge(total, maxBytes)) {
            return Promise.reject(new Error('音视频合计 ' + Math.round(total / 1048576) + 'MB，超出合并上限 ' +
                Math.round((maxBytes || MAX_MERGE_BYTES) / 1048576) + 'MB'));
        }
        return parseFragment(MP4Box, videoBytes).then(function (v) {
            return parseFragment(MP4Box, audioBytes).then(function (a) {
                return buildMerged(MP4Box, v, a);
            });
        });
    }

    return {
        MAX_MERGE_BYTES: MAX_MERGE_BYTES,
        byteLength: byteLength,
        getMP4Box: getMP4Box,
        shouldMerge: shouldMerge,
        mergeDashStreams: mergeDashStreams
    };
});
