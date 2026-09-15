/*
 * ai.js - CPU の打ち方
 *
 * 各 CPU は打ち筋（persona）を持つ:
 *   tight 0..1  参加ハンドの狭さ（1 = 堅い）
 *   aggr  0..1  ベット・レイズの多さ
 *   bluff 0..1  弱い手でベットする頻度
 * 判断は自分の手札・ボード・ポットしか見ない（他家の手札は見ない）。
 * 勝率は少ない試行のモンテカルロで概算する。
 *
 * decide(ctx, persona, rng) -> { action: 'fold'|'check'|'call'|'bet'|'raise', size }
 *   size は bet/raise のとき「そのストリートでの自分のベット合計（到達額）」。
 */
(function (global) {
  'use strict';

  var PK = global.PK || (global.PK = {});
  var C = PK.cards;

  var PERSONAS = [
    { name: 'ビエホ', tag: '堅実', tight: 0.9, aggr: 0.35, bluff: 0.05,
      desc: '強い手でしか参加しない。ベットされたら本当に強い。' },
    { name: 'ディアブロ', tag: '攻撃', tight: 0.5, aggr: 0.9, bluff: 0.3,
      desc: 'よくレイズする。ブラフも多いので、強い手ならコールで釣れる。' },
    { name: 'ゴルド', tag: 'ゆるい', tight: 0.15, aggr: 0.3, bluff: 0.1,
      desc: '広い手でコールする。ベットで降ろしにくいが、強い手で大きく取れる。' },
    { name: 'ヴィニー', tag: '標準', tight: 0.6, aggr: 0.55, bluff: 0.15,
      desc: '教科書どおり。ポジションと手の強さで判断する。' },
    { name: 'ロコ', tag: '気まぐれ', tight: 0.4, aggr: 0.6, bluff: 0.25,
      desc: '読みにくい。同じ場面でも違う行動をとる。' }
  ];

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function decide(ctx, persona, rng) {
    rng = rng || Math.random;
    var p = persona;
    var noise = (rng() - 0.5) * 0.12;   // 同じ手でも少しぶれる
    var toCall = ctx.toCall;
    var stack = ctx.stack;
    var pot = ctx.pot;
    var bb = ctx.bb;

    function raiseTo(mult, potFrac) {
      var target = Math.max(ctx.minRaise, Math.round(ctx.currentBet * mult + pot * potFrac));
      return { action: ctx.currentBet > 0 ? 'raise' : 'bet', size: Math.min(target, stack + ctx.myBet) };
    }

    if (ctx.street === 'preflop') {
      var key = C.handClass(ctx.hero[0], ctx.hero[1]);
      var multi = ctx.opps.length >= 2;
      var hp = PK.preflop.pct(key, multi) + noise * 100;
      var posBonus = { early: 0, middle: 5, late: 12, sb: 6, bb: 10 }[ctx.position] || 0;
      var openLimit = 15 + 35 * (1 - p.tight) + posBonus;     // 15〜62%
      if (ctx.headsUp) openLimit += 30;                         // ヘッズアップは広く
      var raiseLimit = openLimit * (0.35 + 0.35 * p.aggr);
      var shortStack = stack <= bb * 12;

      if (!ctx.raised) {
        // 短いスタックはレイズするなら全部（プッシュ・オア・フォールド）
        if (shortStack && (hp <= openLimit * 0.7 || (ctx.headsUp && hp <= openLimit))) {
          return { action: 'raise', size: stack + ctx.myBet };
        }
        if (hp <= raiseLimit || (hp <= openLimit && rng() < p.aggr * 0.5)) {
          return { action: 'raise', size: Math.min(bb * 3 + bb * ctx.limpers, stack + ctx.myBet) };
        }
        if (hp <= openLimit) return toCall > 0 ? { action: 'call', size: toCall } : { action: 'check' };
        if (toCall === 0) return { action: 'check' };
        return { action: 'fold' };
      }
      // レイズを受けている
      var need = toCall / (pot + toCall);
      var reraiseLimit = 3 + 6 * p.aggr;
      var callLimit = 8 + 22 * (1 - p.tight) + posBonus * 0.5 + (ctx.headsUp ? 15 : 0);
      if (hp <= reraiseLimit && rng() < 0.4 + p.aggr * 0.5) {
        if (shortStack || toCall >= stack * 0.4) return { action: 'raise', size: stack + ctx.myBet };
        return raiseTo(3, 0);
      }
      if (hp <= callLimit || (hp <= callLimit + 12 && need < 0.15)) {
        if (toCall >= stack) return hp <= 12 || need < 0.35 ? { action: 'call', size: toCall } : { action: 'fold' };
        return { action: 'call', size: toCall };
      }
      if (rng() < p.bluff * 0.15 && toCall < stack * 0.2) return raiseTo(3, 0);
      return toCall === 0 ? { action: 'check' } : { action: 'fold' };
    }

    // ポストフロップ：勝率の概算
    var opps = ctx.opps.map(function (o) { return { pct: o.pct }; });
    var eq = PK.equity.calc(ctx.hero, ctx.board, opps, 250, rng).equity + noise;
    var strongThresh = 0.62 + 0.15 * (1 - p.aggr);
    var raiseThresh = 0.75 + 0.1 * (1 - p.aggr);

    if (toCall === 0) {
      if (eq >= strongThresh) {
        var frac = 0.45 + 0.35 * p.aggr + rng() * 0.15;
        return { action: 'bet', size: Math.min(stack, Math.max(bb, Math.round(pot * frac))) };
      }
      if (eq >= 0.4 && rng() < p.aggr * 0.5) {
        return { action: 'bet', size: Math.min(stack, Math.max(bb, Math.round(pot * 0.5))) };
      }
      if (eq < 0.35 && rng() < p.bluff * 0.5 && ctx.opps.length <= 2) {
        return { action: 'bet', size: Math.min(stack, Math.max(bb, Math.round(pot * 0.6))) };
      }
      return { action: 'check' };
    }

    var need2 = toCall / (pot + toCall);
    if (eq >= raiseThresh && rng() < 0.4 + p.aggr * 0.5) {
      if (toCall >= stack * 0.5) return { action: 'raise', size: stack + ctx.myBet };
      return raiseTo(2.5, 0.3);
    }
    var margin = 0.02 + 0.08 * p.tight;
    if (eq >= need2 + margin) return { action: 'call', size: toCall };
    if (eq >= need2 - 0.06 && rng() < 0.35 + 0.4 * (1 - p.tight)) return { action: 'call', size: toCall };
    if (rng() < p.bluff * 0.12 && toCall < pot * 0.5 && ctx.opps.length === 1) return raiseTo(2.5, 0.3);
    return { action: 'fold' };
  }

  PK.ai = { PERSONAS: PERSONAS, decide: decide };
})(typeof window !== 'undefined' ? window : globalThis);
