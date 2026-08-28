/* mission_fx.js — 課題公開の演出＋ナレーター（issue #4）
   ナレーターは実在人物を使わないオリジナルのSVG（管制官）。口パクは mouth の
   scaleY を2値で切り替えるだけ＝軽量。音声は事前生成済み /assets/voice/mission_*.mp3。 */
(() => {
  /* ---- ナレーターキャラ（#3 と共用） ---- */
  const nar = document.createElement('div');
  nar.className = 'sdg-narrator';
  nar.innerHTML = `<svg viewBox="0 0 120 150">
    <defs>
      <linearGradient id="ng-suit" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2f3d63"/><stop offset="1" stop-color="#1b2440"/></linearGradient>
      <radialGradient id="ng-vis" cx=".35" cy=".3">
        <stop offset="0" stop-color="#7fc4ff" stop-opacity=".95"/>
        <stop offset="1" stop-color="#1d4f88" stop-opacity=".9"/></radialGradient>
    </defs>
    <ellipse cx="60" cy="146" rx="34" ry="5" fill="#000" opacity=".35"/>
    <path d="M22 150 V108 q0-24 38-24 t38 24 v42 z" fill="url(#ng-suit)"/>
    <rect x="46" y="96" width="28" height="12" rx="5" fill="#25325a"/>
    <circle cx="60" cy="62" r="36" fill="#e9eefb"/>
    <circle cx="60" cy="62" r="36" fill="none" stroke="#f2c14e" stroke-width="2.5"/>
    <path d="M28 58 a32 30 0 0 1 64 0 v12 a32 34 0 0 1 -64 0 z" fill="url(#ng-vis)"/>
    <path d="M34 52 q14-14 32-12" stroke="#fff" stroke-width="4" fill="none"
          opacity=".6" stroke-linecap="round"/>
    <circle cx="49" cy="64" r="3.4" fill="#0b1226"/><circle cx="71" cy="64" r="3.4" fill="#0b1226"/>
    <ellipse class="mouth" cx="60" cy="77" rx="7" ry="4.6" fill="#0b1226"/>
    <rect x="82" y="104" width="16" height="10" rx="3" fill="#f2c14e"/>
    <circle cx="90" cy="109" r="2" fill="#1c1608"/>
  </svg>`;
  document.body.appendChild(nar);

  window.SDG.narrator = {
    show: on => nar.classList.toggle('on', !!on),
    talk: on => { nar.classList.toggle('on', true); nar.classList.toggle('talk', !!on); },
  };

  /* ---- 課題公開の演出 ---- */
  const fx = document.createElement('div');
  fx.id = 'sdg-mission-fx';
  fx.innerHTML = `<div class="lead">今 年 の 課 題</div>
                  <div class="flip"><iframe></iframe></div>`;
  document.body.appendChild(fx);

  let busy = false;
  fx.onclick = () => close();

  function close() {
    fx.classList.remove('on');
    busy = false;
    window.SDG.narrator.talk(false);
    window.SDG.narrator.show(false);
    if (window.SDG.stopNarration) window.SDG.stopNarration();
  }

  /* 演出は4秒を超えない（10ターン回るゲームのテンポを殺さないため）。
     ナレーションが長い場合は音声だけ裏で続き、カードは畳む。 */
  function reveal(slug) {
    if (busy) return;
    busy = true;
    fx.querySelector('iframe').src = `cards/mission/${slug}.html`;
    fx.classList.add('on');
    window.SDG.narrator.show(true);
    window.SDG.narrator.talk(true);
    if (window.SDG.narrate) {
      window.SDG.narrate(`mission_${slug}`).then(() => window.SDG.narrator.talk(false));
    }
    setTimeout(() => { if (busy) close(); }, 3800);
  }

  /* 場のミッションを監視して、新しいslugが現れたら演出する。
     ただし開幕シーケンス中は出さない。開幕は課題3枚を自前で1枚ずつ見せるので、
     ここが割り込むと「CPUと対戦」を選ぶ前に課題カードが被さってしまう
     （/new_game で場が総入れ替えになり、3枚とも「新しいslug」に見えるため）。 */
  let seen = null;
  function openingRunning() {
    const op = document.getElementById('sdg-open');
    return !!(op && op.classList.contains('on')) || !!window.SDG.openingActive;
  }
  window.SDG.onDraw.push(s => {
    const cur = (s.board || []).map(m => m.slug || m).filter(Boolean);
    if (seen === null) { seen = new Set(cur); return; }   // 初回は演出しない
    if (openingRunning()) { seen = new Set(cur); return; } // 開幕中は同期だけして黙る
    const fresh = cur.filter(x => !seen.has(x));
    cur.forEach(x => seen.add(x));
    if (fresh.length && s.phase !== 'over') reveal(fresh[0]);
  });

  /* 開幕が終わった直後に取りこぼしが出ないよう、外から同期できるようにする */
  window.SDG.syncMissionSeen = board => {
    seen = new Set((board || []).map(m => m.slug || m).filter(Boolean));
  };

  window.SDG.revealMission = reveal;
})();
