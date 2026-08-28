/* narrate.js — ナレーション再生と字幕（issue #6 のクライアント側）
   音声は tools/narrate.py が事前生成した /assets/voice/*.mp3。
   会場で音が出せない場合に備え、字幕は常に出す。 */
(() => {
  let MF = {};
  let cur = null;
  let muted = localStorage.getItem('sdg_mute') === '1';

  /* manifest の読み込みが終わる前に narrate() が呼ばれると、meta が無いまま
     「字幕だけ・無音」で進んでしまう（ルール解説の最初のシーンで実際に発生）。
     Promise を持っておき、narrate() 側で必ず待つ。 */
  const MFREADY = fetch('assets/voice/manifest.json').then(r => r.json()).then(m => {
    MF = m;
    window.SDG._manifest = m;      // 字幕を参照する側（rules.js 等）とも共有する
    // 音声エンジンのクレジット表記（VOICEVOX 利用時は規約上必須）
    const c = m._credit;
    if (c) {
      const d = document.createElement('div');
      d.id = 'sdg-credit';
      d.textContent = c;
      document.body.appendChild(d);
    }
  }).catch(() => {});

  const bar = document.createElement('div');
  bar.id = 'sdg-caption';
  document.body.appendChild(bar);

  function showCaption(text, ms) {
    if (!text) return;
    // ルール画面はパネル内に字幕を出すので、グローバル字幕バーは黙らせる（二重表示の防止）
    const r = document.getElementById('sdg-rules');
    if (r && r.classList.contains('on')) { bar.classList.remove('on'); return; }
    bar.textContent = text;
    bar.classList.add('on');
    clearTimeout(bar._t);
    bar._t = setTimeout(() => bar.classList.remove('on'), ms);
  }

  /* narrate(id) — 音声＋字幕。音声が無くても字幕だけで成立させる。
     返り値は「読み終わるまで」の Promise（呼び出し側は await しなくてよい）。 */
  /* 同時に鳴らしてよい音声は常に1本だけ。
     narrate() は await が入るので、連続で呼ばれると古い呼び出しの続きが
     新しい音声に被さることがある。世代番号で古い方を必ず捨てる。 */
  let gen = 0;
  async function narrate(id, opts = {}) {
    const my = ++gen;
    stop();                        // 先に止める（マニフェスト待ちの間に鳴り続けないように）
    await MFREADY;
    if (my !== gen) return;        // より新しい narrate が来ていたら、この回は捨てる
    return speak(id, opts, my);
  }

  function speak(id, opts = {}, my = null) {
    const meta = (id && id[0] !== '_') ? MF[id] : null;
    const text = opts.text || (meta && meta.text) || '';
    const dur = (meta && meta.dur ? meta.dur : Math.max(2, text.length * 0.18)) * 1000;
    showCaption(text, dur + 400);
    stop();
    // 音声が鳴らない場合（ミュート・自動再生ブロック・音声デバイスなし）でも、
    // 字幕を読める時間は必ず確保する。ここを即resolveにすると演出が一瞬で流れてしまう。
    const fallback = () => new Promise(r => setTimeout(r, Math.min(dur, 4500)));
    if (muted || !meta) return fallback();
    return new Promise(res => {
      if (my !== null && my !== gen) { res(); return; }   // 追い越されていたら鳴らさない
      const a = new Audio(`assets/voice/${id}.mp3`);
      a.volume = 0.9;
      cur = a;
      let settled = false;
      const done = () => { if (!settled) { settled = true; cur = null; res(); } };
      a.onended = done;
      a.onerror = () => { if (!settled) { settled = true; cur = null; fallback().then(res); } };
      a.play().catch(() => { if (!settled) { settled = true; cur = null; fallback().then(res); } });
    });
  }
  function stop(bump) { if (cur) { cur.pause(); cur = null; } if (bump) gen++; }

  // ミュートトグル（発表中に片手で切れるように右上固定）
  const mb = document.createElement('button');
  mb.id = 'sdg-mute';
  const paint = () => mb.textContent = muted ? '🔇 音声OFF' : '🔊 音声ON';
  paint();
  mb.onclick = () => { muted = !muted; localStorage.setItem('sdg_mute', muted ? '1' : '0');
                       if (muted) stop(); paint(); };
  document.body.appendChild(mb);

  window.SDG.narrate = narrate;
  window.SDG.stopNarration = () => stop(true);
  window.SDG.caption = showCaption;
  window.SDG.isMuted = () => muted;
})();
