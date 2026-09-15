/*
 * equity.js - 勝率（エクイティ）とアウツの計算
 *
 * calc(hero, board, opps, trials)
 *   モンテカルロで勝率を求める。opps は相手ごとの { pct } で、
 *   「その相手はスターティングハンド上位 pct% の手を持っている」と仮定して配る
 *   （pct=100 なら完全ランダム）。
 * outs(hero, board)
 *   次の 1 枚で役が上がる札を列挙する（フロップ／ターン用）。
 */
(function (global) {
  'use strict';

  var PK = global.PK || (global.PK = {});
  var C = PK.cards;

  function remainingDeck(known) {
    var used = new Uint8Array(52);
    for (var i = 0; i < known.length; i++) used[known[i]] = 1;
    var d = [];
    for (var c = 0; c < 52; c++) if (!used[c]) d.push(c);
    return d;
  }

  /** 2 枚がレンジ（上位 pct%）に入るか */
  function inRange(c1, c2, pct, multi) {
    if (pct >= 100) return true;
    return PK.preflop.pct(C.handClass(c1, c2), multi) <= pct;
  }

  function calc(hero, board, opps, trials, rng) {
    rng = rng || Math.random;
    trials = trials || 1500;
    var nOpp = opps.length;
    var multi = nOpp >= 2;
    var deck = remainingDeck(hero.concat(board));
    var n = deck.length;
    var needBoard = 5 - board.length;
    var win = 0, tie = 0, lose = 0;

    for (var t = 0; t < trials; t++) {
      // 部分シャッフル：必要枚数ぶんだけ先頭に集める
      var need = needBoard + nOpp * 2;
      for (var i = 0; i < need; i++) {
        var j = i + Math.floor(rng() * (n - i));
        var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
      }
      // レンジ付きの相手は、その位置の 2 枚がレンジに入るまで後ろの札と入れ替える
      var pos = needBoard;
      for (var o = 0; o < nOpp; o++, pos += 2) {
        var pct = opps[o].pct == null ? 100 : opps[o].pct;
        if (pct >= 100) continue;
        for (var tries = 0; tries < 40 && !inRange(deck[pos], deck[pos + 1], pct, multi); tries++) {
          var k1 = need + Math.floor(rng() * (n - need));
          var k2 = need + Math.floor(rng() * (n - need));
          var a = deck[pos]; deck[pos] = deck[k1]; deck[k1] = a;
          var b = deck[pos + 1]; deck[pos + 1] = deck[k2]; deck[k2] = b;
        }
      }
      var full = board.slice();
      for (i = 0; i < needBoard; i++) full.push(deck[i]);
      var hv = C.evaluate(full.concat(hero));
      var ties = 1, lost = false;
      for (o = 0; o < nOpp; o++) {
        var ov = C.evaluate(full.concat([deck[needBoard + o * 2], deck[needBoard + o * 2 + 1]]));
        if (ov > hv) { lost = true; break; }
        if (ov === hv) ties++;
      }
      if (lost) lose++;
      else if (ties === 1) win++;
      else tie += 1 / ties;
    }
    return {
      win: win / trials, tie: tie / trials, lose: lose / trials,
      equity: (win + tie) / trials, trials: trials
    };
  }

  /**
   * 次の 1 枚で役が上がる札（アウツ）
   * 戻り値: { total, groups: [{cat, name, count, cards}], draws: ['フラッシュドロー', ...], current }
   */
  function outs(hero, board) {
    var cur = C.evaluate(hero.concat(board));
    var curCat = C.category(cur);
    var deck = remainingDeck(hero.concat(board));
    var groups = {};
    var total = 0;
    for (var i = 0; i < deck.length; i++) {
      var v = C.evaluate(hero.concat(board, [deck[i]]));
      var vc = C.category(v);
      // 役のカテゴリが上がる札だけをアウツと数える（ただし自分のカードが絡まない
      // ボードだけの改善＝全員共通の改善は除く）
      if (vc <= curCat) continue;
      if (C.category(C.evaluate(board.concat([deck[i]]))) === vc) continue;
      var g = groups[vc] || (groups[vc] = { cat: vc, name: C.CAT_NAMES[vc], count: 0, cards: [] });
      g.count++; g.cards.push(deck[i]);
      total++;
    }
    var list = Object.keys(groups).map(function (k) { return groups[k]; })
      .sort(function (a, b) { return b.cat - a.cat; });

    // ドローの名前
    var draws = [];
    var sfOuts = groups[8] ? groups[8].count : 0;
    var flushOuts = (groups[5] ? groups[5].count : 0) + sfOuts;
    var straightOuts = (groups[4] ? groups[4].count : 0) + sfOuts;
    if (flushOuts >= 9) draws.push('フラッシュドロー');
    else if (flushOuts > 0 && curCat < 5) draws.push('フラッシュドロー');
    if (straightOuts >= 8) draws.push('オープンエンド');
    else if (straightOuts >= 4) draws.push('ガットショット');
    else if (straightOuts > 0) draws.push('ストレートドロー');
    if (curCat === 0 && board.length >= 3) {
      var maxBoard = Math.max.apply(null, board.map(C.rank));
      var over = hero.filter(function (c) { return C.rank(c) > maxBoard; }).length;
      if (over === 2) draws.push('オーバーカード2枚');
      else if (over === 1) draws.push('オーバーカード1枚');
    }
    return { total: total, groups: list, draws: draws, current: cur };
  }

  /** ボードに対する自分の役の「質」を短く言う（トップペア等） */
  function relative(hero, board) {
    if (board.length < 3) return '';
    var v = C.evaluate(hero.concat(board));
    var cat = C.category(v);
    var ranksB = board.map(C.rank).sort(function (a, b) { return b - a; });
    var h1 = C.rank(hero[0]), h2 = C.rank(hero[1]);
    if (cat === 1) {
      var pr = C.kicker(v, 0);
      if (h1 === h2 && h1 === pr) {
        if (pr > ranksB[0]) return 'オーバーペア（ボードより上のポケットペア）';
        if (pr < ranksB[ranksB.length - 1]) return 'アンダーペア（ボードより下のポケットペア）';
        return 'ポケットペア（ボードの間）';
      }
      if (h1 !== pr && h2 !== pr) return 'ボードのペア（誰でも持っている）';
      if (pr === ranksB[0]) return 'トップペア';
      if (pr === ranksB[1]) return 'セカンドペア';
      return 'ボトムペア';
    }
    if (cat === 3) {
      if (h1 === h2) return 'セット（ポケットペアからのスリーカード：強い）';
      return 'トリップス';
    }
    if (cat === 2) {
      var p1 = C.kicker(v, 0), p2 = C.kicker(v, 1);
      if ((h1 === p1 && h2 === p2) || (h1 === p2 && h2 === p1)) return 'ツーペア（手札の 2 枚とも）';
    }
    if (cat >= 4 && board.length >= 5) {
      var bv = C.evaluate(board);
      if (bv === v) return 'ボードの役（引き分けになりやすい）';
    }
    return '';
  }

  PK.equity = { calc: calc, outs: outs, relative: relative, remainingDeck: remainingDeck };
})(typeof window !== 'undefined' ? window : globalThis);
