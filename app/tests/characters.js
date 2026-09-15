/*
 * tests/characters.js - 5 人の打ち筋の実測値（紹介ページ用）
 *   node tests/characters.js
 *
 * 5 人全員を卓に着かせ（自分の席も CPU が打つ）、多数のハンドを回して
 * 参加率（VPIP）・プリフロップのレイズ率・ショーダウン勝率・獲得ポットの平均を出す。
 */
var path = require('path');
['cards', 'preflop', 'equity', 'coach', 'ai', 'game'].forEach(function (m) {
  require(path.join(__dirname, '..', 'js', m + '.js'));
});
var PK = globalThis.PK;
var stats = {};
PK.ai.PERSONAS.forEach(function (p) { stats[p.name] = { dealt: 0, vpip: 0, pfr: 0, sd: 0, sdWin: 0, won: 0, pots: 0 }; });

var GAMES = 40, HANDS = 60;
for (var g = 0; g < GAMES; g++) {
  // 自分の席にも打ち筋を割り当てる（5 人の打ち筋が毎回全員そろう）
  var game = new PK.Game({ seed: 1000 + g, speed: 0, opponents: 4, autoHero: true, heroPersona: PK.ai.PERSONAS[g % 5] });
  var handAct = {};
  game.onEvent = function (type, d) {
    if (type === 'action' && game.street === 'preflop') {
      var p = d.player, nm = p.persona.name;
      if (!handAct[nm]) handAct[nm] = { vpip: false, pfr: false };
      if (d.action === 'call' || d.action === 'raise' || d.action === 'bet') handAct[nm].vpip = true;
      if (d.action === 'raise' || d.action === 'bet') handAct[nm].pfr = true;
    }
    if (type === 'hand-end') {
      var r = d.results;
      game.players.forEach(function (p) {
        if (!p.cards.length) return;
        var s = stats[p.persona.name];
        s.dealt++;
        var a = handAct[p.persona.name] || {};
        if (a.vpip) s.vpip++;
        if (a.pfr) s.pfr++;
        if (r.type === 'showdown' && !p.folded) { s.sd++; if (r.winners.indexOf(p.id) >= 0) s.sdWin++; }
        r.pots.forEach(function (pt) { if (pt.winners.indexOf(p.id) >= 0) { s.won++; s.pots += pt.amount / pt.winners.length; } });
      });
      handAct = {};
    }
  };
  game.startGame();
  for (var h = 0; h < HANDS && !game.gameOver; h++) game.nextHand();
}

console.log('打ち筋        参加率  レイズ率  SD勝率  獲得/ハンド');
PK.ai.PERSONAS.forEach(function (p) {
  var s = stats[p.name];
  console.log(p.name + '（' + p.tag + '）'.padEnd(8) +
    (s.vpip / s.dealt * 100).toFixed(1).padStart(6) + '%' +
    (s.pfr / s.dealt * 100).toFixed(1).padStart(8) + '%' +
    (s.sd ? (s.sdWin / s.sd * 100).toFixed(1) : '-').padStart(8) + '%' +
    (s.pots / s.dealt).toFixed(0).padStart(9) + '  (' + s.dealt + ' hands)');
});
