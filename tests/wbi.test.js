/**
 * wbi 签名单测（运行：node tests/wbi.test.js）
 *
 * md5 是手写的（要同步算签名），所以拿 RFC 1321 的标准向量 + Node 自带 crypto
 * 双重对照，确保「签名用的哈希」本身没算错；签名串的组装按文档规则逐条断言。
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');

const WB = require('../src/lib/wbi.js');

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

console.log('wbi 签名单测');

check('md5：RFC 1321 标准向量', () => {
    assert.strictEqual(WB.md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e');
    assert.strictEqual(WB.md5Hex('a'), '0cc175b9c0f1b6a831c399e269772661');
    assert.strictEqual(WB.md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72');
    assert.strictEqual(WB.md5Hex('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
    assert.strictEqual(WB.md5Hex('abcdefghijklmnopqrstuvwxyz'), 'c3fcd3d76192e4007dfb496cca67e13b');
    assert.strictEqual(WB.md5Hex('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'),
        'd174ab98d277d9f5a5611c2c9f419d9f');
});

check('md5：与 Node crypto 交叉验证（含中文 / 长串 / 边界长度）', () => {
    const samples = [
        '中文测试', 'wbi 签名 w_rid', 'あいうえお',
        'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(57), 'x'.repeat(64), 'x'.repeat(65),
        'x'.repeat(1000), 'a=1&b=2&wts=1700000000'
    ];
    for (const s of samples) {
        const expected = crypto.createHash('md5').update(s, 'utf8').digest('hex');
        assert.strictEqual(WB.md5Hex(s), expected, '不一致：' + JSON.stringify(s));
    }
});

check('getMixinKey：按官方表重排后取前 32 位', () => {
    const orig = Array.from({ length: 64 }, (_, i) => String.fromCharCode(33 + i)).join('');
    const expect = WB.MIXIN_KEY_ENC_TAB.map(i => orig[i]).join('').slice(0, 32);
    const got = WB.getMixinKey(orig);
    assert.strictEqual(got.length, 32);
    assert.strictEqual(got, expect);
    assert.strictEqual(WB.MIXIN_KEY_ENC_TAB.length, 64, '重排表必须是 64 项');
    assert.strictEqual(new Set(WB.MIXIN_KEY_ENC_TAB).size, 64, '重排表不能有重复下标');
});

check('signQuery：参数排序 + 过滤 !\'()* + 带上 w_rid / wts', () => {
    const keys = { imgKey: '7cd084941338484aae1ad9425b84077c', subKey: '4932caff0ff746eab6f01bf08b70ac45' };
    const q = WB.signQuery({ bvid: 'BV1xx411c7mD', cid: 123, fnval: 4048, qn: 127 }, keys.imgKey, keys.subKey, 1700000000);
    assert.ok(/^bvid=BV1xx411c7mD&cid=123&fnval=4048&qn=127&wts=1700000000&w_rid=[0-9a-f]{32}$/.test(q),
        '签名串结构不对：' + q);

    // 签名值与「拼串 + mixinKey 的 md5」必须一致（手算一遍对照）
    const base = 'bvid=BV1xx411c7mD&cid=123&fnval=4048&qn=127&wts=1700000000';
    const mixin = WB.getMixinKey(keys.imgKey + keys.subKey);
    assert.strictEqual(q, base + '&w_rid=' + crypto.createHash('md5').update(base + mixin, 'utf8').digest('hex'));

    // 值里的 !'()* 要过滤掉
    const q2 = WB.signQuery({ t: "a!b'c(d)e*f" }, keys.imgKey, keys.subKey, 1);
    assert.ok(q2.indexOf('t=abcdef') === 0, '特殊字符没过滤：' + q2);
});

check('signQuery：同一组输入结果稳定（wts 决定一切）', () => {
    const keys = { imgKey: 'k'.repeat(32), subKey: 's'.repeat(32) };
    const a = WB.signQuery({ cid: 1, bvid: 'BV1' }, keys.imgKey, keys.subKey, 12345);
    const b = WB.signQuery({ bvid: 'BV1', cid: 1 }, keys.imgKey, keys.subKey, 12345);
    assert.strictEqual(a, b, '参数顺序不该影响结果');
});

check('parseWbiKeys：从 nav 响应的图片地址里取出两个 key', () => {
    const nav = {
        data: {
            wbi_img: {
                img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
                sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'
            }
        }
    };
    const keys = WB.parseWbiKeys(nav);
    assert.ok(keys, '解析失败');
    assert.strictEqual(keys.imgKey, '7cd084941338484aae1ad9425b84077c');
    assert.strictEqual(keys.subKey, '4932caff0ff746eab6f01bf08b70ac45');

    assert.strictEqual(WB.parseWbiKeys(null), null);
    assert.strictEqual(WB.parseWbiKeys({ data: {} }), null);
    assert.strictEqual(WB.parseWbiKeys({ data: { wbi_img: { img_url: 'https://x/y.png' } } }), null,
        '只给一个 key 时应当作拿不到（不能拿半个 key 去签名）');
});

console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '，存在失败 ❌' : '，全部通过 ✅'));
