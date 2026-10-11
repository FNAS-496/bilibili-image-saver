// ============================================================================
// B 站 wbi 签名（w_rid / wts）
//
// 背景：playurl 这类接口从 2023 年起支持 wbi 签名。实测不签名也能正常取流
// （Bilibili-Evolved 同样没签），所以签名在这里只当「锦上添花」：调用方失败就
// 退回未签名请求，绝不影响正常取流。
//
// 顺带把「跟着请求走的 dm_* 指纹参数」排除在外：那是客户端 canvas / WebGL 指纹，
// 伪造值反而更容易被风控盯上，而它在 uscript 里没法真实生成，收益也无法验证。
//
// 该文件被 build.js 内联进 userscript，同时可直接被 Node require 做单测。
// ============================================================================
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.__biliWbi = api;                               // 供浏览器内自检 / 冒烟测试
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 官方前端那把 64 位重排表
    const MIXIN_KEY_ENC_TAB = [
        46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
        27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
        37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
        22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
    ];

    function utf8Bytes(str) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
        const out = [];                                  // 兜底（极老环境）
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            if (c < 0x80) out.push(c);
            else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
            else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
        return Uint8Array.from(out);
    }

    // MD5（RFC 1321）→ 32 位小写 hex。浏览器 crypto.subtle 是异步的，签名要同步算就用这个
    function md5Hex(str) {
        const bytes = utf8Bytes(String(str));
        const len = bytes.length;
        const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
        padded.set(bytes);
        padded[len] = 0x80;                              // 补位：0x80 + 若干 0
        const dv = new DataView(padded.buffer);
        const bits = len * 8;
        dv.setUint32(padded.length - 8, bits >>> 0, true);
        dv.setUint32(padded.length - 4, Math.floor(bits / 4294967296), true);

        const S = [
            7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
            5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
            4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
            6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
        ];
        const K = new Uint32Array(64);
        for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

        let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
        for (let off = 0; off < padded.length; off += 64) {
            const M = new Uint32Array(16);
            for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
            let A = a0, B = b0, C = c0, D = d0;
            for (let i = 0; i < 64; i++) {
                let F, g;
                if (i < 16) { F = (B & C) | (~B & D); g = i; }
                else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
                else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
                else { F = C ^ (B | ~D); g = (7 * i) % 16; }
                F = (F + A + K[i] + M[g]) >>> 0;
                A = D; D = C; C = B;
                B = (B + (((F << S[i]) | (F >>> (32 - S[i]))) >>> 0)) >>> 0;
            }
            a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
        }
        const hex = n => {
            let s = '';
            for (let i = 0; i < 4; i++) s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
            return s;
        };
        return hex(a0) + hex(b0) + hex(c0) + hex(d0);
    }

    // img_key + sub_key 拼成 64 位后按表重排，取前 32 位
    function getMixinKey(orig) {
        let out = '';
        for (let i = 0; i < MIXIN_KEY_ENC_TAB.length; i++) out += orig[MIXIN_KEY_ENC_TAB[i]] || '';
        return out.slice(0, 32);
    }

    // 参数 → 签名 query：按 key 排序、值去掉 !'()* 、拼串、末尾接 mixinKey 再 md5 = w_rid
    function signQuery(params, imgKey, subKey, wts) {
        const mixin = getMixinKey(String(imgKey || '') + String(subKey || ''));
        const stamp = String(wts || Math.round(Date.now() / 1000));
        const all = Object.assign({}, params, { wts: stamp });
        const query = Object.keys(all).sort().map(k => {
            const v = String(all[k] == null ? '' : all[k]).replace(/[!'()*]/g, '');
            return encodeURIComponent(k) + '=' + encodeURIComponent(v);
        }).join('&');
        return query + '&w_rid=' + md5Hex(query + mixin);
    }

    // 从 nav 接口响应里取两个 key（它们藏在图片地址的文件名里）
    function parseWbiKeys(nav) {
        const d = nav && nav.data;
        if (!d) return null;
        const pick = url => {
            const m = String(url || '').match(/\/([^/]+)\.(?:png|jpg|jpeg|webp|gif)$/i);
            return m ? m[1] : null;
        };
        const imgKey = pick(d.wbi_img && d.wbi_img.img_url);
        const subKey = pick(d.wbi_img && d.wbi_img.sub_url);
        return (imgKey && subKey) ? { imgKey: imgKey, subKey: subKey } : null;
    }

    return {
        MIXIN_KEY_ENC_TAB: MIXIN_KEY_ENC_TAB,
        md5Hex: md5Hex,
        getMixinKey: getMixinKey,
        signQuery: signQuery,
        parseWbiKeys: parseWbiKeys
    };
});
