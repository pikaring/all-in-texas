/*
 * tools/make_preflop.js - スターティングハンド 169 種の勝率表を生成する
 *
 *   node tools/make_preflop.js  -> app/js/preflop.js
 *
 * 各ハンドについて「ランダムな相手 1 人（ヘッズアップ）」と「ランダムな相手 3 人（4 人打ち）」
 * の勝率をモンテカルロで求め、降順に並べた表を書き出す。
 */
var fs = require('fs');
var path = require('path');
require(path.join(__dirname, '..', 'app', 'js', 'cards.js'));
var C = globalThis.PK.cards;

var TRIALS = 40000;
var rng = C.mulberry32(20260915);

function equityVsRandom(hero, nOpp) {
  var deck = C.newDeck().filter(function (c) { return c !== hero[0] && c !== hero[1]; });
  var win = 0, tie = 0;
  var n = deck.length;
  for (var t = 0; t < TRIALS; t++) {
    var need = 5 + nOpp * 2;
    for (var i = 0; i < need; i++) {
      var j = i + Math.floor(rng() * (n - i));
      var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    var board = [deck[0], deck[1], deck[2], deck[3], deck[4]];
    var hv = C.evaluate(board.concat(hero));
    var best = hv, ties = 1, lost = false;
    for (var o = 0; o < nOpp; o++) {
      var ov = C.evaluate(board.concat([deck[5 + o * 2], deck[6 + o * 2]]));
      if (ov > hv) { lost = true; break; }
      if (ov === hv) ties++;
    }
    if (lost) continue;
    if (ties === 1) win++; else tie += 1 / ties;
  }
  return (win + tie) / TRIALS;
}

var rows = [];
var R = C.RANK_CHARS;
for (var hi = 12; hi >= 0; hi--) {
  for (var lo = hi; lo >= 0; lo--) {
    if (hi === lo) {
      rows.push({ key: R[hi] + R[lo], hero: [C.make(hi, 0), C.make(lo, 1)], combos: 6 });
    } else {
      rows.push({ key: R[hi] + R[lo] + 's', hero: [C.make(hi, 0), C.make(lo, 0)], combos: 4 });
      rows.push({ key: R[hi] + R[lo] + 'o', hero: [C.make(hi, 0), C.make(lo, 1)], combos: 12 });
    }
  }
}
console.log(rows.length + ' hands, ' + TRIALS + ' trials each');
var t0 = Date.now();
rows.forEach(function (row, i) {
  row.hu = equityVsRandom(row.hero, 1);
  row.multi = equityVsRandom(row.hero, 3);
  if (i % 20 === 0) console.log('  ' + i + ' ' + row.key + ' hu=' + row.hu.toFixed(3) + ' multi=' + row.multi.toFixed(3));
});
console.log((Date.now() - t0) / 1000 + 's');

function table(field) {
  var sorted = rows.slice().sort(function (a, b) { return b[field] - a[field]; });
  // 累積コンボ数からパーセンタイル（そのハンドを含む上位何%か）
  var cum = 0;
  return sorted.map(function (r) {
    cum += r.combos;
    return [r.key, Math.round(r[field] * 1000) / 10, Math.round(cum / 1326 * 1000) / 10];
  });
}

var out = '/*\n * preflop.js - スターティングハンド 169 種の勝率表（tools/make_preflop.js で生成）\n' +
  ' *\n * 各要素は [ハンド, ランダム相手に対する勝率%, 上位何%か（そのハンドまでの累積コンボ割合）]。\n' +
  ' * hu = 相手 1 人（ヘッズアップ）、multi = 相手 3 人（4 人打ち）。' + TRIALS + ' 試行のモンテカルロ。\n */\n' +
  '(function (global) {\n  \'use strict\';\n  var PK = global.PK || (global.PK = {});\n' +
  '  var HU = ' + JSON.stringify(table('hu')) + ';\n' +
  '  var MULTI = ' + JSON.stringify(table('multi')) + ';\n' +
  fs.readFileSync(path.join(__dirname, 'preflop_tail.js'), 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'app', 'js', 'preflop.js'), out);
console.log('wrote app/js/preflop.js');
