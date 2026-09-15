/*
 * game.js - ノーリミット・テキサスホールデムのゲームエンジン
 *
 * ルール:
 *   - シット＆ゴー方式。自分 + CPU（1〜5 人）。持ちチップ 3000、ブラインドは 8 ハンドごとに上がる
 *   - チップが尽きた人は退場。自分が飛ぶか、CPU が全員飛んだら終了
 *   - サイドポットあり。引き分けはポットを等分（端数はディーラーに近い人へ）
 *   - ヘッズアップではディーラーがスモールブラインドを出し、プリフロップは先に、それ以降は後に行動する
 *
 * イベント: log / update / hero-turn / hand-end / game-over
 */
(function (global) {
  'use strict';

  var PK = global.PK || (global.PK = {});
  var C = PK.cards;

  var BLIND_LEVELS = [[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200],
    [150, 300], [200, 400], [300, 600], [500, 1000], [1000, 2000]];
  var HANDS_PER_LEVEL = 8;
  var STREETS = ['preflop', 'flop', 'turn', 'river'];
  var STREET_JP = { preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー', showdown: 'ショーダウン' };

  function Game(opts) {
    opts = opts || {};
    this.onEvent = opts.onEvent || function () {};
    this.speed = opts.speed == null ? 700 : opts.speed;
    this.seed = opts.seed;
    this.nOpp = Math.max(1, Math.min(5, opts.opponents || 3));
    this.startStack = opts.startStack || 3000;
    this.autoHero = !!opts.autoHero;   // テスト用：自分も CPU が打つ
    this.heroPersona = opts.heroPersona || null;
    this.timer = null;
    this.players = [];
  }

  Game.prototype.emit = function (type, data) { this.onEvent(type, data || {}); };
  Game.prototype.log = function (msg, cls) { this.emit('log', { message: msg, cls: cls || '' }); };

  Game.prototype.schedule = function (fn) {
    var self = this;
    clearTimeout(this.timer);
    if (this.speed === 0) { fn.call(self); return; }
    this.timer = setTimeout(function () { fn.call(self); }, this.speed);
  };
  Game.prototype.stop = function () { clearTimeout(this.timer); };

  /* ---- ゲーム開始 --------------------------------------------------------- */

  Game.prototype.startGame = function () {
    var self = this;
    this.rng = this.seed != null ? C.mulberry32(this.seed) : Math.random;
    var personas = PK.ai.PERSONAS.slice();
    C.shuffle(personas, this.rng);
    this.players = [];
    // テスト用に自分の席へ打ち筋を割り当てられる（heroPersona）
    var hp = this.heroPersona || null;
    this.players.push({ id: 0, name: hp ? hp.name : 'あなた', isHero: true, persona: hp, stack: this.startStack });
    if (hp) personas = personas.filter(function (q) { return q !== hp; });
    for (var i = 0; i < this.nOpp; i++) {
      var pe = personas[i % personas.length];
      this.players.push({ id: i + 1, name: pe.name, isHero: false, persona: pe, stack: this.startStack });
    }
    this.players.forEach(function (p) { p.out = false; p.cards = []; });
    this.handNo = 0;
    this.dealer = Math.floor(this.rng() * this.players.length);
    this.gameOver = false;
    this.handOver = true;
    this.log('ゲーム開始。持ちチップ ' + this.startStack + '、ブラインド ' + BLIND_LEVELS[0].join('/'), 'hl');
    this.startHand();
  };

  Game.prototype.blinds = function () {
    var lv = Math.min(BLIND_LEVELS.length - 1, Math.floor(this.handNo / HANDS_PER_LEVEL));
    return { sb: BLIND_LEVELS[lv][0], bb: BLIND_LEVELS[lv][1], level: lv + 1 };
  };

  Game.prototype.alive = function () { return this.players.filter(function (p) { return !p.out; }); };
  Game.prototype.inHand = function () { return this.players.filter(function (p) { return !p.out && !p.folded; }); };
  Game.prototype.canAct = function () { return this.players.filter(function (p) { return !p.out && !p.folded && !p.allIn; }); };

  Game.prototype.nextSeat = function (from, pred) {
    var n = this.players.length;
    for (var k = 1; k <= n; k++) {
      var p = this.players[(from + k) % n];
      if (pred(p)) return p.id;
    }
    return -1;
  };

  /* ---- ハンドの開始 ------------------------------------------------------- */

  Game.prototype.startHand = function () {
    var self = this;
    if (this.gameOver) return;
    var alive = this.alive();
    var hero = this.players[0];
    if (hero.out || alive.length < 2) { this.finish(); return; }

    this.handNo++;
    var bl = this.blinds();
    this.bb = bl.bb; this.sb = bl.sb;
    this.handOver = false;
    this.board = [];
    this.street = 'preflop';
    this.deck = C.shuffle(C.newDeck(), this.rng);
    this.results = null;
    this.players.forEach(function (p) {
      p.folded = p.out; p.allIn = false; p.acted = false;
      p.bet = 0; p.contrib = 0; p.cards = []; p.rangePct = 100; p.lastAction = '';
      p.pfLimped = false;
    });
    // ディーラーを次の生存者へ
    this.dealer = this.nextSeat(this.dealer, function (p) { return !p.out; });
    var self2 = this;
    alive.forEach(function (p) { p.cards = [self2.deck.pop(), self2.deck.pop()]; });

    // ブラインド
    var headsUp = alive.length === 2;
    var sbId = headsUp ? this.dealer : this.nextSeat(this.dealer, function (p) { return !p.out; });
    var bbId = this.nextSeat(sbId, function (p) { return !p.out; });
    this.sbId = sbId; this.bbId = bbId;
    this.postBlind(this.players[sbId], this.sb);
    this.postBlind(this.players[bbId], this.bb);
    this.currentBet = this.bb;
    this.lastRaise = this.bb;
    this.raised = false;
    this.limpers = 0;
    this.aggressor = -1;

    this.log('― 第 ' + this.handNo + ' ハンド（ブラインド ' + this.sb + '/' + this.bb + '）ディーラー: ' + this.players[this.dealer].name, 'hl');
    this.toAct = this.nextSeat(bbId, function (p) { return !p.folded && !p.allIn; });
    this.emit('update');
    if (this.toAct < 0) { this.nextStreet(); return; }
    this.proceed();
  };

  Game.prototype.postBlind = function (p, amt) {
    var a = Math.min(amt, p.stack);
    p.stack -= a; p.bet += a; p.contrib += a;
    if (p.stack === 0) p.allIn = true;
  };

  Game.prototype.pot = function () {
    return this.players.reduce(function (s, p) { return s + (p.contrib || 0); }, 0);
  };

  /* ---- 手番 --------------------------------------------------------------- */

  /** ポジション名（自分以外にも使う） */
  Game.prototype.positionOf = function (id) {
    var alive = this.alive();
    if (alive.length === 2) return id === this.dealer ? 'sb' : 'bb';
    if (id === this.sbId) return 'sb';
    if (id === this.bbId) return 'bb';
    if (id === this.dealer) return 'late';
    // BB の次から順に並べ、前 1/3 を early、後 1/3 を late
    var order = [];
    var cur = this.bbId;
    for (var k = 0; k < alive.length; k++) {
      cur = this.nextSeat(cur, function (p) { return !p.out; });
      if (cur === this.sbId || cur === this.bbId || cur === this.dealer) continue;
      order.push(cur);
    }
    var idx = order.indexOf(id), m = order.length;
    if (idx === 0) return 'early';                 // 最初に動く人（UTG）
    if (idx === m - 1 && m >= 3) return 'late';    // ディーラーの 1 つ前（カットオフ）
    return 'middle';
  };

  /** AI／コーチに渡す状況 */
  Game.prototype.contextFor = function (p) {
    var self = this;
    var toCall = Math.min(this.currentBet - p.bet, p.stack);
    var opps = this.inHand().filter(function (q) { return q.id !== p.id; })
      .map(function (q) { return { pct: Math.round(q.rangePct), name: q.name, id: q.id }; });
    return {
      street: this.street, hero: p.cards, board: this.board,
      pot: this.pot(), toCall: toCall, stack: p.stack, myBet: p.bet, bb: this.bb,
      position: this.positionOf(p.id), opps: opps, raised: this.raised, limpers: this.limpers,
      headsUp: this.alive().length === 2,
      minRaise: Math.min(this.currentBet + this.lastRaise, p.stack + p.bet), currentBet: this.currentBet
    };
  };

  Game.prototype.legalActions = function (p) {
    var toCall = Math.min(this.currentBet - p.bet, p.stack);
    var maxTo = p.stack + p.bet;
    var minTo = Math.min(this.currentBet + this.lastRaise, maxTo);
    return {
      fold: toCall > 0,
      check: toCall === 0,
      call: toCall > 0 ? toCall : 0,
      raise: (maxTo > this.currentBet) ? { min: minTo, max: maxTo } : null
    };
  };

  Game.prototype.proceed = function () {
    var self = this;
    if (this.handOver) return;
    var p = this.players[this.toAct];
    if (p.isHero && !this.autoHero) {
      this.emit('hero-turn', { player: p });
      return;
    }
    this.schedule(function () { self.cpuAct(p); });
  };

  Game.prototype.cpuAct = function (p) {
    var ctx = this.contextFor(p);
    var d = PK.ai.decide(ctx, p.persona || PK.ai.PERSONAS[3], this.rng);
    this.act(p.id, d.action, d.size);
  };

  /** 行動を適用する。size は bet/raise なら到達額、call なら無視 */
  Game.prototype.act = function (id, action, size) {
    var p = this.players[id];
    if (this.handOver || id !== this.toAct) return false;
    var la = this.legalActions(p);
    var self = this;
    var label = '';

    if (action === 'fold') {
      if (!la.fold) action = 'check';
    }
    if (action === 'bet' || action === 'raise') {
      if (!la.raise) action = la.call ? 'call' : 'check';
      else size = Math.max(la.raise.min, Math.min(la.raise.max, Math.round(size || la.raise.min)));
    }
    if (action === 'call' && !la.call) action = 'check';
    if (action === 'check' && !la.check) action = 'fold';

    if (action === 'fold') {
      p.folded = true; label = 'フォールド';
    } else if (action === 'check') {
      label = 'チェック';
    } else if (action === 'call') {
      var c = la.call;
      p.stack -= c; p.bet += c; p.contrib += c;
      label = 'コール ' + c;
      if (this.street === 'preflop') {
        if (this.raised) p.rangePct = Math.min(p.rangePct, 30);
        else { p.rangePct = Math.min(p.rangePct, 55); this.limpers++; p.pfLimped = true; }
      } else p.rangePct *= 0.85;
    } else {
      var inc = size - p.bet;
      var wasBet = this.currentBet === 0;
      var raiseAmt = size - this.currentBet;
      p.stack -= inc; p.bet = size; p.contrib += inc;
      if (raiseAmt >= this.lastRaise) this.lastRaise = raiseAmt;
      this.currentBet = size;
      this.aggressor = p.id;
      // 他の人は改めて行動が必要
      this.players.forEach(function (q) { if (q.id !== p.id) q.acted = false; });
      label = (wasBet ? 'ベット ' : 'レイズ → ') + size;
      if (this.street === 'preflop') {
        p.rangePct = Math.min(p.rangePct, this.raised ? 8 : 20);
        this.raised = true;
      } else p.rangePct *= 0.7;
    }
    if (p.stack === 0 && !p.folded) { p.allIn = true; label += '（オールイン）'; }
    p.acted = true;
    p.lastAction = label;
    this.log(p.name + ': ' + label);
    this.emit('action', { player: p, action: action, label: label });
    this.emit('update');
    this.advance();
    return true;
  };

  Game.prototype.roundDone = function () {
    var self = this;
    var active = this.canAct();
    if (this.inHand().length <= 1) return true;
    return active.every(function (p) { return p.acted && p.bet === self.currentBet; });
  };

  Game.prototype.advance = function () {
    if (this.inHand().length <= 1) { this.endByFold(); return; }
    if (this.roundDone()) { this.nextStreet(); return; }
    var self = this;
    this.toAct = this.nextSeat(this.toAct, function (p) { return !p.folded && !p.allIn && !p.out; });
    if (this.toAct < 0) { this.nextStreet(); return; }
    this.proceed();
  };

  Game.prototype.nextStreet = function () {
    var self = this;
    this.players.forEach(function (p) { p.bet = 0; p.acted = false; });
    this.currentBet = 0;
    this.lastRaise = this.bb;
    var idx = STREETS.indexOf(this.street);
    if (idx >= 3) { this.showdown(); return; }
    var next = STREETS[idx + 1];
    this.street = next;
    if (next === 'flop') this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
    else this.board.push(this.deck.pop());
    this.log(STREET_JP[next] + ': ' + this.board.map(C.toString).join(' '));
    this.emit('street', { street: next });
    this.emit('update');
    // 行動できる人が 1 人以下なら残りのボードを自動で開く
    if (this.canAct().length <= 1) {
      this.schedule(function () { self.nextStreet(); });
      return;
    }
    this.toAct = this.nextSeat(this.dealer, function (p) { return !p.folded && !p.allIn && !p.out; });
    this.proceed();
  };

  /* ---- 決着 --------------------------------------------------------------- */

  /** サイドポットを組む。players: [{contrib, folded, id}] */
  function buildPots(players) {
    var levels = players.filter(function (p) { return p.contrib > 0; })
      .map(function (p) { return p.contrib; })
      .sort(function (a, b) { return a - b; })
      .filter(function (v, i, arr) { return arr.indexOf(v) === i; });
    var pots = [];
    var prev = 0;
    levels.forEach(function (lv) {
      var amount = 0;
      players.forEach(function (p) { amount += Math.max(0, Math.min(p.contrib, lv) - prev); });
      var eligible = players.filter(function (p) { return !p.folded && p.contrib >= lv; }).map(function (p) { return p.id; });
      if (amount > 0) pots.push({ amount: amount, eligible: eligible, level: lv });
      prev = lv;
    });
    // 参加者が同じポットはまとめる
    var merged = [];
    pots.forEach(function (pot) {
      var last = merged[merged.length - 1];
      if (last && last.eligible.join() === pot.eligible.join()) last.amount += pot.amount;
      else merged.push({ amount: pot.amount, eligible: pot.eligible.slice() });
    });
    return merged;
  }

  Game.prototype.endByFold = function () {
    var winner = this.inHand()[0];
    var total = this.pot();
    winner.stack += total;
    this.log(winner.name + ' が ' + total + ' を獲得（全員フォールド）', 'hl');
    this.results = { type: 'fold', winners: [winner.id], pots: [{ amount: total, winners: [winner.id] }] };
    this.finishHand();
  };

  Game.prototype.showdown = function () {
    var self = this;
    this.street = 'showdown';
    var pots = buildPots(this.players.map(function (p) { return { contrib: p.contrib, folded: p.folded || p.out, id: p.id }; }));
    var vals = {};
    this.inHand().forEach(function (p) {
      vals[p.id] = C.evaluate(p.cards.concat(self.board));
      self.log(p.name + ': ' + p.cards.map(C.toString).join(' ') + ' → ' + C.describe(vals[p.id]));
    });
    var potResults = [];
    pots.forEach(function (pot, i) {
      var best = -1;
      pot.eligible.forEach(function (id) { if (vals[id] > best) best = vals[id]; });
      var winners = pot.eligible.filter(function (id) { return vals[id] === best; });
      var share = Math.floor(pot.amount / winners.length);
      var rem = pot.amount - share * winners.length;
      // 端数はディーラーの次に近い人から
      var ordered = [];
      var cur = self.dealer;
      for (var k = 0; k < self.players.length; k++) {
        cur = (cur + 1) % self.players.length;
        if (winners.indexOf(cur) >= 0) ordered.push(cur);
      }
      ordered.forEach(function (id, j) { self.players[id].stack += share + (j < rem ? 1 : 0); });
      var label = pots.length > 1 ? (i === 0 ? 'メインポット' : 'サイドポット' + i) : 'ポット';
      self.log(label + ' ' + pot.amount + ': ' + winners.map(function (id) { return self.players[id].name; }).join('・') +
        (winners.length > 1 ? ' で分け合う' : ' が獲得') + '（' + C.describe(best) + '）', 'hl');
      potResults.push({ amount: pot.amount, winners: winners, best: best, label: label });
    });
    this.results = { type: 'showdown', values: vals, pots: potResults,
      winners: potResults.reduce(function (a, r) { return a.concat(r.winners); }, []) };
    this.finishHand();
  };

  Game.prototype.finishHand = function () {
    var self = this;
    this.handOver = true;
    this.players.forEach(function (p) {
      if (!p.out && p.stack === 0) {
        p.out = true;
        self.log(p.name + ' はチップが尽きて退場', 'hl');
      }
    });
    this.emit('update');
    this.emit('hand-end', { results: this.results });
    var hero = this.players[0];
    if (hero.out || this.alive().length < 2) this.finish();
  };

  Game.prototype.finish = function () {
    if (this.gameOver) return;
    this.gameOver = true;
    var hero = this.players[0];
    var rank = hero.out ? this.alive().length + 1 : 1;
    this.log(rank === 1 ? '優勝！ 全員のチップを獲得しました。' : (rank + ' 位で敗退。'), 'hl');
    this.emit('game-over', { rank: rank, hands: this.handNo });
  };

  Game.prototype.nextHand = function () {
    if (!this.handOver || this.gameOver) return;
    this.startHand();
  };

  /** テスト用：自分も CPU に打たせてハンドの終わりまで同期で進める */
  Game.prototype.runToEnd = function () {
    var guard = 0;
    while (!this.handOver && guard++ < 500) {
      var p = this.players[this.toAct];
      if (p.isHero) this.cpuAct(p); else this.proceed();
    }
  };

  Game.buildPots = buildPots;
  Game.STREET_JP = STREET_JP;
  Game.BLIND_LEVELS = BLIND_LEVELS;
  Game.HANDS_PER_LEVEL = HANDS_PER_LEVEL;
  PK.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
