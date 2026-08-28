/* title.js — オープニング画面（issue #2）
   動画は使わない: インラインDOM＋CSS＋軽量Canvasのみ。初回ロードを増やさず、
   どの解像度でも綺麗に出る。星のCanvasは可視時のみ回す。 */
(() => {
  const TITLE = '宇宙開発レース';
  const params = new URLSearchParams(location.search);
  const force = params.has('title');
  if ((params.has('fx') || params.has('rules')) && !force) return;            // 演出単体デモ時は出さない

  /* ?gate=1 — 登壇用の確実な入口。
     ページロード直後は Chrome の自動再生ポリシーで音が鳴らない（NotAllowedError）。
     先に1クリックもらってから演出を始めれば、効果音とナレーションが確実に鳴る。
     既定（gate なし）の挙動は変えていない。 */
  function gateThen(start) {
    const g = document.createElement('div');
    g.id = 'sdg-gate';
    g.innerHTML = `<div class="gwrap">
        <div class="gk">SPACE DEVELOPMENT RACE</div>
        <div class="gb">▶</div>
        <div class="gt">クリックして開始</div>
        <div class="gs">音声が再生されます</div>
      </div>`;
    document.body.appendChild(g);
    g.onclick = () => {
      // 無音を1回鳴らして自動再生ロックを外してから本編へ
      try { const a = new Audio(); a.volume = 0; const pr = a.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (_) {}
      g.classList.add('out');
      setTimeout(() => {
        g.remove();
        start();
        if (window.SDG.replaySfx) window.SDG.replaySfx();   // ゲート中に潰れたSEを張り直す
      }, 380);
    };
  }

  const el = document.createElement('div');
  el.id = 'sdg-title';
  el.innerHTML = `
    <canvas></canvas>
    <div class="earth"></div><div class="atmo"></div>
    <div class="trail"></div><div class="spark">🚀</div>
    <div class="wrap">
      <h1>${[...TITLE].map((c, i) =>
        `<span style="animation-delay:${(0.55 + i * 0.1).toFixed(2)}s">${c}</span>`).join('')}</h1>
      <div class="rule"></div>
      <div class="sub">地球への貢献度を競うカードゲーム</div>
      <div class="meta">実在するロケットと地球観測衛星の実データで遊ぶ &nbsp;/&nbsp; 10 TURNS</div>
      <div class="btns">
        <button class="go">▶ ゲームを始める</button>
      </div>
    </div>
    <div class="skip">クリックで開始　/　Esc でルール説明をスキップ</div>`;
  if (params.has('gate')) {
    el.style.display = 'none';
    gateThen(() => { el.style.display = ''; el.classList.add('replay'); });
  }
  document.body.appendChild(el);

  /* --- 星空（Canvas・軽量） --- */
  const cv = el.querySelector('canvas');
  const ctx = cv.getContext('2d');
  let stars = [], raf = null, dead = false;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    const d = Math.min(devicePixelRatio || 1, 2);
    cv.width = innerWidth * d; cv.height = innerHeight * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    stars = Array.from({length: Math.min(150, Math.round(innerWidth / 9))}, () => ({
      x: Math.random() * innerWidth, y: Math.random() * innerHeight,
      r: Math.random() * 1.25 + .25, a: Math.random() * .6 + .25,
      tw: Math.random() * .02 + .004, v: Math.random() * .08 + .015,
    }));
  }
  function frame(t) {
    if (dead) return;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const s of stars) {
      s.y -= s.v; if (s.y < -2) { s.y = innerHeight + 2; s.x = Math.random() * innerWidth; }
      const a = s.a + Math.sin(t * s.tw) * .3;
      ctx.globalAlpha = Math.max(.05, Math.min(1, a));
      ctx.fillStyle = '#dCE9ff';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.284); ctx.fill();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  resize(); addEventListener('resize', resize);
  if (!reduce) raf = requestAnimationFrame(frame);
  else { ctx.fillStyle = '#dCE9ff'; stars.forEach(s => { ctx.globalAlpha = s.a;
         ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.284); ctx.fill(); }); ctx.globalAlpha = 1; }

  /* --- 閉じる --- */
  let closed = false;
  function close(then) {
    if (closed) return; closed = true;
    el.classList.add('out');
    setTimeout(() => { dead = true; if (raf) cancelAnimationFrame(raf); el.remove(); if (then) then(); }, 640);
  }
  /* 次の画面を「先に」出してからタイトルをフェードさせる。
     タイトルは z-index 960 で開幕(940)/ルール(950)より上なので、
     下にカーテンが立った状態で消える＝盤面が一瞬覗くことがない。 */
  function handoff(raise) {
    if (closed) return;
    if (raise) raise();
    close();
  }
  const startGame = () => handoff(() => window.SDG.beginGame && window.SDG.beginGame());
  const startRules = () => handoff(() => window.SDG.showRules && window.SDG.showRules(
    () => window.SDG.beginGame && window.SDG.beginGame()));    // 見終えたらそのままゲームへ

  el.querySelector('.go').onclick = e => { e.stopPropagation(); startRules(); };
  el.onclick = () => startRules();
  // Esc だけは説明を飛ばして直接ゲームへ（発表で時間が押したとき用）
  addEventListener('keydown', e => { if (e.key === 'Escape') startGame(); }, {once: true});

  window.SDG.scene.title = { close, replay: () => location.search = '?title=1' };
})();
