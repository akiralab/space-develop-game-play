/* engine.js — 宇宙開発レース ルールエンジン（ブラウザ版・GitHub Pages 用）
 *
 * sim/prototype.py（ルールの正本: Game / Player / Unit / mission_points / apply_action /
 * CPUの方策）と sim/serve.py の UI層（Pilot: build_options / act / state / push_event）を
 * JavaScript に移植したもの。**サーバなしで index.html がそのまま動く**のが目的。
 *
 * 公開API（serve.py のHTTPエンドポイントと同じ形の state を返す）:
 *     window.SDGEngine.newGame({players, package, seed, grace})   // POST /new_game
 *     window.SDGEngine.getState()                                 // GET  /state
 *     window.SDGEngine.act(id, extra)                             // POST /act
 *     window.SDGEngine.endTurn()                                  // POST /end_turn
 *     window.SDGEngine.cardsMeta()                                // GET  /cards_meta
 *
 * 依存: cards.js（`window.SDGCards`・tools/build_engine_data.py が data/*.csv から生成）
 *
 * Python版との差:
 *   - 乱数は Python の Mersenne Twister ではなく mulberry32（下記 RNG）。
 *     同じ seed なら **JS内では完全に決定論的**だが、Python版と同じ盤面にはならない。
 *   - 終局時のログ保存（sim/logs/pilot_NNN.md）は静的サイトでは不可能なので行わない。
 *     そのため「（全ログを … に保存しました）」の1行だけログに出ない。
 *   - それ以外（ルール判定・合法手・CPUの方策・ログ文字列・state のフィールド）は
 *     prototype.py / serve.py と1対1で対応させてある。
 *
 * Node からも読める（テスト用）:
 *     global.window = {}; require('./cards.js'); const E = require('./engine.js');
 */
(function (root) {
  'use strict';

  // ---- 定数（prototype.py と同じ） -----------------------------------------
  var KLASS = {S: 1, M: 2, L: 3, XL: 4};
  var TURNS = 10;
  var HAND_TOTAL = 7;
  var LAUNCH_COST = 100;
  var LAUNCH_FAIL_FACES = [7];    // 2d6の合計がこれなら打上失敗（全ロケット共通）
  var REWARD_PER_PT = 20;
  var START_MONEY = 100;
  var COPIES = 3;

  var POLICY_TEXT = {
    '回転型': '最安のロケット×衛星を組んで即打上。衛星選びは全ミッション平均（場の課題を見ない）',
    '狙撃型': '場に残る課題への期待得点（クリティカル込み）で衛星を選ぶ。◎3を狙える手札があれば貯金する'
  };

  // ---- 乱数（mulberry32・シードを与えれば完全に再現する） -------------------
  function RNG(seed) {
    this.s = (seed >>> 0) || 1;
    // 種の偏りを均すため空回し（連続seedで最初の目が似るのを避ける）
    for (var i = 0; i < 8; i++) this.next();
  }
  RNG.prototype.next = function () {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    var t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** Python の random.randrange(n) 相当（0 <= r < n） */
  RNG.prototype.randrange = function (n) {
    return Math.floor(this.next() * n) % n;
  };
  /** Python の random.randint(a, b) 相当（両端含む） */
  RNG.prototype.randint = function (a, b) {
    return a + this.randrange(b - a + 1);
  };
  /** Python の random.shuffle 相当（同じ後ろ向きFisher-Yates） */
  RNG.prototype.shuffle = function (x) {
    for (var i = x.length - 1; i > 0; i--) {
      var j = this.randrange(i + 1);
      var t = x[i]; x[i] = x[j]; x[j] = t;
    }
  };

  // ---- 小道具 ---------------------------------------------------------------
  /** Python の max(seq, key=f)（同点は**最初**の要素を返す） */
  function argmax(seq, key) {
    var best = null, bestK = null;
    for (var i = 0; i < seq.length; i++) {
      var k = key(seq[i]);
      if (best === null || cmp(k, bestK) > 0) { best = seq[i]; bestK = k; }
    }
    return best;
  }
  /** Python の min(seq, key=f)（同点は**最初**の要素を返す） */
  function argmin(seq, key) {
    var best = null, bestK = null;
    for (var i = 0; i < seq.length; i++) {
      var k = key(seq[i]);
      if (best === null || cmp(k, bestK) < 0) { best = seq[i]; bestK = k; }
    }
    return best;
  }
  /** 数値もタプル（配列）も比較できる Python 風の比較 */
  function cmp(a, b) {
    if (Array.isArray(a)) {
      for (var i = 0; i < Math.max(a.length, b.length); i++) {
        var c = cmp(a[i], b[i]);
        if (c !== 0) return c;
      }
      return 0;
    }
    return a < b ? -1 : (a > b ? 1 : 0);
  }
  /** Python の list.remove(x)（最初の1個だけ消す） */
  function removeFirst(arr, x) {
    var i = arr.indexOf(x);
    if (i >= 0) arr.splice(i, 1);
    return i >= 0;
  }
  function counterAdd(c, key) { c[key] = (c[key] || 0) + 1; }

  // ---- カード読み込み（cards.js → prototype.load_cards() と同じ形） ---------
  function rawCards() {
    var c = (typeof window !== 'undefined' && window.SDGCards) ||
            (typeof globalThis !== 'undefined' && globalThis.SDGCards) || null;
    if (!c) throw new Error('cards.js が読み込まれていません（window.SDGCards が無い）');
    return c;
  }

  function loadCards() {
    var raw = rawCards();
    var rockets = raw.rockets.map(function (r) {
      return {kind: 'R', slug: r.slug, name: r.name, faction: r.faction,
              cost: r.cost, klass: KLASS[r.klass], gen: r.gen};
    });
    var sensors = raw.sensors.map(function (s) {
      return {kind: 'S', slug: s.slug, name: s.name, band: s.band,
              cost: s.cost, klass: KLASS[s.klass], gen: s.gen, life: s.life};
    });
    var missions = raw.missions.map(function (m) {
      return {slug: m.slug, name: m.name,
              pts: {OPT: m.opt, SAR: m.sar, TIR: m.tir, HYP: m.hyp},
              critical: m.critical};
    });
    return {rockets: rockets, sensors: sensors, missions: missions};
  }

  // ---- Unit / Player --------------------------------------------------------
  var UID = 0;

  /** 場に出た1枚のカード。v2.5では stack は常に1枚だが、返却経路とUIの互換で構造は残す。 */
  function Unit(card) {
    this.stack = [card];
    this.released = false;
    this.uid = ++UID;          // serve.py の id(ru) 相当（optionsのpayloadで使う）
  }
  Object.defineProperty(Unit.prototype, 'top', {
    get: function () { return this.stack[this.stack.length - 1]; }
  });
  Object.defineProperty(Unit.prototype, 'evo', {
    get: function () { return 0; }   // v2.5: 進化廃止。UI互換のため常に0
  });

  function Player(i, money) {
    this.i = i;
    this.money = money;
    this.hand = [];        // カード(オブジェクト)のリスト・非公開
    this.table_r = [];     // Unit（ロケット・未搭載）
    this.table_s = [];     // Unit（衛星・未搭載）
    this.sats = [];        // [ru, su] 搭載済み・未打上
    this.orbit = [];       // [ru, su, born] 軌道上
    this.score = 0;
    this.launch_ok = 0;
    this.launch_ng = 0;
    this.answered = 0;
    this.expired = 0;
    this.forced_fund = 0;
    this.actions = {};
  }

  // ---- Game（prototype.Game の移植） ---------------------------------------
  function Game(nPlayers, rockets, sensors, missions, rng, opt) {
    opt = opt || {};
    this.rng = rng;
    this.verbose = !!opt.verbose;
    this.combine_free = opt.combine_free !== undefined ? opt.combine_free : true;
    this.actions_per_turn = opt.actions_per_turn || 1;
    this.mission_board = opt.mission_board !== undefined ? opt.mission_board : false;
    this.serial = (this.mission_board === 'serial');
    this.serial_grace = opt.serial_grace != null ? opt.serial_grace : null;
    this.serial_window = opt.serial_window != null ? opt.serial_window : 1;
    this.next_mi = 0;
    this.revealed_at = {};
    this.rotate_start = !!opt.rotate_start;
    this.lifetime = !!opt.lifetime;
    this.crit_pt = opt.crit_pt != null ? opt.crit_pt : 1;
    this.dual_launch = !!opt.dual_launch;
    this.sniper = {};
    (opt.sniper || []).forEach(function (i) { this.sniper[i] = true; }, this);
    this.dual_count = 0;
    this.usage = {};
    this.crit_procs = 0;
    this.cur_pos = 0;
    this.solves_by_pos = {};
    this.score_gens = [];
    this.solve_ages = [];
    this.board = [];       // [mi, mission] の配列
    this.deck = [];
    var all = rockets.concat(sensors);
    for (var i = 0; i < all.length; i++) {
      // Python は [dict(c)] * COPIES ＝ 同じ辞書オブジェクトを3個並べる。
      // JSでも同じ参照を3回入れる（hand.remove の「最初の等価な1枚」と挙動を揃えるため）。
      var card = Object.assign({}, all[i]);
      for (var k = 0; k < COPIES; k++) this.deck.push(card);
    }
    rng.shuffle(this.deck);
    var ms = missions.slice();
    rng.shuffle(ms);
    // v2.6: 直列モードは解決のたびに補充するため山札は全ミッション。
    // 非直列は「年ごとに1枚」の設計なので従来どおり10枚に切る。
    this.missions = this.serial ? ms : ms.slice(0, TURNS);
    this.mission_discard = [];               // 解決済み。山札が尽きたら戻す
    this.players = [];
    var money = opt.start_money != null ? opt.start_money : START_MONEY;
    for (var q = 0; q < nPlayers; q++) this.players.push(new Player(q, money));
    this.draw_fail = 0;
    this.deck_min = this.deck.length;
    this.mission_answered = [];
    for (var t = 0; t < this.missions.length; t++) this.mission_answered.push(false);
    this.snapshots = {};
    this.log = [];
    for (var z = 0; z < this.players.length; z++) this.refill(this.players[z]);
  }

  Game.prototype.say = function (msg) {
    if (this.verbose) this.log.push(msg);
  };

  // ---- 山札 ----
  Game.prototype.draw = function (p, n) {
    for (var i = 0; i < n; i++) {
      if (!this.deck.length) { this.draw_fail += 1; return; }
      p.hand.push(this.deck.pop());
    }
    this.deck_min = Math.min(this.deck_min, this.deck.length);
  };

  Game.prototype.refill = function (p) {
    var need = HAND_TOTAL - p.hand.length;
    if (need > 0) this.draw(p, need);
  };

  Game.prototype.to_deck = function (cards) {
    for (var i = 0; i < cards.length; i++) {
      this.deck.splice(this.rng.randrange(this.deck.length + 1), 0, cards[i]);
    }
  };

  // ---- 判定 ----
  /** 得点 = 系統適合(◎3/○2/△1/×0) + クリティカル。ロケットは得点に関与しない。 */
  Game.prototype.mission_points = function (mission, su) {
    var base = mission.pts[su.top.band];
    if (!(base > 0)) return 0;
    var crit = (su.top.slug === mission.critical) ? this.crit_pt : 0;
    return base + crit;
  };

  Game.prototype.score_mission = function (p, ru, su, mi, m, pts, turn, tag) {
    p.score += pts;
    p.money += pts * REWARD_PER_PT;
    p.answered += 1;
    counterAdd(this.solves_by_pos, this.cur_pos);
    this.mission_answered[mi] = true;
    this.mission_discard.push(m);            // v2.6: 山札が尽きたら戻す
    // 直列モードは mi ≠ 登場ターン-1 なので、公開ターンから経過年を測る
    this.solve_ages.push(turn - (this.revealed_at[mi] != null
                                 ? this.revealed_at[mi] : mi + 1));
    if (this.mission_board) {
      this.board = this.board.filter(function (km) { return km[0] !== mi; });
    }
    if (su.top.slug === m.critical) this.crit_procs += 1;
    this.score_gens.push(su.top.gen);
    counterAdd(this.usage, 'score|' + su.top.slug);
    counterAdd(this.usage, 'score|' + ru.top.slug);
    this.release_cards(p, ru, su);
    this.say('  P' + (p.i + 1) + ' ' + tag + ': ' + ru.top.name + '×' + su.top.name +
             ' →「' + m.name + '」 **' + pts + '点** (+' + (pts * REWARD_PER_PT) +
             '億) 衛星は山札へ');
    if (this.serial) this.reveal_next(turn);
  };

  /* v2.6: 解決済みの課題をシャッフルして山札に戻す。
     課題16枚に対し4人×10年では解決数が上回るため、これが無いと場が空になる。 */
  Game.prototype.recycle_missions = function () {
    if (!this.mission_discard.length) return false;
    var back = this.mission_discard.slice();
    this.rng.shuffle(back);
    for (var i = 0; i < back.length; i++) {
      this.missions.push(back[i]);
      this.mission_answered.push(false);
    }
    this.mission_discard = [];
    this.say('  ♻️ 解決済みの課題' + back.length + '件をシャッフルして山札に戻した');
    return true;
  };

  Game.prototype.reveal_next = function (turn) {
    if (this.next_mi >= this.missions.length) this.recycle_missions();
    if (this.next_mi < this.missions.length) {
      var m = this.missions[this.next_mi];
      this.board.push([this.next_mi, m]);
      this.revealed_at[this.next_mi] = turn;
      this.say('  🌏 次の課題を公開: 「' + m.name + '」');
      this.next_mi += 1;
    }
  };

  /** 衛星のカードを山札へ。ロケットは他の衛星と共有していなければ一緒に返す。 */
  Game.prototype.release_cards = function (p, ru, su) {
    var cards = su.stack.slice();
    var inUse = p.sats.some(function (rs) { return rs[0] === ru; }) ||
                p.orbit.some(function (rsb) { return rsb[0] === ru; });
    if (!inUse && !ru.released) {
      cards = cards.concat(ru.stack);
      ru.released = true;
    }
    this.to_deck(cards);
  };

  // ---- CPU ----
  /** 衛星カードの期待得点の目安。回転型=全ミッション平均／狙撃型=場に残る課題だけ。 */
  Game.prototype.sensor_value = function (card, p) {
    var pool = this.missions;
    if (p && this.sniper[p.i] && this.mission_board && this.board.length) {
      pool = this.board.map(function (km) { return km[1]; });
    }
    var tot = 0;
    for (var i = 0; i < pool.length; i++) {
      var m = pool[i];
      var v = m.pts[card.band];
      if (v > 0 && m.critical === card.slug) v += this.crit_pt;
      tot += v;
    }
    return tot / pool.length;
  };

  /** そのカードで場の課題から狙える最高得点（クリティカル込み） */
  Game.prototype.board_best = function (card) {
    var pool = this.board.length ? this.board.map(function (km) { return km[1]; })
                                 : this.missions;
    var best = 0;
    for (var i = 0; i < pool.length; i++) {
      var m = pool[i];
      var v = m.pts[card.band];
      if (v > 0 && m.critical === card.slug) v += this.crit_pt;
      if (v > best) best = v;
    }
    return best;
  };

  Game.prototype.try_combine = function (p) {
    var ri, si, ru, su;
    // デュアルローンチ: XL級ロケット（未打上）に衛星をもう1機相乗りさせる
    if (this.dual_launch) {
      for (var a = 0; a < p.sats.length; a++) {
        ru = p.sats[a][0];
        var n = 0;
        for (var b = 0; b < p.sats.length; b++) if (p.sats[b][0] === ru) n++;
        if (ru.top.klass === 4 && n < 2) {
          for (si = 0; si < p.table_s.length; si++) {
            su = p.table_s[si];
            if (ru.top.klass >= su.top.klass) {
              p.sats.push([ru, p.table_s.splice(si, 1)[0]]);
              this.say('  P' + (p.i + 1) + ' 🔗搭載(無料): ' + ru.top.name + ' に ' +
                       su.top.name + ' を追加搭載（デュアルローンチ準備）');
              return true;
            }
          }
        }
      }
    }
    for (ri = 0; ri < p.table_r.length; ri++) {
      ru = p.table_r[ri];
      for (si = 0; si < p.table_s.length; si++) {
        su = p.table_s[si];
        if (ru.top.klass >= su.top.klass) {
          var rr = p.table_r.splice(ri, 1)[0];
          var ss = p.table_s.splice(si, 1)[0];
          p.sats.push([rr, ss]);
          this.say('  P' + (p.i + 1) + ' 🔗搭載(無料): ' + rr.top.name + ' に ' +
                   ss.top.name + ' を搭載');
          return true;
        }
      }
    }
    return false;
  };

  Game.prototype.take_turn = function (p, turn, mission) {
    var self = this;
    // 1) 応札（無料）: 軌道上の衛星でミッションに答える
    var pool = this.mission_board ? this.board : [[turn - 1, mission]];
    var best = null, bestPts = 0;
    for (var i = 0; i < p.orbit.length; i++) {
      var su = p.orbit[i][1];
      for (var j = 0; j < pool.length; j++) {
        var pts = this.mission_points(pool[j][1], su);
        if (pts > bestPts) { best = [i, pool[j][0]]; bestPts = pts; }
      }
    }
    var threshold = (turn >= TURNS - 1) ? 1 : 2;
    if (best !== null && bestPts >= threshold) {
      var rsb = p.orbit.splice(best[0], 1)[0];
      this.score_mission(p, rsb[0], rsb[1], best[1], this.missions[best[1]],
                         bestPts, turn, '📡応札');
    }

    // 2) アクション（1ターン actions_per_turn 回まで・同一種類は1回まで）
    var used = {};
    for (var k = 0; k < this.actions_per_turn; k++) {
      if (this.combine_free) { while (self.try_combine(p)) { /* 繰り返す */ } }
      var act = this.choose_action(p, turn, used);
      if (act[0] === 'pass') break;
      counterAdd(p.actions, act[0]);
      used[act[0]] = true;
      this.apply_action(p, turn, act);
    }

    // 3) 補充
    this.refill(p);
  };

  Game.prototype.choose_action = function (p, turn, used) {
    var self = this;
    used = used || {};
    var cands, i, c;
    // 打上 > (搭載) > 開発宣言 > 交換 > 資金調達。used の種類は選べない
    if (!used.launch && p.sats.length && p.money >= LAUNCH_COST) {
      // デュアルローンチ: XL衛星が1機積みなら、先に2機目の衛星を宣言して相乗りさせる
      if (this.dual_launch && !used.declare) {
        var ru0 = p.sats[0][0];
        var n0 = 0;
        for (i = 0; i < p.sats.length; i++) if (p.sats[i][0] === ru0) n0++;
        if (ru0.top.klass === 4 && n0 === 1) {
          cands = p.hand.filter(function (x) {
            return x.kind === 'S' && x.cost <= p.money - LAUNCH_COST;
          });
          if (cands.length) {
            return ['declare', argmax(cands, function (x) {
              return self.sensor_value(x) / x.cost;
            })];
          }
        }
      }
      return ['launch'];
    }
    if (!this.combine_free && !used.combine) {
      for (i = 0; i < p.table_r.length; i++) {
        for (var s = 0; s < p.table_s.length; s++) {
          if (p.table_r[i].top.klass >= p.table_s[s].top.klass) return ['combine'];
        }
      }
    }

    var need_r = p.table_r.length === 0;
    var need_s = p.table_s.length === 0;
    var decl = null;
    if (need_s) {
      cands = p.hand.filter(function (x) { return x.kind === 'S' && x.cost <= p.money; });
      if (cands.length) {
        decl = argmax(cands, function (x) { return self.sensor_value(x, p) / x.cost; });
      }
    }
    if (decl === null && need_r) {
      var want = 2;
      for (i = 0; i < p.table_s.length; i++) want = Math.max(want, p.table_s[i].top.klass);
      for (i = 0; i < p.hand.length; i++) {
        if (p.hand[i].kind === 'S') want = Math.max(want, p.hand[i].klass);
      }
      cands = p.hand.filter(function (x) {
        return x.kind === 'R' && x.cost <= p.money && x.klass >= want;
      });
      if (!cands.length) {     // クラス条件を緩めて再探索
        cands = p.hand.filter(function (x) { return x.kind === 'R' && x.cost <= p.money; });
      }
      if (cands.length) {
        var nSens = p.table_s.length +
                    p.hand.filter(function (x) { return x.kind === 'S'; }).length;
        if (this.dual_launch && nSens >= 2) {
          // 衛星が2枚あるならXL級（デュアルローンチ可）を優先
          decl = argmin(cands, function (x) { return [x.klass === 4 ? 0 : 1, x.cost]; });
        } else {
          decl = argmin(cands, function (x) { return x.cost; });
        }
      }
    }
    if (decl !== null && !used.declare) return ['declare', decl];

    // 狙撃型: 場の課題に◎3以上を狙える衛星カードを持っているのに資金不足なら、
    // 交換で手放さず資金調達で貯金する
    if (this.sniper[p.i] && !used.fund) {
      for (i = 0; i < p.hand.length; i++) {
        c = p.hand[i];
        if (c.kind === 'S' && c.cost > p.money && this.board_best(c) >= 3) {
          return ['fund', false];
        }
      }
    }

    // 交換: 場が埋まっているのに宣言できるカードがない → 手札を入れ替える
    var junk = p.hand.filter(function (x) {
      return (x.kind === 'S' && !need_s) || (x.kind === 'R' && !need_r) ||
             x.cost > p.money + 100;
    });
    if (junk.length && !used.exchange && p.hand.length >= 2) {
      return ['exchange', junk.slice(0, 3)];
    }

    if (used.fund) return ['pass'];
    return ['fund', junk.length === 0];
  };

  Game.prototype.apply_action = function (p, turn, act) {
    var kind = act[0];
    var i, su, cards;
    if (kind === 'launch') {
      var ru = p.sats[0][0];
      var group = [];
      for (i = 0; i < p.sats.length; i++) if (p.sats[i][0] === ru) group.push(p.sats[i][1]);
      p.sats = p.sats.filter(function (rs) { return rs[0] !== ru; });
      p.money -= LAUNCH_COST;
      var names = group.map(function (s) { return s.top.name; }).join('＋');
      var d1 = this.rng.randint(1, 6), d2 = this.rng.randint(1, 6);
      if (LAUNCH_FAIL_FACES.indexOf(d1 + d2) >= 0) {
        p.launch_ng += 1;
        cards = ru.stack.slice();
        for (i = 0; i < group.length; i++) cards = cards.concat(group[i].stack);
        ru.released = true;
        this.to_deck(cards);
        this.say('  P' + (p.i + 1) + ' 🚀打上: ' + ru.top.name + '×' + names +
                 ' (-100億) 🎲' + d1 + '+' + d2 + ' **失敗** カードは山札へ (残' +
                 p.money + '億)');
      } else {
        p.launch_ok += 1;
        if (group.length >= 2) this.dual_count += 1;
        counterAdd(this.usage, 'orbit|' + ru.top.slug);
        for (i = 0; i < group.length; i++) {
          counterAdd(this.usage, 'orbit|' + group[i].top.slug);
          p.orbit.push([ru, group[i], turn]);
        }
        var life = this.lifetime
          ? '・寿命' + group.map(function (s) { return s.top.life + '年'; }).join('/')
          : '';
        var dual = group.length >= 2 ? '（2機同時）' : '';
        this.say('  P' + (p.i + 1) + ' 🚀打上' + dual + ': ' + ru.top.name + '×' + names +
                 ' (-100億) 🎲' + d1 + '+' + d2 + ' 成功→軌道へ' + life +
                 ' (残' + p.money + '億)');
        // ルール(v2.4): 打上成功の瞬間、場の課題を自動判定。1点以上なら即得点
        //（アクション消費なし・全プレイヤー共通。デュアルなら2機とも判定）
        var self = this;
        var groupCopy = group.slice();
        for (i = 0; i < groupCopy.length; i++) {
          su = groupCopy[i];
          var pool = this.mission_board ? this.board
                                        : [[turn - 1, this.missions[turn - 1]]];
          if (!pool.length) continue;
          var best = argmax(pool, function (km) { return self.mission_points(km[1], su); });
          var pts = this.mission_points(best[1], su);
          if (pts >= 1) {
            p.orbit = p.orbit.filter(function (rsb) { return rsb[1] !== su; });
            this.score_mission(p, ru, su, best[0], best[1], pts, turn, '🎯即達成');
          }
        }
      }
    } else if (kind === 'combine') {
      this.try_combine(p);
    } else if (kind === 'declare') {
      var c = act[1];
      counterAdd(this.usage, 'declare|' + c.slug);
      removeFirst(p.hand, c);
      p.money -= c.cost;
      (c.kind === 'R' ? p.table_r : p.table_s).push(new Unit(c));
      this.say('  P' + (p.i + 1) + ' 🔧開発宣言: ' + c.name + ' (-' + c.cost + '億, 残' +
               p.money + '億)');
      this.refill(p);                     // v2.4: 出した分は即補充
    } else if (kind === 'exchange') {
      var back = act[1];
      for (i = 0; i < back.length; i++) {
        counterAdd(this.usage, 'discard|' + back[i].slug);
        removeFirst(p.hand, back[i]);
      }
      this.to_deck(back);
      this.draw(p, back.length);
      this.say('  P' + (p.i + 1) + ' 🔄交換: ' +
               back.map(function (x) { return x.name; }).join('・') +
               ' を山札へ戻し' + back.length + '枚引く');
    } else if (kind === 'fund') {
      if (act[1]) p.forced_fund += 1;
      var f1 = this.rng.randint(1, 6), f2 = this.rng.randint(1, 6);
      var sum = f1 + f2;
      var gain = sum === 7 ? 300 : (sum === 6 || sum === 8 ? 200 : 100);
      var hit = sum === 7 ? '✨大当たり! ' : ((sum === 6 || sum === 8) ? '✨当たり! ' : '');
      p.money += gain;
      this.say('  P' + (p.i + 1) + ' 💰資金調達: 🎲' + f1 + '+' + f2 + ' ' + hit +
               '+' + gain + '億 (残' + p.money + '億)');
    }
  };

  /** 年始処理: ミッション公開・設計寿命の退場。run() と対話UIの共用。 */
  Game.prototype.begin_year = function (turn) {
    // 直列モードは場（board）で回すため year→mission の対応は使わない
    var mission = turn - 1 < this.missions.length ? this.missions[turn - 1] : null;
    var i, p;
    if (this.serial) {
      if (turn === 1) {
        for (i = 0; i < this.serial_window; i++) this.reveal_next(turn);
      } else if (this.serial_grace && this.board.length && this.next_mi < this.missions.length) {
        var newest = -Infinity;
        for (i = 0; i < this.board.length; i++) newest = Math.max(newest, this.board[i][0]);
        var at = this.revealed_at[newest] != null ? this.revealed_at[newest] : turn;
        if (turn - at >= this.serial_grace) {
          this.say('  ⏰ ' + this.serial_grace + '年間解決されず、追加の課題を公開');
          this.reveal_next(turn);
        }
      }
    } else if (this.mission_board) {
      this.board.push([turn - 1, mission]);
    }
    var openMs = this.mission_board
      ? this.board.map(function (km) { return km[1].name; }).join('、')
      : mission.name;
    this.say('\n**T' + turn + '年目**｜場の課題: ' + (openMs || 'なし') + '｜山札' +
             this.deck.length + '枚');
    // 設計寿命: 打上年を1年目として寿命年数を超えた衛星は年初に退場
    if (this.lifetime) {
      for (var q = 0; q < this.players.length; q++) {
        p = this.players[q];
        var keep = [], dead = [];
        for (i = 0; i < p.orbit.length; i++) {
          if (turn - p.orbit[i][2] >= p.orbit[i][1].top.life) dead.push(p.orbit[i]);
          else keep.push(p.orbit[i]);
        }
        p.orbit = keep;
        for (i = 0; i < dead.length; i++) {
          p.expired += 1;
          this.release_cards(p, dead[i][0], dead[i][1]);
          this.say('  P' + (p.i + 1) + ' ⌛設計寿命: ' + dead[i][0].top.name + '×' +
                   dead[i][1].top.name + ' 退場（T' + dead[i][2] + '打上・寿命' +
                   dead[i][1].top.life + '年）カードは山札へ');
        }
      }
    }
    return mission;
  };

  /** CPU同士の自走（バランス計測用。対話UIでは使わない）。 */
  Game.prototype.run = function () {
    for (var turn = 1; turn <= TURNS; turn++) {
      var mission = this.begin_year(turn);
      var order = this.players.slice();
      if (this.rotate_start) {
        var k = (turn - 1) % order.length;
        order = order.slice(k).concat(order.slice(0, k));
      }
      for (var pos = 0; pos < order.length; pos++) {
        this.cur_pos = pos;
        this.take_turn(order[pos], turn, mission);
      }
      this.snapshots[turn] = this.players.map(function (p) { return p.score; });
      this.say('  ' + this.players.map(function (q) {
        return '[P' + (q.i + 1) + ': ' + q.score + '点/' + q.money + '億]';
      }).join('  '));
    }
    return this;
  };

  // ---- Pilot（serve.py の Pilot の移植・人間1席=index 0） -------------------
  function Pilot(nPlayers, seed, pkg, grace) {
    var cards = loadCards();
    this.cardsBySlug = {};
    cards.rockets.concat(cards.sensors).forEach(function (c) {
      this.cardsBySlug[c.slug] = c;
    }, this);
    var rng = new RNG(seed);
    var sniper = [];
    if (nPlayers >= 3) { for (var i = 2; i < nPlayers; i++) sniper.push(i); }
    else sniper = [1];
    var kw = {combine_free: true, actions_per_turn: 2, mission_board: 'serial',
              // v0.2: あなた（席1）は常に先行。ローテーションだと1回のダイジェストに
              // 2年分が混ざり、CPUが1年に2回開発したように見えるため（serve.py と同じ）
              serial_window: 3, rotate_start: false, lifetime: true, dual_launch: true,
              verbose: true, sniper: sniper, serial_grace: grace != null ? grace : null};
    if (pkg) { kw.start_money = 300; kw.crit_pt = 2; }
    this.package = !!pkg;
    this.seed = seed;
    this.g = new Game(nPlayers, cards.rockets, cards.sensors, cards.missions, rng, kw);
    this.policies = {};
    for (var j = 0; j < nPlayers; j++) {
      this.policies[j] = (j === 0) ? 'あなた'
                                   : (sniper.indexOf(j) >= 0 ? '狙撃型' : '回転型');
    }
    this.phase = 'human';
    this.turn = 0;
    this.order = [];
    this.oi = 0;
    this.used = {};
    this.acts = 0;
    this.options = {};
    this.events = [];        // 直前の操作で起きたこと（演出用・1回で消費）
    this.start_turn();
  }

  Pilot.prototype.human = function () { return this.g.players[0]; };

  Pilot.prototype.start_turn = function () {
    this.turn += 1;
    if (this.turn > TURNS) {
      this.phase = 'over';
      var keys = this.g.players.map(function (p) {
        return [p.score, p.money, p.launch_ok];
      });
      var w = 0;
      for (var i = 1; i < keys.length; i++) if (cmp(keys[i], keys[w]) > 0) w = i;
      this.g.say('\n**ゲーム終了** 勝者: ' + this.name(w));
      // Python版はここで sim/logs/pilot_NNN.md にログを保存するが、
      // 静的サイトではファイルを書けないので行わない（差はこの1行だけ）。
      return;
    }
    this.g.begin_year(this.turn);
    // v0.2: あなた（席1）は常に先行。serve.py の Pilot.start_turn と同じ理由・同じ挙動。
    this.order = this.g.players.slice();
    this.oi = 0;
    this.advance();
  };

  Pilot.prototype.advance = function () {
    var g = this.g;
    while (this.oi < this.order.length) {
      var p = this.order[this.oi];
      if (p.i === 0) {
        this.phase = 'human';
        this.used = {};
        this.acts = 0;
        return;
      }
      g.take_turn(p, this.turn, g.missions[this.turn - 1]);
      this.oi += 1;
    }
    g.snapshots[this.turn] = g.players.map(function (p) { return p.score; });
    var self = this;
    g.say('  ' + g.players.map(function (q) {
      return '[' + self.name(q.i) + ': ' + q.score + '点/' + q.money + '億]';
    }).join('  '));
    this.start_turn();
  };

  /** 全席の得点・資金のスナップショット。CPUダイジェストの差分表示に使う。 */
  Pilot.prototype.snap_players = function () {
    var self = this;
    return this.g.players.map(function (q) {
      return {i: q.i, name: self.name(q.i), policy: self.policies[q.i],
              score: q.score, money: q.money};
    });
  };

  Pilot.prototype.end_turn = function () {
    var g = this.g, p = this.human();
    var log0 = g.log.length, h0 = p.hand.length;
    var before = this.snap_players(), year0 = this.turn;
    g.refill(p);
    if (p.hand.length > h0) {
      this.events.push({kind: 'refill', draw: p.hand.length - h0,
                        money: 0, score: 0, dice: null});
    }
    this.oi += 1;
    this.phase = 'cpu';
    this.advance();
    var cpuLines = g.log.slice(log0);
    if (cpuLines.length) {
      // before/after と年の範囲を添える。ログ文字列だけだと各CPUの得点・資金の
      // 「増減」が読み取れず、ダイジェスト側で推測することになるため。
      this.events.push({kind: 'cpu', lines: cpuLines,
                        money: 0, score: 0, draw: 0, dice: null,
                        before: before, after: this.snap_players(),
                        from_year: year0, to_year: Math.min(this.turn, TURNS)});
    }
  };

  Pilot.prototype.name = function (i) {
    if (i === 0) return 'あなた';
    return 'CPU' + i + '（' + this.policies[i] + '）';
  };

  // ---- 合法手の列挙（idつき。実行は options 経由で受ける） ----
  Pilot.prototype.build_options = function () {
    var g = this.g, p = this.human();
    var opts = {};
    var freeLeft = this.acts < g.actions_per_turn;

    function add(kind, label, payload, cost) {
      var n = 0;
      for (var k in opts) if (opts.hasOwnProperty(k) && k.indexOf(kind) === 0) n++;
      var oid = kind + ':' + n;
      opts[oid] = {id: oid, kind: kind, label: label, cost: cost || 0, payload: payload};
      return oid;
    }

    var i, si, ri, ru, su, mi, m, pts;
    // 応札（無料・いつでも）
    for (i = 0; i < p.orbit.length; i++) {
      ru = p.orbit[i][0]; su = p.orbit[i][1];
      for (var b = 0; b < g.board.length; b++) {
        mi = g.board[b][0]; m = g.board[b][1];
        pts = g.mission_points(m, su);
        if (pts >= 1) {
          add('answer', su.top.name + '（' + ru.top.name + '）→「' + m.name + '」 = ' +
              pts + '点（+' + (pts * REWARD_PER_PT) + '億）', {orbit: i, mi: mi});
        }
      }
    }
    // 搭載（無料・いつでも）
    for (ri = 0; ri < p.table_r.length; ri++) {
      for (si = 0; si < p.table_s.length; si++) {
        if (p.table_r[ri].top.klass >= p.table_s[si].top.klass) {
          add('load', p.table_r[ri].top.name + ' に ' + p.table_s[si].top.name + ' を搭載',
              {mode: 'pair', r: ri, s: si});
        }
      }
    }
    if (g.dual_launch) {
      var seen = [];
      for (i = 0; i < p.sats.length; i++) {
        ru = p.sats[i][0];
        var n = 0;
        for (var j = 0; j < p.sats.length; j++) if (p.sats[j][0] === ru) n++;
        if (ru.top.klass === 4 && seen.indexOf(ru.uid) < 0 && n < 2) {
          seen.push(ru.uid);
          for (si = 0; si < p.table_s.length; si++) {
            add('load', ru.top.name + '（搭載済）に ' + p.table_s[si].top.name +
                ' を相乗り＝デュアルローンチ準備',
                {mode: 'piggy', rid: ru.uid, s: si});
          }
        }
      }
    }
    if (freeLeft) {
      // 宣言
      if (!this.used.declare) {
        for (i = 0; i < p.hand.length; i++) {
          if (p.hand[i].cost <= p.money) {
            add('declare', p.hand[i].name + ' を開発宣言（-' + p.hand[i].cost + '億）',
                {hand: i}, p.hand[i].cost);
          }
        }
      }
      // 打上（v2.5:「進化」アクションは廃止したので列挙しない）
      if (!this.used.launch && p.money >= LAUNCH_COST) {
        var seenR = [];
        for (i = 0; i < p.sats.length; i++) {
          ru = p.sats[i][0];
          if (seenR.indexOf(ru.uid) >= 0) continue;
          seenR.push(ru.uid);
          var group = [];
          for (var g2 = 0; g2 < p.sats.length; g2++) {
            if (p.sats[g2][0] === ru) group.push(p.sats[g2][1].top.name);
          }
          var ftxt = LAUNCH_FAIL_FACES.slice().sort(function (x, y) { return x - y; })
                                      .join('・');
          var dual = group.length >= 2 ? '（2機同時）' : '';
          add('launch', ru.top.name + ' × ' + group.join('＋') + ' を打上' + dual +
              '（-' + LAUNCH_COST + '億・失敗目: ' + ftxt + '）',
              {rid: ru.uid}, LAUNCH_COST);
        }
      }
      // 交換・資金調達
      if (!this.used.exchange && p.hand.length) {
        add('exchange', '手札を1〜3枚選んで交換', {});
      }
      if (!this.used.fund) {
        add('fund', '資金調達（2d6: 7なら300億・6か8なら200億・他は100億）', {});
      }
    }
    this.options = opts;
    return opts;
  };

  // ---- 人間のアクション実行（成功なら null・失敗なら理由の文字列） ----
  Pilot.prototype.act = function (oid, extra) {
    if (this.phase !== 'human') return 'いまはあなたの手番ではありません';
    var opt = this.options[oid];
    if (!opt) return 'その手は選べません（盤面が変わりました）';
    var g = this.g, p = this.human(), turn = this.turn;
    var kind = opt.kind, pl = opt.payload;
    var log0 = g.log.length, m0 = p.money, s0 = p.score, h0 = p.hand.length;
    var ru, su, i;
    if (kind === 'answer') {
      var rsb = p.orbit[pl.orbit];
      var m = g.missions[pl.mi];
      var pts = g.mission_points(m, rsb[1]);
      p.orbit.splice(pl.orbit, 1);
      g.score_mission(p, rsb[0], rsb[1], pl.mi, m, pts, turn, '📡応札');
    } else if (kind === 'load') {
      if (pl.mode === 'pair') {
        ru = p.table_r.splice(pl.r, 1)[0];
        su = p.table_s.splice(pl.s, 1)[0];
        p.sats.push([ru, su]);
        g.say('  あなた 🔗搭載: ' + ru.top.name + ' に ' + su.top.name + ' を搭載');
      } else {
        ru = null;
        for (i = 0; i < p.sats.length; i++) if (p.sats[i][0].uid === pl.rid) { ru = p.sats[i][0]; break; }
        su = p.table_s.splice(pl.s, 1)[0];
        p.sats.push([ru, su]);
        g.say('  あなた 🔗搭載: ' + ru.top.name + ' に ' + su.top.name + ' を相乗り');
      }
    } else if (kind === 'declare') {
      g.apply_action(p, turn, ['declare', p.hand[pl.hand]]);
      this.used.declare = true;
      this.acts += 1;
    } else if (kind === 'launch') {
      ru = null;
      for (i = 0; i < p.sats.length; i++) if (p.sats[i][0].uid === pl.rid) { ru = p.sats[i][0]; break; }
      // 対象のロケットを先頭へ（Python の list.sort は安定なので相対順は保たれる）
      p.sats = stableSort(p.sats, function (rs) { return rs[0] !== ru ? 1 : 0; });
      g.apply_action(p, turn, ['launch']);   // 成功時、場の課題への自動判定まで行われる
      this.used.launch = true;
      this.acts += 1;
    } else if (kind === 'exchange') {
      var idxs = [];
      (extra || []).forEach(function (x) {
        x = Number(x);
        if (idxs.indexOf(x) < 0) idxs.push(x);
      });
      idxs.sort(function (a, b) { return b - a; });
      var bad = idxs.some(function (x) { return !(x >= 0) || x >= p.hand.length; });
      if (idxs.length < 1 || idxs.length > 3 || bad) {
        return '交換は手札から1〜3枚選んでください';
      }
      var picked = idxs.map(function (x) { return p.hand[x]; });
      g.apply_action(p, turn, ['exchange', picked]);
      this.used.exchange = true;
      this.acts += 1;
    } else if (kind === 'fund') {
      g.apply_action(p, turn, ['fund', false]);
      this.used.fund = true;
      this.acts += 1;
    }
    this.push_event(kind, log0, m0, s0, h0);
    return null;
  };

  /** 安定ソート（key の昇順）。Array#sort は安定だが比較関数を明示する。 */
  function stableSort(arr, key) {
    return arr.map(function (v, i) { return [key(v), i, v]; })
              .sort(function (a, b) { return (a[0] - b[0]) || (a[1] - b[1]); })
              .map(function (t) { return t[2]; });
  }

  /** 演出用の構造化イベント。ログ差分から金額・得点・ダイスを拾う。 */
  Pilot.prototype.push_event = function (kind, log0, m0, s0, h0) {
    var g = this.g, p = this.human();
    var lines = g.log.slice(log0);
    var ev = {kind: kind, money: p.money - m0, score: p.score - s0,
              draw: Math.max(0, p.hand.length - h0)};
    var dice = null;
    for (var i = 0; i < lines.length; i++) {
      var mm = /🎲(\d)\+(\d)/.exec(lines[i]);
      if (mm) dice = [parseInt(mm[1], 10), parseInt(mm[2], 10)];
    }
    ev.dice = dice;
    if (kind === 'launch') {
      ev.success = lines.some(function (l) { return l.indexOf('成功') >= 0; });
      ev.dual = lines.some(function (l) { return l.indexOf('2機同時') >= 0; });
    }
    if (lines.some(function (l) { return l.indexOf('🌏') >= 0; })) ev.reveal = true;
    this.events.push(ev);
  };

  // ---- 状態のJSON化（serve.py の state() と同じ形） ----
  Pilot.prototype.state = function () {
    var g = this.g, p = this.human(), self = this;

    function card_view(c) {
      return {slug: c.slug, name: c.name,
              kind: c.kind === 'R' ? 'rocket' : 'sensor',
              cost: c.cost, gen: c.gen,
              life: ('life' in c && c.life !== undefined) ? c.life : null};
    }
    function unit_view(u) {
      var v = card_view(u.top);
      v.evo = u.evo;
      v.stack = u.stack.map(function (s) { return s.name; });
      return v;
    }

    var opts = this.phase === 'human' ? this.build_options() : {};
    var evOut = this.events;
    this.events = [];
    var board = g.board.map(function (km) {
      return {mi: km[0], slug: km[1].slug, name: km[1].name,
              since: g.revealed_at[km[0]] != null ? g.revealed_at[km[0]] : km[0] + 1};
    });
    var others = g.players.slice(1).map(function (q) {
      return {
        name: self.name(q.i), policy: self.policies[q.i],
        score: q.score, money: q.money, hand: q.hand.length,
        table: q.table_r.concat(q.table_s).map(unit_view),
        sats: q.sats.map(function (rs) { return rs[0].top.name + '×' + rs[1].top.name; }),
        orbit: q.orbit.map(function (rsb) {
          return rsb[1].top.name + '（〜T' + (rsb[2] + rsb[1].top.life - 1) + '年）';
        })
      };
    });
    var sats = [], seenR = [];
    for (var i = 0; i < p.sats.length; i++) {
      var ru = p.sats[i][0];
      if (seenR.indexOf(ru.uid) >= 0) continue;
      seenR.push(ru.uid);
      sats.push({
        rocket: unit_view(ru),
        sensors: p.sats.filter(function (rs) { return rs[0] === ru; })
                       .map(function (rs) { return unit_view(rs[1]); })
      });
    }
    var standings = g.players.map(function (q) {
      return {name: self.name(q.i), score: q.score, money: q.money,
              launch_ok: q.launch_ok};
    }).sort(function (a, b) {
      return cmp([-a.score, -a.money, -a.launch_ok], [-b.score, -b.money, -b.launch_ok]);
    });
    var policies = [];
    for (var k = 1; k < g.players.length; k++) {
      policies.push({name: self.name(k), policy: self.policies[k],
                     desc: POLICY_TEXT[self.policies[k]] || '—'});
    }
    var optList = [];
    for (var oid in opts) {
      if (!opts.hasOwnProperty(oid)) continue;
      var o = opts[oid];
      optList.push({id: o.id, kind: o.kind, label: o.label, cost: o.cost});
    }
    return {
      phase: this.phase, turn: Math.min(this.turn, TURNS), deck: g.deck.length,
      'package': this.package,
      missions_left: g.missions.length - g.next_mi,
      actions_left: Math.max(0, g.actions_per_turn - this.acts),
      used: Object.keys(this.used).sort(),
      policies: policies,
      you: {
        money: p.money, score: p.score,
        hand: p.hand.map(card_view),
        table: p.table_r.concat(p.table_s).map(unit_view),
        sats: sats,
        orbit: p.orbit.map(function (rsb) {
          var v = unit_view(rsb[1]);
          v.rocket = rsb[0].top.name;
          v.until = rsb[2] + rsb[1].top.life - 1;
          return v;
        })
      },
      others: others, board: board,
      options: optList,
      log: g.log, standings: standings,
      events: evOut
    };
  };

  // ---- cardsMeta（serve.py の build_card_pages() の meta 部分） -------------
  var METfor = null;
  function buildCardsMeta() {
    if (METfor) return METfor;
    var raw = rawCards();
    var credits = raw.credits || {};
    var meta = {};
    raw.rockets.forEach(function (d) {
      meta[d.slug] = {name: d.name, lore: d.lore,
                      spec: d.payload_real + '／実績 ' + d.rate_real,
                      credit: credits[d.slug] || ''};
    });
    var names = {};
    raw.sensors.forEach(function (s) { names[s.slug] = s.name; });
    raw.sensors.forEach(function (d) {
      meta[d.slug] = {name: d.name, lore: d.lore,
                      spec: d.spec_real + '／センサ質量 ' + d.mass_real,
                      credit: credits[d.slug] || ''};
    });
    raw.missions.forEach(function (d) {
      var cn = names[d.critical] || d.critical;
      meta[d.slug] = {name: d.name,
                      lore: d.flavor + '\n\nクリティカル（' + cn + '）: ' + d.critical_note,
                      spec: '', credit: ''};
    });
    METfor = meta;
    return meta;
  }

  // ---- 公開API -------------------------------------------------------------
  var cur = null;                       // 現在の Pilot
  var conf = {players: 4, 'package': false, grace: null};

  /** 設定を上書きしつつ Pilot を作り直す。announce=true で /new_game 相当のログを足す。 */
  function newGame(opts, announce) {
    opts = opts || {};
    if (opts.players != null) conf.players = opts.players;
    if (opts['package'] != null) conf['package'] = !!opts['package'];
    if (opts.grace !== undefined) conf.grace = opts.grace;
    var seed = opts.seed != null ? opts.seed
                                 : Math.floor(Math.random() * 1000000);
    cur = new Pilot(conf.players, seed, conf['package'], conf.grace);
    // serve.py は起動時のゲームには何も書かず、/new_game のときだけこの1行を書く
    if (announce) cur.g.say('（新規ゲームを開始しました seed=' + seed + '）');
    return cur.state();
  }

  function ensure() {
    // 初回の /state 相当。serve.py の起動時 Pilot と同じく告知ログは出さない。
    if (!cur) newGame(bootOpts, false);
    return cur;
  }

  /** ページ側で `window.SDGEngineBoot = {players, package, seed, grace}` を先に置くか、
   *  URLに ?players=2&package=1&seed=42&grace=2 を付けると、最初の getState() が
   *  その設定でゲームを起こす（serve.py のコマンドライン引数に相当）。 */
  function queryOpts() {
    var o = {};
    try {
      if (typeof location === 'undefined' || !location.search) return o;
      var q = new URLSearchParams(location.search);
      if (q.has('players')) o.players = parseInt(q.get('players'), 10);
      if (q.has('package')) o['package'] = q.get('package') !== '0';
      if (q.has('seed')) o.seed = parseInt(q.get('seed'), 10);
      if (q.has('grace')) o.grace = parseInt(q.get('grace'), 10);
    } catch (e) { /* URLSearchParams が無い環境では既定値のまま */ }
    return o;
  }
  var bootOpts = Object.assign(queryOpts(),
                               (typeof root !== 'undefined' && root.SDGEngineBoot) || {});

  function guard(fn) {
    // serve.py の do_POST と同じく、想定外の例外で画面を落とさず state.error に出す
    try {
      return fn();
    } catch (e) {
      var out;
      try { out = ensure().state(); } catch (e2) { return {error: 'internal'}; }
      out.error = 'リクエストを処理できませんでした: ' +
                  ((e && e.name) ? e.name : 'Error');
      return out;
    }
  }

  var SDGEngine = {
    /** POST /new_game 相当。{players, package, seed, grace} */
    newGame: function (opts) {
      return guard(function () { return newGame(opts, true); });
    },
    /** GET /state 相当 */
    getState: function () { return guard(function () { return ensure().state(); }); },
    /** POST /act 相当。失敗理由は state.error に入る */
    act: function (id, extra) {
      return guard(function () {
        var pilot = ensure();
        var err = pilot.act(id, extra);
        var out = pilot.state();
        if (err) out.error = err;
        return out;
      });
    },
    /** POST /end_turn 相当 */
    endTurn: function () {
      return guard(function () {
        var pilot = ensure();
        var err = null;
        if (pilot.phase === 'human') pilot.end_turn();
        else err = 'いまはあなたの手番ではありません';
        var out = pilot.state();
        if (err) out.error = err;
        return out;
      });
    },
    /** GET /cards_meta 相当。{slug: {name, lore, spec, credit}} */
    cardsMeta: function () { return buildCardsMeta(); },

    // --- 内部（テスト・自走シミュレーション用） ---
    _internal: {RNG: RNG, Game: Game, Pilot: Pilot, Unit: Unit, Player: Player,
                loadCards: loadCards, argmax: argmax, argmin: argmin,
                TURNS: TURNS, LAUNCH_COST: LAUNCH_COST, REWARD_PER_PT: REWARD_PER_PT,
                pilot: function () { return cur; }}
  };

  // ---- fetch シム -----------------------------------------------------------
  // serve.py の5つのエンドポイントを、そのまま fetch() で受けてエンジンに流す。
  // これがあると index.html の post('/act') や、こちらから触らない opening.js /
  // ending.js の fetch('/new_game') が **1行も直さずに** 静的サイトで動く。
  // 無効化したいときは engine.js を読む前に `window.SDGEngineNoShim = true` を置く。
  var ROUTES = ['/state', '/act', '/end_turn', '/new_game', '/cards_meta'];

  function routeOf(url) {
    var path = String(url == null ? '' : url);
    var i = path.search(/[?#]/);
    if (i >= 0) path = path.slice(0, i);
    if (/^[a-z]+:\/\//i.test(path)) {
      var j = path.indexOf('/', path.indexOf('://') + 3);
      path = j >= 0 ? path.slice(j) : '/';
    }
    for (var k = 0; k < ROUTES.length; k++) {
      var r = ROUTES[k];
      if (path === r || path.slice(-r.length) === r) return r;
    }
    return null;
  }

  function jsonResponse(obj) {
    var body = JSON.stringify(obj);
    if (typeof Response !== 'undefined') {
      return new Response(body, {status: 200,
        headers: {'Content-Type': 'application/json; charset=utf-8'}});
    }
    return {ok: true, status: 200,
            json: function () { return Promise.resolve(JSON.parse(body)); },
            text: function () { return Promise.resolve(body); }};
  }

  var origFetch = null;

  function shimFetch(input, init) {
    var url = (input && typeof input === 'object' && input.url) ? input.url : input;
    var route = routeOf(url);
    if (!route) return origFetch.apply(this, arguments);
    var body = {};
    try {
      var raw = (init && init.body) || null;
      if (typeof raw === 'string' && raw) body = JSON.parse(raw) || {};
    } catch (e) { body = {}; }
    var out;
    if (route === '/cards_meta') out = SDGEngine.cardsMeta();
    else if (route === '/state') out = SDGEngine.getState();
    else if (route === '/new_game') out = SDGEngine.newGame(body);
    else if (route === '/act') out = SDGEngine.act(body.id, body.extra);
    else out = SDGEngine.endTurn();
    return Promise.resolve(jsonResponse(out));
  }

  SDGEngine.installFetchShim = function () {
    if (origFetch || typeof root.fetch !== 'function') return false;
    origFetch = root.fetch.bind(root);
    root.fetch = shimFetch;
    return true;
  };
  SDGEngine.uninstallFetchShim = function () {
    if (!origFetch) return false;
    root.fetch = origFetch;
    origFetch = null;
    return true;
  };

  root.SDGEngine = SDGEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = SDGEngine;
  if (typeof document !== 'undefined' && !root.SDGEngineNoShim) {
    SDGEngine.installFetchShim();
  }
})(typeof window !== 'undefined' ? window : globalThis);
