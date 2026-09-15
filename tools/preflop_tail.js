
  // ハンド名 -> {rank, eq, pct} の索引を 2 表ぶん作る
  function index(tbl) {
    var m = {};
    tbl.forEach(function (row, i) { m[row[0]] = { rank: i + 1, eq: row[1], pct: row[2] }; });
    return m;
  }
  var IDX_HU = index(HU), IDX_MULTI = index(MULTI);

  function pick(multi) { return multi ? IDX_MULTI : IDX_HU; }

  PK.preflop = {
    HU: HU, MULTI: MULTI,
    /** そのハンドが上位何%か（0〜100、小さいほど強い）。multi=true で 4 人打ち表 */
    pct: function (key, multi) { var e = pick(multi)[key]; return e ? e.pct : 100; },
    /** ランダムな相手に対する勝率% */
    eq: function (key, multi) { var e = pick(multi)[key]; return e ? e.eq : 0; },
    /** 169 種中の順位 */
    rank: function (key, multi) { var e = pick(multi)[key]; return e ? e.rank : 169; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
