/* boot.js — 打上前カウントダウン（初回ロードのローディング画面）

   index.html は盤面のHTMLを先に描き、末尾でCSS7本・JS13本(227KB)を同期で読む。
   タイトル画面(title.js)が出るのは全部読み終わったあと＝DOMContentLoaded なので、
   それまで「素の盤面」が固まったまま見える。実測(初回・キャッシュ無し):
       localhost      DCL   63ms      1.6Mbps/150ms  DCL 1635ms
       0.4Mbps/400ms  DCL 6154ms  ←  6秒間ずっと素の盤面
   その空白を宇宙開発のカウントダウンで埋めて、タイトルへ地続きに渡す。

   ■ 置き場所（順番が結果を決める）
     index.html の <head>、viewport の meta の直後（40KBあるインライン style より前）に
     **このファイルの中身をそのまま script タグの中へ貼る**。
     0.4Mbps/400ms・キャッシュ無しでの初回描画の実測:
         ローディング画面なし                        0.69s（＝素の盤面が見えてしまう）
         head 先頭で <script src="assets/boot.js">   2.2〜2.6s（1往復ぶん遅れる）
         head 先頭に中身を直接貼る                    1.05s（推奨）
     外部ファイルにすると「ローディング画面自身の読み込み待ち」が発生して本末転倒。
     （gzip の効く配信なら 17.8KB → 7.3KB なので外部でも差は縮む）
     assets/boot.js は原本として残し、貼り付け元はここ一箇所にする。

   ■ 進捗は実測のみ。固定アニメーションでごまかさない
     A  0→18%  HTML本体の到着量  documentElement.outerHTML の長さ / 44KB
     B 18→92%  CSS/JSの読み込み  MutationObserver で発見 → load/error と
                                 PerformanceObserver('resource') で完了判定。
                                 重み＝実測の転送バイト数（engine.js 51KB が最大）
     C   →100%  DOMContentLoaded ＝ title.js が実行され #sdg-title が生まれた瞬間

   ■ 自分は何も待たない
     CSS もこの中の文字列から <style> で注入する。boot.css は「遅れて届いても
     増えるだけ」の装飾だけを持つ（body より後ろで読まれるため）。
   ■ index.html / title.js には触らない。タイトルの出現は DOM 監視で拾う。 */
(function () {
  'use strict';
  if (window.__sdgBoot) return;
  var doc = document;
  try { if (/[?&]noboot=1/.test(location.search)) return; } catch (_) {}   // 演出デバッグ用

  var t0 = performance.now ? performance.now() : Date.now();
  var since = function () { return (performance.now ? performance.now() : Date.now()) - t0; };
  var reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
  var finished = false;

  /* ---------------------------------------------------------------- 見た目
     配色は index.html / board.css の :root と同じ値。まだ :root が読まれていない
     時点で描くので var(--x, 実値) で二重に持つ。背景のグラデーションは
     title.css の #sdg-title と完全に同一 ＝ 重ねてフェードしても背景が動かない。 */
  var CSS =
  '#sdg-boot{position:fixed;inset:0;z-index:2000;overflow:hidden;display:flex;' +
    'align-items:center;justify-content:center;color:var(--tx,#e8ecf8);' +
    'font-family:"Hiragino Sans","Noto Sans JP",sans-serif;opacity:1;transition:opacity .42s ease;' +
    'background:radial-gradient(120% 90% at 50% 118%,#16305c 0%,#0b1226 42%,#05070f 100%)}' +
  '#sdg-boot.out{opacity:0;pointer-events:none}' +
  /* 星空。title.js の Canvas と同じく上へ流れる */
  '#sdg-boot .stars{position:absolute;left:0;right:0;top:-360px;bottom:-360px;pointer-events:none}' +
  '#sdg-boot .s1{opacity:.62;background-size:240px 240px;animation:sdgbDrift 46s linear infinite;background-image:' +
    'radial-gradient(1.3px 1.3px at 24px 38px,#dce9ff,transparent),' +
    'radial-gradient(1px 1px at 128px 96px,#cfe0ff,transparent),' +
    'radial-gradient(1.6px 1.6px at 196px 22px,#fff,transparent),' +
    'radial-gradient(1px 1px at 72px 178px,#bcd2f5,transparent),' +
    'radial-gradient(1.2px 1.2px at 168px 214px,#e8f1ff,transparent)}' +
  '#sdg-boot .s2{opacity:.38;background-size:360px 360px;animation:sdgbDrift 84s linear infinite;background-image:' +
    'radial-gradient(1px 1px at 60px 20px,#aec6ee,transparent),' +
    'radial-gradient(.9px .9px at 300px 140px,#c8dbff,transparent),' +
    'radial-gradient(1.1px 1.1px at 210px 300px,#dce9ff,transparent),' +
    'radial-gradient(.9px .9px at 20px 250px,#9fb8e6,transparent)}' +
  '@keyframes sdgbDrift{to{transform:translateY(-360px)}}' +
  /* 遠くの地球。title.css の .earth(top:76vh) より低く暗く置き、
     タイトルの earthRise が「せり上がってくる」余地を残す */
  '#sdg-boot .horizon{position:absolute;left:50%;top:86vh;width:260vw;height:260vw;opacity:.5;' +
    'transform:translateX(-50%);border-radius:50%;pointer-events:none;' +
    'background:radial-gradient(circle at 50% 2%,#2f6aab 0%,#1a4478 6%,#0d2547 14%,#071427 30%,#050b16 60%);' +
    'box-shadow:0 0 70px 12px rgba(90,170,255,.20),inset 0 6px 30px rgba(160,215,255,.14)}' +
  '#sdg-boot .core{position:relative;z-index:3;width:min(560px,84vw);text-align:center}' +
  '#sdg-boot .kick{font-size:11px;letter-spacing:.34em;text-indent:.34em;margin-bottom:20px;color:var(--dim,#96a0c0)}' +
  '#sdg-boot .ph{min-height:32px;font-size:clamp(19px,3.4vw,25px);font-weight:800;color:#eaf1ff;' +
    'letter-spacing:.14em;text-shadow:0 0 22px rgba(120,190,255,.45)}' +
  '#sdg-boot .sub{min-height:18px;margin:4px 0 24px;font-size:12px;letter-spacing:.16em;color:var(--dim,#96a0c0)}' +
  /* 数字は等幅にして桁が変わっても踊らせない */
  '#sdg-boot .pct{font-size:clamp(40px,8vw,62px);font-weight:800;line-height:1;color:#fff;' +
    'font-variant-numeric:tabular-nums;font-feature-settings:"tnum";' +
    'text-shadow:0 0 30px rgba(120,190,255,.5),0 4px 20px rgba(0,0,0,.7)}' +
  '#sdg-boot .pct i{font-style:normal;font-size:.38em;margin-left:.18em;letter-spacing:.1em;color:var(--acc,#f2c14e)}' +
  /* 軌道＝プログレスバー */
  '#sdg-boot .track{position:relative;height:4px;margin-top:22px;border-radius:3px;' +
    'background:rgba(160,190,255,.10);box-shadow:inset 0 0 0 1px var(--line,#2a3355)}' +
  '#sdg-boot .fill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:3px;' +
    'background:linear-gradient(90deg,#e89a2b,#f2c14e 60%,#fff3cd);' +
    'box-shadow:0 0 14px rgba(242,193,78,.75);transition:width .3s cubic-bezier(.3,.8,.35,1)}' +
  '#sdg-boot .ship{position:absolute;top:50%;left:0;font-size:18px;line-height:1;' +
    'transform:translate(-50%,-58%);filter:drop-shadow(0 0 9px #ffb84d);' +
    'transition:left .3s cubic-bezier(.3,.8,.35,1)}' +
  /* 段階マーカー MECO=第1段燃焼終了 / SEP=フェアリング分離 / SECO=第2段燃焼終了 */
  '#sdg-boot .marks{position:relative;height:16px;margin-top:9px;font-size:9px;letter-spacing:.18em;color:#6f80a6}' +
  '#sdg-boot .marks span{position:absolute;transform:translateX(-50%);white-space:nowrap}' +
  '#sdg-boot .marks span::before{content:"";position:absolute;left:50%;top:-11px;width:1px;height:6px;' +
    'background:var(--line,#2a3355)}' +
  '#sdg-boot .marks span.on{color:var(--acc,#f2c14e)}' +
  '#sdg-boot .marks span.on::before{background:var(--acc,#f2c14e)}' +
  /* 実際に受け取ったファイル名を出す（進捗が本物であることが目に見える） */
  '#sdg-boot .now{height:15px;margin-top:16px;font-size:10.5px;color:#7f8fb5;opacity:.85;' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '#sdg-boot .skip{height:16px;margin-top:20px;font-size:11px;letter-spacing:.1em;color:#6f80a6;' +
    'opacity:0;pointer-events:none;transition:opacity .5s ease}' +
  '#sdg-boot .skip.on{opacity:1;cursor:pointer;pointer-events:auto}' +
  '#sdg-boot .skip.on:hover{color:var(--acc,#f2c14e)}' +
  /* 動きを減らす設定では漂う星も滑らかな伸びも止め、数字とバーだけ更新する */
  '@media (prefers-reduced-motion:reduce){#sdg-boot .s1,#sdg-boot .s2{animation:none}' +
    '#sdg-boot .fill,#sdg-boot .ship{transition:none}#sdg-boot{transition:opacity .01s linear}}';

  var st = doc.createElement('style');
  st.id = 'sdg-boot-style';
  st.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(st);

  /* ------------------------------------------------------------------ DOM
     head で走るので <body> はまだ無い。position:fixed なので documentElement の
     直下に置いてもレイアウトには影響しない。.neb は boot.css が後から色を乗せる箱。 */
  var root = doc.createElement('div');
  root.id = 'sdg-boot';
  root.setAttribute('role', 'progressbar');
  root.setAttribute('aria-label', '読み込み中');
  root.setAttribute('aria-valuemin', '0');
  root.setAttribute('aria-valuemax', '100');
  root.setAttribute('aria-valuenow', '0');
  root.innerHTML =
    '<div class="neb"></div><div class="stars s1"></div><div class="stars s2"></div>' +
    '<div class="horizon"></div>' +
    '<div class="core">' +
      '<div class="kick">SPACE DEVELOPMENT RACE</div>' +
      '<div class="ph">T-10 カウントダウン</div>' +
      '<div class="sub">全システム点検</div>' +
      '<div class="pct">0<i>%</i></div>' +
      '<div class="track"><div class="fill"></div><div class="ship">🚀</div></div>' +
      '<div class="marks"><span data-at="36" style="left:36%">MECO</span>' +
        '<span data-at="58" style="left:58%">SEP</span>' +
        '<span data-at="92" style="left:92%">SECO</span></div>' +
      '<div class="now"></div>' +
      '<div class="skip">クリックで表示をとばす</div>' +
    '</div>';
  (doc.body || doc.documentElement).appendChild(root);

  var elPh = root.querySelector('.ph'), elSub = root.querySelector('.sub');
  var elPct = root.querySelector('.pct'), elFill = root.querySelector('.fill');
  var elShip = root.querySelector('.ship'), elNow = root.querySelector('.now');
  var elSkip = root.querySelector('.skip'), marks = root.querySelectorAll('.marks span');
  window.__sdgBoot = {el: root, t0: t0};

  /* ------------------------------------------------- A. HTML本体の到着量
     index.html は 44KB。うち約40KBが head のインライン <style> で、遅い回線では
     ここが最初の壁になる。パーサが流し込んだぶんだけ outerHTML が伸びる。 */
  var HTML_BYTES = 44000;
  function parseRatio() {
    if (doc.readyState !== 'loading') return 1;
    try { return Math.min(1, doc.documentElement.outerHTML.length / HTML_BYTES); }
    catch (_) { return 0; }
  }

  /* ------------------------------------------------- B. CSS/JS の読み込み
     重み＝実測の転送バイト数(KB)。表に無いものは 5KB とみなす（外れても
     「終わった本数の割合」から大きくはずれない）。 */
  var WEIGHT = {
    'engine.js': 50, 'board.css': 27, 'ending.js': 22, 'cards.js': 22, 'title.css': 19,
    'opening.js': 16, 'ending.css': 14, 'narrator.js': 11, 'sfx.js': 9, 'rules.js': 9,
    'title.js': 6, 'narrate.js': 5, 'mission_fx.js': 5, 'card_fx.js': 4, 'narrator.css': 3,
    'boot.css': 1, 'cpu_digest.css': 1, 'launch_fx.css': 1, 'cpu_digest.js': 1, 'launch_fx.js': 1
  };
  var PRIOR_COUNT = 20;      // 実測: CSS 7本 + JS 13本
  var PRIOR_WEIGHT = 227;    // 実測: 合計 227KB
  var items = {}, list = [], parsedAll = false;

  function abs(u) { try { return new URL(u, doc.baseURI).href; } catch (_) { return String(u); } }
  function track(url) {
    var k = abs(url);
    if (!items[k]) { items[k] = {w: WEIGHT[k.split('?')[0].split('/').pop()] || 5, done: false, url: k};
                     list.push(items[k]); }
    return items[k];
  }
  function finish(it) {
    if (!it || it.done) return;
    it.done = true;
    elNow.textContent = '受信 ' + it.url.replace(/^.*\/(assets\/)?/, '');
    paint();
  }
  function register(el) {
    var url = el.tagName === 'LINK' ? el.getAttribute('href') : el.getAttribute('src');
    if (!url) return;
    var it = track(url);
    var fin = function () { finish(it); };
    el.addEventListener('load', fin);
    el.addEventListener('error', fin);         // 失敗もここで止めない（完了扱い）
    try {                                      // キャッシュ済みで load を取り逃した場合
      var e = performance.getEntriesByName(it.url);
      if (e.length && e[e.length - 1].responseEnd > 0) finish(it);
    } catch (_) {}
  }
  function scan(n) {
    if (!n || n.nodeType !== 1) return;
    if (n.tagName === 'SCRIPT' && n.src) register(n);
    else if (n.tagName === 'LINK' && /stylesheet/i.test(n.rel || '') && n.href) register(n);
    if (n.querySelectorAll) {
      var q = n.querySelectorAll('script[src],link[rel~="stylesheet"]');
      for (var i = 0; i < q.length; i++) scan(q[i]);
    }
  }

  var mo = null;
  try {
    mo = new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) {
        var a = recs[i].addedNodes;
        for (var j = 0; j < a.length; j++) {
          scan(a[j]);
          // タイトル画面が生まれたら引き渡し（?gate=1 のときは #sdg-gate が先に出る）
          if (a[j].nodeType === 1 && (a[j].id === 'sdg-title' || a[j].id === 'sdg-gate')) done();
        }
      }
    });
    mo.observe(doc.documentElement, {childList: true, subtree: true});
  } catch (_) {}

  // load イベントを取り逃したぶんの保険。buffered:true で boot 実行前のぶんも拾う。
  try {
    new PerformanceObserver(function (l) {
      var es = l.getEntries();
      for (var i = 0; i < es.length; i++) {
        var e = es[i];
        if (items[e.name]) finish(items[e.name]);
        else if (e.initiatorType === 'script' || e.initiatorType === 'link') finish(track(e.name));
      }
    }).observe({type: 'resource', buffered: true});
  } catch (_) {}

  function resourceRatio() {
    var tot = 0, don = 0;
    for (var i = 0; i < list.length; i++) { tot += list[i].w; if (list[i].done) don += list[i].w; }
    /* まだ全部の script/link を見つけていない間は実測の総量を分母の下限にする。
       これが無いと「見つけた2本が終わった＝100%」と嘘をつき、あとで巻き戻る。 */
    if (!parsedAll && list.length < PRIOR_COUNT) tot = Math.max(tot, PRIOR_WEIGHT);
    return tot > 0 ? Math.min(1, don / tot) : 0;
  }

  /* ------------------------------------------------------------------ 表示 */
  var PHASES = [
    [0,   'T-10 カウントダウン', '全システム点検'],
    [14,  '点火',              'メインエンジン始動'],
    [36,  'リフトオフ',         '第1段燃焼'],
    [58,  'フェアリング分離',    '大気圏を抜ける'],
    [76,  '第2段燃焼',          'ミッションデータ受信'],
    [92,  '軌道投入',           '姿勢を安定させています'],
    [100, '軌道投入 完了',      'ミッション開始']
  ];
  var shown = 0, phaseIx = -1;      // shown は単調増加（巻き戻さない）

  function paint() {
    var p = 18 * parseRatio() + 74 * resourceRatio();
    if (doc.readyState !== 'loading') p = Math.max(p, 92);
    if (finished) p = 100;
    if (p > shown) shown = p;
    var v = Math.min(100, Math.round(shown));

    elPct.firstChild.nodeValue = String(v);
    elFill.style.width = v + '%';
    elShip.style.left = v + '%';
    root.setAttribute('aria-valuenow', String(v));

    var ix = 0;
    for (var i = 0; i < PHASES.length; i++) if (v >= PHASES[i][0]) ix = i;
    if (ix !== phaseIx) { phaseIx = ix; elPh.textContent = PHASES[ix][1]; elSub.textContent = PHASES[ix][2]; }
    for (var m = 0; m < marks.length; m++) {
      if (v >= +marks[m].getAttribute('data-at')) marks[m].classList.add('on');
    }
  }
  var timer = setInterval(paint, reduce ? 200 : 90);
  paint();

  /* -------------------------------------------------------------- 引き渡し
     DOMContentLoaded ＝ 末尾の title.js まで実行が終わった瞬間で、このとき
     #sdg-title は既に DOM にある（?fx / ?rules のデモ時だけ存在しない）。 */
  function done() {
    if (finished) return;
    finished = true;
    paint();
    clearInterval(timer);
    if (mo) try { mo.disconnect(); } catch (_) {}
    /* 速い環境（キャッシュ済み・localhost）では見えるか見えないかの一瞬。
       そこにフェードを挟むと逆に「ちらつく板」になるので即座に消す。
       最低表示時間は設けない。 */
    if (since() < 260 || reduce) return remove();
    /* title.css の earthRise / chDrop は #sdg-title が入った瞬間から動いている。
       背景グラデーションが同一なので、重ねてフェードすると背景は静止したまま
       地球とタイトル文字だけが下から現れる。 */
    requestAnimationFrame(function () {
      root.classList.add('out');
      setTimeout(remove, 460);
    });
  }
  function remove() {
    if (root.parentNode) root.parentNode.removeChild(root);
    if (st.parentNode) st.parentNode.removeChild(st);
    window.__sdgBoot.gone = true;
  }

  doc.addEventListener('DOMContentLoaded', function () {
    parsedAll = true; paint();
    requestAnimationFrame(done);
  });
  doc.addEventListener('readystatechange', function () {
    if (doc.readyState !== 'loading') { parsedAll = true; paint(); }
    if (doc.readyState === 'complete') done();
  });
  window.addEventListener('load', done);
  setTimeout(done, 20000);                                        // 何が詰まっても明け渡す
  setTimeout(function () { if (!finished) elSkip.classList.add('on'); }, 6000);
  root.addEventListener('click', function () { if (elSkip.classList.contains('on')) done(); });
})();
