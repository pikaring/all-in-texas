/*
 * tests/run.js - 役判定・勝率計算・ゲーム進行の自動テスト
 *   node tests/run.js
 */
var path = require('path');
require(path.join(__dirname, '..', 'js', 'cards.js'));
var PK = globalThis.PK;
require(path.join(__dirname, '..', 'js', 'preflop.js'));
require(path.join(__dirname, '..', 'js', 'equity.js'));
require(path.join(__dirname, '..', 'js', 'coach.js'));
require(path.join(__dirname, '..', 'js', 'ai.js'));
require(path.join(__dirname, '..', 'js', 'game.js'));
var cards = PK.cards;

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) pass++; else { fail++; console.log('  NG: ' + msg); }
}
function ev(s) { return cards.evaluate(cards.parseMany(s)); }
function cat(s) { return cards.category(ev(s)); }

console.log('役判定');
ok(cat('As Ks Qs Js Ts') === 8, 'ロイヤル');
ok(cat('5h 4h 3h 2h Ah') === 8, 'ホイール SF');
ok(cards.kicker(ev('5h 4h 3h 2h Ah'), 0) === 3, 'ホイール SF の高位は 5');
ok(cat('9c 9d 9h 9s 2d') === 7, 'クアッズ');
ok(cat('9c 9d 9h 2s 2d') === 6, 'フルハウス');
ok(cat('9c 9d 9h 2s 2d 2c 3c') === 6, '7枚 フルハウス(トリップス2組)');
ok(cards.kicker(ev('2c 2d 2h 9s 9d 9c 3c'), 0) === 7, 'トリップス2組は高い方が本体');
ok(cat('Ah 9h 7h 4h 2h 3c 3d') === 5, 'フラッシュ');
ok(cat('Ah Kd Qc Js Td') === 4, 'ストレート');
ok(cat('Ah 2d 3c 4s 5d') === 4, 'ホイール');
ok(cards.kicker(ev('Ah 2d 3c 4s 5d'), 0) === 3, 'ホイールの高位は 5');
ok(cat('7c 7d 7h Ks 2d') === 3, 'トリップス');
ok(cat('7c 7d Kh Ks 2d') === 2, 'ツーペア');
ok(cat('7c 7d Kh Ks 2d 2c 3c') === 2, '7枚で 3 ペアはツーペア');
ok(cards.kicker(ev('7c 7d Kh Ks 9d 9c 3c'), 2) === 5, '3ペアのキッカーは3番目のペア(7)');
ok(cards.kicker(ev('7c 7d Kh Ks 2d 2c 3c'), 2) === 1, '3ペアでも残りの1枚が高ければそれがキッカー');
ok(cat('7c 7d Kh 9s 2d') === 1, 'ワンペア');
ok(cat('7c 5d Kh 9s 2d') === 0, 'ハイカード');
ok(ev('Ah Kh Qh Jh 9h') < ev('Ah Ad As Ac Kd'), 'フラッシュ < クアッズ');
ok(ev('Ah Ad As Ac Kd') < ev('2h 3h 4h 5h 6h'), 'クアッズ < SF');
ok(ev('Ac Kd Qh 9s 2d') > ev('Ac Kd Qh 8s 7d'), 'ハイカードのキッカー比較');
ok(ev('Tc Td 9h 9s Ad') > ev('Tc Td 9h 9s Kd'), 'ツーペアのキッカー');
ok(ev('Ah Ad 5c 4d 3s 2h 9c') === ev('Ah 5c 4d 3s 2h Kc 9c'), 'ホイールは同値');
ok(cards.describe(ev('Ah Ad 5c 4d 3s')) === 'Aのワンペア', 'describe ワンペア: ' + cards.describe(ev('Ah Ad 5c 4d 3s')));
ok(cards.describe(ev('Kh Ad 5c 4d 3s')) === 'Aハイ', 'describe ハイカード');

// 5 枚全通りの役分布（既知の数）
var deck = cards.newDeck();
var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0];
var t0 = Date.now();
for (var a = 0; a < 48; a++) for (var b = a + 1; b < 49; b++) for (var c = b + 1; c < 50; c++)
  for (var d = c + 1; d < 51; d++) for (var e = d + 1; e < 52; e++)
    counts[cards.category(cards.evaluate([a, b, c, d, e]))]++;
var expected = [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40];
ok(counts.join() === expected.join(), '5枚役分布 ' + counts.join());
console.log('  5枚全通り ' + (Date.now() - t0) + 'ms');

// 7 枚: ランダム比較で bestFive と一致するか
var rng = cards.mulberry32(7);
var mism = 0;
for (var i = 0; i < 3000; i++) {
  var dk = cards.shuffle(cards.newDeck(), rng).slice(0, 7);
  var v1 = cards.evaluate(dk);
  var v2 = cards.evaluate(cards.bestFive(dk));
  if (v1 !== v2) mism++;
}
ok(mism === 0, '7枚評価と最良5枚が一致 (不一致 ' + mism + ')');

console.log('プリフロップ表');
var pf = PK.preflop;
ok(pf.pct('AA') < 1, 'AA は最上位');
ok(pf.pct('72o') > 95, '72o は最下位付近 ' + pf.pct('72o'));
ok(pf.pct('AKs') < pf.pct('AKo'), 'スーテッドの方が上');
ok(pf.rank('AA') === 1, 'AA は 1 位');
ok(pf.pct('JTs') < pf.pct('K3o'), '多人数表で JTs > K3o');

console.log('勝率計算');
var eq = PK.equity.calc(cards.parseMany('Ah Ad'), [], [{ pct: 100 }], 4000, cards.mulberry32(1));
ok(Math.abs(eq.equity - 0.85) < 0.03, 'AA vs ランダム 1人 ≈ 85% (' + (eq.equity * 100).toFixed(1) + ')');
eq = PK.equity.calc(cards.parseMany('Ah Kh'), cards.parseMany('Qh Jh 2c'), [{ pct: 100 }], 4000, cards.mulberry32(2));
ok(eq.equity > 0.6, 'AKs フラッシュ+ガットドロー vs ランダム > 60% (' + (eq.equity * 100).toFixed(1) + ')');
eq = PK.equity.calc(cards.parseMany('2h 7d'), cards.parseMany('Ac Kd Qs Js Ts'), [{ pct: 100 }], 1000, cards.mulberry32(3));
ok(Math.abs(eq.equity - 0.5) < 0.05 && eq.tie > 0.45, 'ボードストレートは引き分け（勝率 50%）' + (eq.tie * 100).toFixed(0) + '%');
// レンジ付き相手
var eqR = PK.equity.calc(cards.parseMany('7h 2d'), [], [{ pct: 10 }], 4000, cards.mulberry32(4));
var eqN = PK.equity.calc(cards.parseMany('7h 2d'), [], [{ pct: 100 }], 4000, cards.mulberry32(5));
ok(eqR.equity < eqN.equity - 0.1, 'タイトなレンジ相手だと 72o の勝率は大きく下がる (' + (eqR.equity * 100).toFixed(1) + ' vs ' + (eqN.equity * 100).toFixed(1) + ')');

var outs = PK.equity.outs(cards.parseMany('Ah Kh'), cards.parseMany('Qh Jh 2c'));
ok(outs.total === 15 || outs.total === 18, 'AKs on QhJh2c: 改善札 ' + outs.total + ' (フラッシュ9+ストレート3、+A/K でペア)');
ok(outs.draws.indexOf('フラッシュドロー') >= 0, 'フラッシュドロー検出: ' + outs.draws.join('/'));
var outs2 = PK.equity.outs(cards.parseMany('9h 8d'), cards.parseMany('7c 6s 2d'));
ok(outs2.draws.indexOf('オープンエンド') >= 0, 'オープンエンド検出: ' + outs2.draws.join('/'));

console.log('ゲーム進行（CPU 同士で 40 ハンド）');
var G = PK.Game;
var g = new G({ seed: 11, speed: 0, opponents: 3, autoHero: true });
var logs = [];
g.onEvent = function (type, data) { if (type === 'log') logs.push(data.message); };
var handsPlayed = 0, chipErr = 0;
g.startGame();
for (var h = 0; h < 40 && !g.gameOver; h++) {
  var total = g.players.reduce(function (s, p) { return s + p.stack; }, 0);
  if (total !== g.startStack * g.players.length) chipErr++;
  handsPlayed++;
  g.runToEnd();
  g.nextHand();
}
var total2 = g.players.reduce(function (s, p) { return s + p.stack; }, 0);
ok(total2 === g.startStack * g.players.length, 'チップ総量が保存される (' + total2 + ')');
ok(chipErr === 0, 'ハンド間でチップが増減しない');
ok(handsPlayed >= 10, 'ハンドが進む (' + handsPlayed + ')');
ok(logs.length > 50, 'ログが出ている (' + logs.length + ')');

// サイドポットの検証
var sp = PK.Game.buildPots([
  { contrib: 100, folded: false, id: 0 },
  { contrib: 300, folded: false, id: 1 },
  { contrib: 500, folded: false, id: 2 },
  { contrib: 500, folded: true, id: 3 }
]);
ok(sp.length === 3, 'サイドポットが 3 つ');
ok(sp[0].amount === 400 && sp[0].eligible.length === 3, 'メインポット 400 (' + sp[0].amount + ')');
ok(sp[1].amount === 600 && sp[1].eligible.length === 2, 'サイド1 600 (' + sp[1].amount + ')');
ok(sp[2].amount === 400 && sp[2].eligible.length === 1, 'サイド2 400 (' + sp[2].amount + ')');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
