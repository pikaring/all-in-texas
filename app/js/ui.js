/*
 * ui.js - 画面の描画と操作
 *
 * 状態はすべて game が持ち、update イベントのたびに全体を描き直す。
 * 初心者モードでは自分の手番に PK.coach.advise() を呼び、結果をコーチ欄に出す。
 */
(function (global) {
  'use strict';

  var PK = global.PK;
  var C = PK.cards;
  var SPEEDS = [{ label: '速', ms: 350 }, { label: '普', ms: 700 }, { label: '遅', ms: 1200 }];
  var POS_SHORT = { sb: 'SB', bb: 'BB', early: 'UTG', middle: 'MP', late: 'CO' };
  var STORE_KEY = 'all-in-texas.settings';

  var $ = function (id) { return document.getElementById(id); };
  var game = null;
  var settings = { coach: true, open: false, speed: 1, opps: 3 };
  var logs = [];
  var advice = null;          // 直近のコーチ結果
  var heroTurn = false;
  var betTo = 0;              // スライダーの値（到達額）
  var autoTimer = null;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      Object.keys(settings).forEach(function (k) { if (s[k] != null) settings[k] = s[k]; });
    } catch (e) { /* 使えない環境でも動く */ }
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  /* ---- カードの HTML ---- */
  function cardHtml(c, cls) {
    cls = cls || '';
    if (c == null) return '<div class="card slot ' + cls + '"></div>';
    if (c === 'back') return '<div class="card back ' + cls + '"></div>';
    var s = C.suit(c);
    var red = (s === 1 || s === 2) ? ' red' : '';
    return '<div class="card' + red + ' ' + cls + '"><span class="r">' + C.RANK_LABELS[C.rank(c)] + '</span><span class="s">' + C.SUIT_SYMBOLS[s] + '</span></div>';
  }
  function cardsText(cs) { return cs.map(C.toString).join(' '); }

  /* ---- 描画 ---- */
  function render() {
    if (!game) return;
    renderInfo(); renderOpps(); renderCenter(); renderCoach(); renderLog(); renderSelf(); renderActions();
  }

  function renderInfo() {
    var bl = game.blinds();
    var streetName = PK.Game.STREET_JP[game.street] || '';
    $('infobar').innerHTML =
      '<span class="round">第 ' + game.handNo + ' ハンド</span>' +
      '<span class="stat">ブラインド <b>' + game.sb + '/' + game.bb + '</b></span>' +
      '<span class="stat">Lv' + bl.level + '</span>' +
      '<span class="street">' + streetName + '</span>';
  }

  function posBadge(id) {
    if (game.handOver && game.street === 'showdown') { /* そのまま */ }
    var cls = 'pos' + (id === game.dealer ? ' dealer' : '');
    var label = id === game.dealer ? 'D' : POS_SHORT[game.positionOf(id)] || '';
    if (id === game.dealer && game.alive().length === 2) label = 'D/SB';
    return '<span class="' + cls + '">' + label + '</span>';
  }

  function renderOpps() {
    var opps = game.players.filter(function (p) { return !p.isHero; });
    var box = $('opps');
    box.className = 'opps n' + opps.length;
    var winners = (game.results && game.results.winners) || [];
    var showAll = game.street === 'showdown' || settings.open;
    box.innerHTML = opps.map(function (p) {
      var cls = 'seat';
      if (p.out) cls += ' out';
      else if (p.folded) cls += ' folded';
      if (!game.handOver && game.toAct === p.id) cls += ' active';
      if (game.handOver && winners.indexOf(p.id) >= 0) cls += ' winner';
      var cards;
      if (p.out || !p.cards.length) cards = cardHtml(null, 'mini') + cardHtml(null, 'mini');
      else if (p.folded) cards = settings.open ? cardHtml(p.cards[0], 'mini dim') + cardHtml(p.cards[1], 'mini dim') : cardHtml('back', 'mini dim') + cardHtml('back', 'mini dim');
      else if (showAll || (game.handOver && game.results && game.results.type === 'showdown')) cards = cardHtml(p.cards[0], 'mini') + cardHtml(p.cards[1], 'mini');
      else cards = cardHtml('back', 'mini') + cardHtml('back', 'mini');
      var last = p.lastAction || '';
      var strong = /レイズ|ベット|オールイン/.test(last);
      var hand = '';
      if (!p.folded && !p.out && showAll && game.board.length >= 3) hand = C.describe(C.evaluate(p.cards.concat(game.board)));
      return '<div class="' + cls + '">' +
        '<div class="seat-head"><span class="nm">' + esc(p.name) + '</span><span class="tag">' + esc(p.persona.tag) + '</span>' + (p.out ? '' : posBadge(p.id)) + '</div>' +
        '<div class="seat-body"><div class="cards">' + cards + '</div><span class="stack">' + p.stack + '</span></div>' +
        '<div class="seat-foot">' + (p.bet ? '<span class="bet">▲' + p.bet + '</span>' : '') +
        '<span class="last' + (strong ? ' strong' : '') + '">' + esc(hand || last) + '</span></div>' +
        '</div>';
    }).join('');
  }

  function renderCenter() {
    var b = game.board;
    var html = '<div class="pot">ポット <b>' + game.pot() + '</b>';
    var live = game.players.reduce(function (s, p) { return s + (p.bet || 0); }, 0);
    if (live && !game.handOver) html += ' <span style="opacity:.7">（うち今回のベット ' + live + '）</span>';
    html += '</div><div class="board">';
    var winSet = {};
    if (game.handOver && game.results && game.results.type === 'showdown' && !game.players[0].folded) {
      C.bestFive(game.players[0].cards.concat(b)).forEach(function (c) { winSet[c] = 1; });
    }
    for (var i = 0; i < 5; i++) html += cardHtml(b[i] == null ? null : b[i], winSet[b[i]] ? 'win' : '');
    html += '</div>';
    var res = '';
    if (game.handOver && game.results) {
      res = game.results.pots.map(function (pt) {
        return (pt.label || 'ポット') + ' ' + pt.amount + ' → ' + pt.winners.map(function (id) { return game.players[id].name; }).join('・') +
          (pt.best != null ? '（' + C.describe(pt.best) + '）' : '');
      }).join(' ／ ');
    }
    html += '<div class="result">' + esc(res) + '</div>';
    $('center').innerHTML = html;
  }

  function pct(x) { return Math.round(x * 100) + '%'; }

  function renderCoach() {
    var box = $('coach');
    var hero = game.players[0];
    if (!settings.coach || !hero.cards.length) { box.hidden = true; return; }
    box.hidden = false;

    // ハンド終了：答え合わせ
    if (game.handOver) {
      var html = '<div class="head"><span class="hand">このハンドの結果</span></div>';
      if (game.results && game.results.type === 'showdown') {
        html += '<ul>' + game.inHand().map(function (p) {
          return '<li>' + esc(p.name) + '：' + cardsText(p.cards) + ' → ' + C.describe(game.results.values[p.id]) + '</li>';
        }).join('') + '</ul>';
        if (!hero.folded) {
          var won = game.results.winners.indexOf(0) >= 0;
          html += '<div class="tip">' + (won ? '勝ちました。' : '負けました。') +
            ' 手札 2 枚と共通カード 5 枚から、最も強い 5 枚の組み合わせで比べます（金枠が自分の使った 5 枚）。</div>';
        }
      } else if (game.results) {
        var w = game.players[game.results.winners[0]];
        html += '<div>' + esc(w.name) + ' 以外が全員降りたので、勝負せずに ' + esc(w.name) + ' の勝ち。</div>';
        if (hero.folded && settings.open) html += '<div class="sub">「透視」が ON なので、降りた相手の手札も見えています。</div>';
        else if (!hero.folded) html += '<div class="tip">相手を降ろして取るのも立派な勝ち方。ベットは「強い手で取る」だけでなく「相手を降ろす」道具でもあります。</div>';
      }
      box.innerHTML = html;
      return;
    }

    if (hero.folded) {
      box.innerHTML = '<div class="head"><span class="hand">降りました</span><span class="sub">次のハンドまで見学</span></div>';
      return;
    }
    if (!advice) {
      box.innerHTML = '<div class="head"><span class="hand">' + esc(C.handClass(hero.cards[0], hero.cards[1])) + '</span><span class="sub">相手の手番…</span></div>';
      return;
    }
    var a = advice;
    var recCls = { fold: 'fold', check: 'check', call: 'call', bet: 'bet', raise: 'raise' }[a.action];
    var h = '<div class="head"><span class="rec ' + recCls + '">' + esc(a.title || a.action) + '</span>' +
      '<span class="hand">' + (game.street === 'preflop' ? esc(a.handKey) : esc(a.handName)) + '</span>' +
      (!heroTurn ? '<span class="sub">（直前の手番の分析）</span>' : '') + '</div>';
    var eq = a.equity;
    h += '<div class="bar"><div class="w" style="width:' + (eq.win * 100) + '%">' + (eq.win > 0.12 ? '勝 ' + pct(eq.win) : '') + '</div>' +
      '<div class="t" style="width:' + (eq.tie * 100) + '%">' + (eq.tie > 0.12 ? '分 ' + pct(eq.tie) : '') + '</div>' +
      '<div class="l" style="width:' + (eq.lose * 100) + '%">' + (eq.lose > 0.12 ? '負 ' + pct(eq.lose) : '') + '</div></div>';
    h += '<div class="stats"><span>勝率 <b>' + pct(eq.equity) + '</b></span>';
    if (a.potOdds != null) h += '<span>必要勝率 <b>' + pct(a.potOdds) + '</b></span>';
    if (a.handPct != null) h += '<span>ハンド順位 <b>' + a.handRank + '/169</b>（上位 ' + a.handPct + '%）</span>';
    if (a.outs && a.outs.total) h += '<span>アウツ <b>' + a.outs.total + ' 枚</b></span>';
    h += '</div>';
    if (a.outs && a.outs.total) {
      h += a.outs.groups.map(function (g) {
        return '<div class="outs"><span class="lbl">' + esc(g.name) + 'になる札 ' + g.count + '</span>' +
          g.cards.slice(0, 13).map(function (c) { return cardHtml(c, 'mini'); }).join('') + '</div>';
      }).join('');
    }
    h += '<ul>' + a.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
    if (a.tip) h += '<div class="tip">💡 ' + esc(a.tip) + '</div>';
    box.innerHTML = h;
  }

  function renderLog() {
    var box = $('log');
    box.innerHTML = logs.slice(-40).map(function (l) { return '<div class="' + l.cls + '">' + esc(l.message) + '</div>'; }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function renderSelf() {
    var p = game.players[0];
    var cls = 'self';
    if (!game.handOver && game.toAct === 0) cls += ' active';
    if (game.handOver && game.results && game.results.winners.indexOf(0) >= 0) cls += ' winner';
    var cards = p.cards.length ? cardHtml(p.cards[0], 'hero' + (p.folded ? ' dim' : '')) + cardHtml(p.cards[1], 'hero' + (p.folded ? ' dim' : '')) : cardHtml(null, 'hero') + cardHtml(null, 'hero');
    var handName = '';
    if (p.cards.length && !p.folded) {
      handName = game.board.length >= 3 ? C.describe(C.evaluate(p.cards.concat(game.board))) : C.handClass(p.cards[0], p.cards[1]);
      var rel = game.board.length >= 3 ? PK.equity.relative(p.cards, game.board) : '';
      if (rel) handName += '・' + rel.split('（')[0];
    }
    $('self').className = cls;
    $('self').innerHTML = '<div class="cards">' + cards + '</div>' +
      '<div class="info"><div class="nm">あなた ' + (p.out ? '' : posBadge(0)) + '</div>' +
      '<div class="stack">' + p.stack + (p.allIn ? ' <span style="font-size:11px;color:#e2564a">オールイン</span>' : '') + '</div>' +
      (p.bet ? '<div class="bet">▲ ベット ' + p.bet + '</div>' : '') +
      '<div class="handname">' + esc(p.folded ? 'フォールド' : handName) + '</div></div>';
  }

  function presetTo(frac) {
    var p = game.players[0];
    var la = game.legalActions(p);
    if (!la.raise) return 0;
    var base = game.pot() + la.call;
    var to = game.currentBet + Math.round(base * frac);
    return Math.max(la.raise.min, Math.min(la.raise.max, to));
  }

  function renderActions() {
    var box = $('actions');
    if (game.gameOver) {
      box.innerHTML = '<div class="row"><button class="btn primary" data-act="new-game">もう一度</button></div>';
      return;
    }
    if (game.handOver) {
      box.innerHTML = '<div class="row"><button class="btn primary" data-act="next-hand">次のハンド ▶</button></div>';
      return;
    }
    var p = game.players[0];
    if (!heroTurn || game.toAct !== 0) {
      box.innerHTML = '<div class="wait">' + (p.folded ? '見学中' : (p.allIn ? 'オールイン中' : '相手の手番…')) + '</div>';
      return;
    }
    var la = game.legalActions(p);
    var rec = advice ? advice.action : '';
    var html = '<div class="row">';
    html += '<button class="btn' + (rec === 'fold' ? ' rec' : '') + '" data-act="fold"' + (la.fold ? '' : ' disabled') + '>フォールド</button>';
    if (la.check) html += '<button class="btn' + (rec === 'check' ? ' rec' : '') + '" data-act="check">チェック</button>';
    else html += '<button class="btn' + (rec === 'call' ? ' rec' : '') + '" data-act="call">コール ' + la.call + (la.call >= p.stack ? '（全額）' : '') + '</button>';
    if (la.raise) {
      var isBet = game.currentBet === 0;
      var lbl = betTo >= la.raise.max ? 'オールイン ' + la.raise.max : (isBet ? 'ベット ' : 'レイズ → ') + betTo;
      html += '<button class="btn warn' + ((rec === 'bet' || rec === 'raise') ? ' rec' : '') + '" data-act="raise">' + lbl + '</button>';
    }
    html += '</div>';
    if (la.raise) {
      html += '<div class="sizer">' +
        '<button class="btn" data-size="min">最小</button>' +
        '<button class="btn" data-size="0.5">1/2</button>' +
        '<button class="btn" data-size="0.75">3/4</button>' +
        '<button class="btn" data-size="1">ポット</button>' +
        '<button class="btn" data-size="max">全額</button>' +
        '<input type="range" id="bet-range" min="' + la.raise.min + '" max="' + la.raise.max + '" step="1" value="' + betTo + '">' +
        '<input class="amt" id="bet-amt" type="number" min="' + la.raise.min + '" max="' + la.raise.max + '" value="' + betTo + '">' +
        '</div>';
    }
    box.innerHTML = html;
  }

  function setBetTo(v) {
    var la = game.legalActions(game.players[0]);
    if (!la.raise) return;
    betTo = Math.max(la.raise.min, Math.min(la.raise.max, Math.round(v) || la.raise.min));
    renderActions();
  }

  /* ---- コーチの計算 ---- */
  function computeAdvice() {
    var p = game.players[0];
    if (!settings.coach || p.folded || !p.cards.length) { advice = null; return; }
    var ctx = game.contextFor(p);
    advice = PK.coach.advise(ctx);
  }

  /* ---- ゲーム側のイベント ---- */
  function onEvent(type, data) {
    if (type === 'log') { logs.push(data); if (logs.length > 200) logs.shift(); return; }
    if (type === 'hero-turn') {
      heroTurn = true;
      computeAdvice();
      var la = game.legalActions(game.players[0]);
      if (la.raise) {
        var rec = advice && (advice.action === 'bet' || advice.action === 'raise') ? advice.size : 0;
        var def = game.street === 'preflop'
          ? (game.raised ? game.currentBet * 3 : game.bb * 3 + game.bb * game.limpers)
          : presetTo(0.66);
        betTo = Math.max(la.raise.min, Math.min(la.raise.max, rec || def));
      }
      render();
      return;
    }
    if (type === 'street') {
      // 相手の手番でも新しいカードが開いたら解説を更新しておく
      if (settings.coach && !game.players[0].folded) computeAdvice();
    }
    if (type === 'hand-end') {
      heroTurn = false;
      render();
      clearTimeout(autoTimer);
      // 自分が降りていたハンドは自動で次へ
      if (game.players[0].folded && !game.gameOver) {
        autoTimer = setTimeout(function () { if (game.handOver && !game.gameOver) game.nextHand(); }, 2200);
      }
      return;
    }
    if (type === 'game-over') {
      render();
      showGameOver(data);
      return;
    }
    render();
  }

  function showGameOver(data) {
    var g = game;
    var hero = g.players[0];
    var html = '<h2>ゲーム終了</h2>';
    html += '<div class="big">' + (data.rank === 1 ? '🏆 優勝！' : data.rank + ' 位') + '</div>';
    html += '<div class="detail">' + data.hands + ' ハンドで決着。' +
      (data.rank === 1 ? '全員のチップを獲得しました。' : 'チップが尽きました。') + '</div>';
    html += '<div class="result-list" style="margin-top:8px">' + g.players.map(function (p) {
      return esc(p.name) + '：' + p.stack + (p.out ? '（退場）' : '');
    }).join('<br>') + '</div>';
    html += '<div style="margin-top:12px;text-align:right"><button class="btn" data-act="close-sheet">閉じる</button> ' +
      '<button class="btn primary" data-act="new-game">もう一度</button></div>';
    $('sheet').innerHTML = html;
    $('overlay').hidden = false;
  }

  /* ---- ハンド表 ---- */
  function renderChart() {
    var grid = $('chart-grid');
    var R = C.RANK_CHARS;
    var hero = game && game.players[0].cards.length ? C.handClass(game.players[0].cards[0], game.players[0].cards[1]) : '';
    var html = '';
    for (var i = 12; i >= 0; i--) {
      for (var j = 12; j >= 0; j--) {
        var key;
        if (i === j) key = R[i] + R[j];
        else if (i > j) key = R[i] + R[j] + 's';   // 右上（列が低い）＝スーテッド
        else key = R[j] + R[i] + 'o';
        var p = PK.preflop.pct(key, true);
        var t = p <= 5 ? 't1' : p <= 15 ? 't2' : p <= 30 ? 't3' : p <= 50 ? 't4' : 't5';
        html += '<div class="' + t + (key === hero ? ' cur' : '') + '" data-key="' + key + '">' + key + '</div>';
      }
    }
    grid.innerHTML = html;
    $('chart-info').textContent = hero ? describeKey(hero) : 'マスを押すと順位と勝率が出ます';
  }
  function describeKey(key) {
    var pf = PK.preflop;
    return key + '：4人打ち ' + pf.rank(key, true) + ' 位（上位 ' + pf.pct(key, true) + '%、勝率 ' + pf.eq(key, true) + '%）／ヘッズアップ ' +
      pf.rank(key, false) + ' 位（勝率 ' + pf.eq(key, false) + '%）';
  }

  function renderCharList() {
    $('char-list').innerHTML = PK.ai.PERSONAS.map(function (c) {
      return '<div class="char"><div class="char-top"><b>' + esc(c.name) + '</b><span class="tag">' + esc(c.tag) + '</span>' +
        '<span class="nums">堅さ ' + c.tight + '・攻め ' + c.aggr + '・ブラフ ' + c.bluff + '</span></div>' +
        '<div class="char-desc">' + esc(c.desc) + '</div></div>';
    }).join('');
  }

  /* ---- 操作 ---- */
  function newGame() {
    if (game) game.stop();
    clearTimeout(autoTimer);
    logs = []; advice = null; heroTurn = false;
    game = new PK.Game({ speed: SPEEDS[settings.speed].ms, opponents: settings.opps, onEvent: onEvent });
    $('overlay').hidden = true;
    game.startGame();
    render();
  }

  function updateButtons() {
    var q = function (act) { return document.querySelector('.topbar [data-act="' + act + '"]'); };
    q('coach').textContent = '初心者:' + (settings.coach ? 'ON' : 'OFF');
    q('coach').classList.toggle('on', settings.coach);
    q('open').textContent = '透視:' + (settings.open ? 'ON' : 'OFF');
    q('open').classList.toggle('on', settings.open);
    q('speed').textContent = '速度:' + SPEEDS[settings.speed].label;
    q('opps').textContent = '相手:' + settings.opps;
  }

  function onClick(e) {
    var sz = e.target.closest('[data-size]');
    if (sz && game) {
      var v = sz.getAttribute('data-size');
      var la = game.legalActions(game.players[0]);
      if (!la.raise) return;
      if (v === 'min') setBetTo(la.raise.min);
      else if (v === 'max') setBetTo(la.raise.max);
      else setBetTo(presetTo(parseFloat(v)));
      return;
    }
    var cell = e.target.closest('[data-key]');
    if (cell) { $('chart-info').textContent = describeKey(cell.getAttribute('data-key')); return; }

    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    switch (act) {
      case 'new-game': newGame(); break;
      case 'next-hand': clearTimeout(autoTimer); if (game && game.handOver) game.nextHand(); break;
      case 'fold': case 'check': case 'call':
        if (game && heroTurn) { heroTurn = false; game.act(0, act); }
        break;
      case 'raise':
        if (game && heroTurn) { heroTurn = false; game.act(0, game.currentBet === 0 ? 'bet' : 'raise', betTo); }
        break;
      case 'coach':
        settings.coach = !settings.coach; saveSettings(); updateButtons();
        if (settings.coach && game && heroTurn) computeAdvice();
        render();
        break;
      case 'open':
        settings.open = !settings.open; saveSettings(); updateButtons(); render();
        break;
      case 'speed':
        settings.speed = (settings.speed + 1) % SPEEDS.length; saveSettings(); updateButtons();
        if (game) game.speed = SPEEDS[settings.speed].ms;
        break;
      case 'opps':
        settings.opps = settings.opps % 5 + 1; saveSettings(); updateButtons();
        if (!game || game.gameOver || confirm('相手の人数を ' + settings.opps + ' 人にして新しいゲームを始めますか？')) newGame();
        break;
      case 'chart': renderChart(); $('chart-overlay').hidden = false; break;
      case 'close-chart': $('chart-overlay').hidden = true; break;
      case 'rules': $('rules-overlay').hidden = false; break;
      case 'close-rules': $('rules-overlay').hidden = true; break;
      case 'close-sheet': $('overlay').hidden = true; break;
    }
  }

  function onInput(e) {
    if (e.target.id === 'bet-range' || e.target.id === 'bet-amt') {
      var la = game.legalActions(game.players[0]);
      if (!la.raise) return;
      betTo = Math.max(la.raise.min, Math.min(la.raise.max, Math.round(parseFloat(e.target.value)) || la.raise.min));
      // スライダー操作中は再描画せず、対になる入力と見出しだけ更新
      var other = e.target.id === 'bet-range' ? $('bet-amt') : $('bet-range');
      if (other) other.value = betTo;
      var rb = document.querySelector('.actions [data-act="raise"]');
      if (rb) rb.textContent = betTo >= la.raise.max ? 'オールイン ' + la.raise.max : (game.currentBet === 0 ? 'ベット ' : 'レイズ → ') + betTo;
    }
  }

  function init() {
    loadSettings();
    updateButtons();
    renderCharList();
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    newGame();
  }

  PK.ui = { init: init, get game() { return game; }, get settings() { return settings; } };
})(window);
