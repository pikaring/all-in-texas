/*
 * coach.js - 初心者モードの解説と推奨アクション
 *
 * advise(ctx) に現在の状況を渡すと、勝率・アウツ・ポットオッズを計算して
 *   { equity, outs, potOdds, action, size, title, reasons[], tip }
 * を返す。判断の根拠を日本語の短文で reasons に並べる。
 *
 * ctx: {
 *   street: 'preflop'|'flop'|'turn'|'river', hero: [c,c], board: [...],
 *   pot: ベット済みの合計（自分の分も含む）, toCall: コールに必要な額,
 *   stack: 自分の残り, bb: ビッグブラインド, position: 'early'|'middle'|'late'|'sb'|'bb',
 *   opps: [{ pct, name }]（まだ降りていない相手）, raised: プリフロップでレイズが入っているか,
 *   limpers: 前にコールだけした人数, minRaise: 最小レイズ後の額, currentBet: 今の最高ベット
 * }
 */
(function (global) {
  'use strict';

  var PK = global.PK || (global.PK = {});
  var C = PK.cards;

  var POS_LABEL = { early: 'アーリー（早い）', middle: 'ミドル', late: 'レイト（遅い）', sb: 'スモールブラインド', bb: 'ビッグブラインド' };

  function pct(x) { return Math.round(x * 100) + '%'; }

  function tierName(p) {
    if (p <= 5) return 'プレミアム';
    if (p <= 15) return '強い';
    if (p <= 30) return 'まずまず';
    if (p <= 50) return '弱め';
    return '弱い';
  }

  function advisePreflop(ctx, eq) {
    var key = C.handClass(ctx.hero[0], ctx.hero[1]);
    var multi = ctx.opps.length >= 2;
    var p = PK.preflop.pct(key, multi);
    var rank = PK.preflop.rank(key, multi);
    var reasons = [];
    var res = { action: 'fold', size: 0, reasons: reasons, handKey: key, handPct: p, handRank: rank };

    reasons.push(key + ' は 169 種中 ' + rank + ' 位（上位 ' + p + '%、' + tierName(p) + '）。');
    reasons.push('ポジションは ' + POS_LABEL[ctx.position] + '。後ろで動けるほど広い手で参加できます。');

    // 参加できる上位%（オープン時）。ポジションで広げる
    var openLimit = { early: 12, middle: 18, late: 28, sb: 22, bb: 28 }[ctx.position];
    var openSize = ctx.bb * 3 + ctx.bb * Math.min(ctx.limpers, 3);

    if (!ctx.raised) {
      if (p <= openLimit) {
        res.action = 'raise';
        res.size = openSize;
        res.title = 'レイズ（' + Math.round(openSize / ctx.bb) + 'BB）';
        reasons.push('まだ誰もレイズしていないので、参加するならレイズで主導権を取ります。' +
          (ctx.limpers ? 'コールだけの人が ' + ctx.limpers + ' 人いるので少し大きめに。' : ''));
      } else if (ctx.position === 'bb' && ctx.toCall === 0) {
        res.action = 'check';
        res.title = 'チェック';
        reasons.push('BB は無料でフロップが見られます。弱い手はチェックで様子見。');
      } else if (ctx.toCall <= ctx.bb && p <= openLimit + 15 && ctx.limpers >= 1 && ctx.position !== 'early') {
        res.action = 'call';
        res.size = ctx.toCall;
        res.title = 'コール（リンプ）';
        reasons.push('コールだけの人がいて安く見られるので、ポットオッズが合う範囲でコールも可。');
      } else {
        res.action = 'fold';
        res.title = 'フォールド';
        reasons.push('このポジションで参加できる目安は上位 ' + openLimit + '% まで。それより弱いので降ります。');
      }
    } else {
      // レイズが入っている
      var callNeed = ctx.toCall / (ctx.pot + ctx.toCall);
      if (p <= 4) {
        res.action = 'raise';
        res.size = Math.max(ctx.minRaise, Math.round(ctx.currentBet * 3));
        res.title = 'リレイズ（3 倍）';
        reasons.push('プレミアムハンドはレイズに対してもさらにレイズして、ポットを大きくします。');
      } else if (p <= 14 || (p <= 22 && callNeed < 0.2)) {
        res.action = 'call';
        res.size = ctx.toCall;
        res.title = 'コール';
        reasons.push('レイズに対しては上位 14% 程度まででコール。' +
          (p > 14 ? 'コール額が小さい（必要勝率 ' + pct(callNeed) + '）ので少し広げています。' : ''));
      } else {
        res.action = 'fold';
        res.title = 'フォールド';
        reasons.push('レイズが入ったら相手は強い手（上位 20% 程度）です。それに勝てる手だけ参加します。');
      }
      // オールインを受けているなら勝率で判断
      if (ctx.toCall >= ctx.stack && eq) {
        var need = ctx.toCall / (ctx.pot + ctx.toCall);
        reasons.push('オールインを受けています。必要勝率 ' + pct(need) + ' に対して推定勝率 ' + pct(eq.equity) + '。');
        if (eq.equity > need + 0.03) { res.action = 'call'; res.title = 'コール（オールイン）'; res.size = ctx.toCall; }
        else { res.action = 'fold'; res.title = 'フォールド'; }
      }
    }
    if (eq) reasons.push('相手 ' + ctx.opps.length + ' 人と最後まで戦った場合の推定勝率は ' + pct(eq.equity) + '。');
    res.tip = 'プリフロップは「どの手で参加するか」が一番大事。ポケットペア・A 絡み・絵札同士・同じスートの連番が基本の参加ハンドです。';
    return res;
  }

  function advisePostflop(ctx, eq, outs) {
    var reasons = [];
    var res = { action: 'check', size: 0, reasons: reasons };
    var handName = C.describe(outs.current);
    var rel = PK.equity.relative(ctx.hero, ctx.board);
    reasons.push('今の役は ' + handName + (rel ? '（' + rel + '）' : '') + '。');
    reasons.push('相手 ' + ctx.opps.length + ' 人の推定レンジに対する勝率は ' + pct(eq.equity) +
      (eq.tie > 0.05 ? '（引き分け ' + pct(eq.tie) + ' 含む）' : '') + '。');

    if (ctx.street !== 'river' && outs.total > 0) {
      var mult = ctx.street === 'flop' ? 4 : 2;
      reasons.push('アウツ（役が上がる札）は ' + outs.total + ' 枚' +
        (outs.draws.length ? '（' + outs.draws.join('・') + '）' : '') +
        '。「' + mult + ' 倍ルール」で約 ' + Math.min(outs.total * mult, 95) + '% が引ける目安。');
    }

    var e = eq.equity;
    var potAfter = ctx.pot;
    if (ctx.toCall > 0) {
      var need = ctx.toCall / (ctx.pot + ctx.toCall);
      res.potOdds = need;
      reasons.push('コール ' + ctx.toCall + ' でポット ' + (ctx.pot + ctx.toCall) + ' → 必要勝率 ' + pct(need) +
        '（コール額 ÷ コール後のポット）。');
      var strongDraw = outs.draws.some(function (d) { return d === 'フラッシュドロー' || d === 'オープンエンド'; });
      if (e >= 0.68 && ctx.stack > ctx.toCall * 2) {
        res.action = 'raise';
        res.size = Math.min(ctx.stack + ctx.myBet, Math.max(ctx.minRaise, Math.round(ctx.currentBet * 2.5 + ctx.pot * 0.3)));
        res.title = 'レイズ';
        reasons.push('勝率が高いので、レイズしてポットを大きくします（バリューレイズ）。');
      } else if (e >= need + 0.04) {
        res.action = 'call';
        res.size = ctx.toCall;
        res.title = 'コール';
        reasons.push('勝率 ' + pct(e) + ' ＞ 必要勝率 ' + pct(need) + ' なので、コールは利益が出る（＋EV）。');
      } else if (e >= need - 0.04 && strongDraw && ctx.street === 'flop') {
        res.action = 'call';
        res.size = ctx.toCall;
        res.title = 'コール（ドロー）';
        reasons.push('必要勝率にわずかに足りませんが、強いドローは引けたときに大きく取れる（インプライドオッズ）ので、コールも可。');
      } else {
        res.action = 'fold';
        res.title = 'フォールド';
        reasons.push('勝率 ' + pct(e) + ' ＜ 必要勝率 ' + pct(need) + '。コールを続けると損なので降ります。');
      }
    } else {
      var betSize = Math.round(potAfter * 0.66);
      var fewOpps = ctx.opps.length <= 2;
      if (e >= 0.62) {
        res.action = 'bet';
        res.size = Math.min(ctx.stack, Math.max(ctx.bb, betSize));
        res.title = 'ベット（ポットの 2/3）';
        reasons.push('勝率が高いので、ベットして相手から取りに行きます（バリューベット）。ポットの 1/2〜2/3 が目安。');
      } else if (e >= 0.45 && outs.draws.length && fewOpps && ctx.street !== 'river') {
        res.action = 'bet';
        res.size = Math.min(ctx.stack, Math.max(ctx.bb, Math.round(potAfter * 0.5)));
        res.title = 'ベット（セミブラフ）';
        reasons.push('今は負けていてもドローがあり、相手が降りれば取れるし、引けば勝てる。両方の道があるベット（セミブラフ）。');
      } else {
        res.action = 'check';
        res.title = 'チェック';
        reasons.push(e < 0.35 ? '勝率が低いので無料で次のカードを見るか、ベットされたら降ります。' :
          '中くらいの手は、無理にベットせずチェックで様子を見ます。');
      }
    }
    res.tip = ctx.street === 'river'
      ? 'リバーはもうドローがありません。今の役の強さだけで「相手より上か」を考えます。'
      : '「勝率 ＞ 必要勝率」ならコールは損しない、が基本のものさしです。';
    return res;
  }

  function advise(ctx, opts) {
    opts = opts || {};
    var trials = opts.trials || (ctx.street === 'preflop' ? 1200 : 1500);
    var eq = PK.equity.calc(ctx.hero, ctx.board, ctx.opps, trials, opts.rng);
    var res;
    if (ctx.street === 'preflop') {
      res = advisePreflop(ctx, eq);
      res.outs = null;
    } else {
      var outs = PK.equity.outs(ctx.hero, ctx.board);
      res = advisePostflop(ctx, eq, outs);
      res.outs = outs;
    }
    res.equity = eq;
    res.handName = C.describe(C.evaluate(ctx.hero.concat(ctx.board)));
    return res;
  }

  PK.coach = { advise: advise, tierName: tierName, POS_LABEL: POS_LABEL };
})(typeof window !== 'undefined' ? window : globalThis);
