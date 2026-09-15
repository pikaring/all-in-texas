/*
 * cards.js - カードの表現と 5〜7 枚の役判定
 *
 * カードは 0〜51 の整数。rank = c >> 2（0=2 … 12=A）、suit = c & 3（s h d c）。
 * evaluate() は役の強さを 1 つの整数で返す（大きいほど強い）。
 *   (category << 20) | (k1 << 16) | (k2 << 12) | (k3 << 8) | (k4 << 4) | k5
 * category: 0 ハイカード … 8 ストレートフラッシュ
 */
(function (global) {
  'use strict';

  var PK = global.PK || (global.PK = {});

  var RANK_CHARS = '23456789TJQKA';
  var RANK_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  var SUIT_CHARS = 'shdc';
  var SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];
  var CAT_NAMES = ['ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート',
    'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ'];

  function rank(c) { return c >> 2; }
  function suit(c) { return c & 3; }
  function make(r, s) { return (r << 2) | s; }
  function toString(c) { return RANK_CHARS[rank(c)] + SUIT_CHARS[suit(c)]; }
  function parse(s) {
    var r = RANK_CHARS.indexOf(s[0].toUpperCase());
    var su = SUIT_CHARS.indexOf(s[1].toLowerCase());
    if (r < 0 || su < 0) throw new Error('bad card: ' + s);
    return make(r, su);
  }
  function parseMany(s) {
    return s.trim().split(/[\s,]+/).filter(Boolean).map(parse);
  }

  function newDeck() {
    var d = [];
    for (var i = 0; i < 52; i++) d.push(i);
    return d;
  }
  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** 決定的な乱数（テスト用） */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---- 役判定 ---------------------------------------------------------- */

  // ビットマスク（bit r = ランク r がある）からストレートの最高ランクを返す。無ければ -1
  function straightHigh(mask) {
    // A を 5 の下にも置く（A2345）
    var m = (mask << 1) | ((mask >> 12) & 1);
    for (var h = 13; h >= 4; h--) {
      if (((m >> (h - 4)) & 31) === 31) return h - 1;
    }
    return -1;
  }

  // マスクから上位 n ランクを取り出して 4bit ずつ詰める
  function topRanks(mask, n) {
    var v = 0, cnt = 0;
    for (var r = 12; r >= 0 && cnt < n; r--) {
      if (mask & (1 << r)) { v = (v << 4) | r; cnt++; }
    }
    while (cnt < 5) { v <<= 4; cnt++; }
    return v;
  }

  function pack(cat, ranks) {
    var v = cat << 20;
    for (var i = 0; i < 5; i++) v |= ((ranks[i] == null ? 0 : ranks[i]) << (16 - 4 * i));
    return v;
  }

  function evaluate(cards) {
    var rc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var sc = [0, 0, 0, 0];
    var mask = 0;
    var n = cards.length;
    for (var i = 0; i < n; i++) {
      var c = cards[i];
      rc[c >> 2]++; sc[c & 3]++; mask |= 1 << (c >> 2);
    }
    // フラッシュ（ストレートフラッシュ判定を先に）
    var flushSuit = -1;
    for (var s = 0; s < 4; s++) if (sc[s] >= 5) { flushSuit = s; break; }
    if (flushSuit >= 0) {
      var fmask = 0;
      for (i = 0; i < n; i++) if ((cards[i] & 3) === flushSuit) fmask |= 1 << (cards[i] >> 2);
      var sh = straightHigh(fmask);
      if (sh >= 0) return (8 << 20) | (sh << 16);
      var flushVal = (5 << 20) | topRanks(fmask, 5);
    }
    var quads = -1, trips = [], pairs = [];
    for (var r = 12; r >= 0; r--) {
      if (rc[r] === 4) quads = r;
      else if (rc[r] === 3) trips.push(r);
      else if (rc[r] === 2) pairs.push(r);
    }
    if (quads >= 0) {
      var k = topRanks(mask & ~(1 << quads), 1) >> 16;
      return pack(7, [quads, k]);
    }
    if (trips.length && (trips.length >= 2 || pairs.length)) {
      var pr = trips.length >= 2 ? trips[1] : pairs[0];
      return pack(6, [trips[0], pr]);
    }
    if (flushSuit >= 0) return flushVal;
    var st = straightHigh(mask);
    if (st >= 0) return pack(4, [st]);
    if (trips.length) {
      var rest = mask & ~(1 << trips[0]);
      return (3 << 20) | (trips[0] << 16) | (topRanks(rest, 2) >> 4);
    }
    if (pairs.length >= 2) {
      var rest2 = mask & ~(1 << pairs[0]) & ~(1 << pairs[1]);
      var kk = topRanks(rest2, 1) >> 16;
      return pack(2, [pairs[0], pairs[1], kk]);
    }
    if (pairs.length === 1) {
      var rest3 = mask & ~(1 << pairs[0]);
      var t3 = topRanks(rest3, 3); // k1<<16 | k2<<12 | k3<<8
      return (1 << 20) | (pairs[0] << 16) | (t3 >> 4);
    }
    return (0 << 20) | topRanks(mask, 5);
  }

  function category(value) { return value >> 20; }
  function kicker(value, i) { return (value >> (16 - 4 * i)) & 15; }

  /** 役の日本語説明（例: "Aのワンペア"、"Kハイ"） */
  function describe(value) {
    var cat = category(value);
    var k1 = RANK_LABELS[kicker(value, 0)];
    var k2 = RANK_LABELS[kicker(value, 1)];
    switch (cat) {
      case 0: return k1 + 'ハイ';
      case 1: return k1 + 'のワンペア';
      case 2: return k1 + 'と' + k2 + 'のツーペア';
      case 3: return k1 + 'のスリーカード';
      case 4: return k1 + 'ハイのストレート';
      case 5: return k1 + 'ハイのフラッシュ';
      case 6: return k1 + 'と' + k2 + 'のフルハウス';
      case 7: return k1 + 'のフォーカード';
      case 8: return kicker(value, 0) === 12 ? 'ロイヤルフラッシュ' : k1 + 'ハイのストレートフラッシュ';
    }
    return '';
  }

  /** 7 枚の中から役を構成する 5 枚を返す（表示のハイライト用） */
  function bestFive(cards) {
    if (cards.length <= 5) return cards.slice();
    var best = -1, bestSet = null;
    var n = cards.length;
    for (var a = 0; a < n - 4; a++)
      for (var b = a + 1; b < n - 3; b++)
        for (var c = b + 1; c < n - 2; c++)
          for (var d = c + 1; d < n - 1; d++)
            for (var e = d + 1; e < n; e++) {
              var set = [cards[a], cards[b], cards[c], cards[d], cards[e]];
              var v = evaluate(set);
              if (v > best) { best = v; bestSet = set; }
            }
    return bestSet;
  }

  /** スターティングハンドの表記（AKs / AKo / 77） */
  function handClass(c1, c2) {
    var r1 = rank(c1), r2 = rank(c2);
    var hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    if (hi === lo) return RANK_CHARS[hi] + RANK_CHARS[lo];
    return RANK_CHARS[hi] + RANK_CHARS[lo] + (suit(c1) === suit(c2) ? 's' : 'o');
  }

  PK.cards = {
    RANK_CHARS: RANK_CHARS, RANK_LABELS: RANK_LABELS, SUIT_SYMBOLS: SUIT_SYMBOLS, CAT_NAMES: CAT_NAMES,
    rank: rank, suit: suit, make: make, toString: toString, parse: parse, parseMany: parseMany,
    newDeck: newDeck, shuffle: shuffle, mulberry32: mulberry32,
    evaluate: evaluate, category: category, kicker: kicker, describe: describe, bestFive: bestFive,
    handClass: handClass
  };
})(typeof window !== 'undefined' ? window : globalThis);
