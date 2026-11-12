// ======================================================================
// Learn → Hear → Say → Review → Shadow
// Built on top of index.html (reuses its recorder, scoring, load(), item, $ and esc()).
//
// Research behind the order (sources are listed on the Today tab):
//   1. Explicit instruction on specific features works (Saito & Plonsky 2019).
//   2. Prosody (stress/rhythm) and high "functional load" sounds matter most for being understood.
//   3. Ear training with MANY different voices (HVPT) improves perception and carries over to speech.
//   4. Production practice with feedback; longer programmes with feedback show bigger effects.
//   5. Spaced review beats cramming for memory (Cepeda et al. 2006).
//   6. Shadowing helps rhythm, fluency and overall comprehensibility.
// ======================================================================

const VOICE_NAME = v => {
  const m = v.match(/^en-(US|GB|IN)-(\w+?)(Multilingual)?Neural$/);
  const flag = { US: '🇺🇸', GB: '🇬🇧', IN: '🇮🇳' }[m?.[1]] || '';
  return `${m ? m[2] : v} ${flag}`;
};
const ACCENT_NAME = { gb: 'British', in: 'Indian' };
const rnd = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
const ls = (k, d) => JSON.parse(localStorage.getItem(k) || 'null') ?? d;
const lsSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ---------- progress ----------
function unitProgress(id) { return ls('aa-units', {})[id] || { read: false, quizBest: 0, said: {} }; }
function updateUnit(id, fn) { const all = ls('aa-units', {}); all[id] ||= { read: false, quizBest: 0, said: {} }; fn(all[id]); lsSet('aa-units', all); }
function stepsDone(U) {
  const p = unitProgress(U.id);
  const said = U.words.filter(w => p.said[w.id] != null).length;
  return { read: p.read, hear: p.quizBest >= 0.8, quizBest: p.quizBest, said, say: said === U.words.length };
}
const unitDone = U => { const d = stepsDone(U); return d.read && d.hear && d.say; };
const nextUnit = () => CURRICULUM.find(U => !unitDone(U)) || null;
function markActive() { const d = ls('aa-days', []); if (!d.includes(today())) { d.push(today()); lsSet('aa-days', d.slice(-800)); } }
function streakDays() {
  const days = new Set([...ls('aa-days', []), ...ls('aa-history', []).map(x => x.d)]);
  let s = 0, d = today();
  if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)) { s++; d = addDays(d, -1); }
  return s;
}

// ---------- spaced repetition (Leitner boxes) ----------
const INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60];      // days until next review, by box
const srs = () => ls('aa-srs', {});
function addCard(id) { const s = srs(); if (!s[id]) { s[id] = { box: 1, due: addDays(today(), 1), reps: 0 }; lsSet('aa-srs', s); } }
function gradeCard(id, g) {
  const s = srs(), c = s[id] || { box: 1, reps: 0 };
  c.box = g === 'again' ? 1 : Math.min(INTERVALS.length - 1, c.box + (g === 'easy' ? 2 : 1));
  c.due = addDays(today(), g === 'again' ? 1 : INTERVALS[c.box]);
  c.reps++; c.last = today();
  s[id] = c; lsSet('aa-srs', s); markActive();
}
const ALL_WORDS = () => CURRICULUM.flatMap(U => U.words.map(w => ({ ...w, unitObj: U })));
const wordById = id => ALL_WORDS().find(w => w.id === id);
const dueCards = () => Object.entries(srs()).filter(([id, c]) => c.due <= today() && wordById(id)).map(([id]) => id);

// ---------- clip playback ----------
let clipAudio = new Audio();
function playClip(src) {
  return new Promise(res => {
    clipAudio.pause(); refAudio.pause(); myAudio.pause();
    clipAudio = new Audio(src); clipAudio.onended = res; clipAudio.onerror = res;
    clipAudio.play().catch(res);
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- the shared recorder panel moves between screens ----------
function parkPractice() { $('shadowSlot').appendChild($('practice')); $('practiceExtra').innerHTML = ''; window.onScored = null; }
function mountPractice(container) { container.appendChild($('practice')); }
async function practise(w, U, autoplay = true) {
  await load({ ...w, focus: U ? `${U.emoji} ${U.title}: ${U.how[0]}` : null });
  if (autoplay) { try { playRef(); } catch (e) {} }
}

// ======================================================================
// Tabs
// ======================================================================
let currentTab = 'today', openUnit = null, unitStep = 'read';
function showTab(t) {
  currentTab = t; localStorage.setItem('aa-tab', t);
  clipAudio.pause(); refAudio.pause(); myAudio.pause();
  parkPractice();
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + t));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (t === 'today') renderToday();
  if (t === 'learn') renderLearn();
  if (t === 'review') renderReview();
  if (t === 'shadow' && item && item.level === 'unit') pick();
  if (t === 'coach') { renderStats(); renderFlaws(); renderCoach(); }
  updateBadge();
}
window.showTab = showTab;
function updateBadge() {
  const n = dueCards().length; $('dueBadge').textContent = n; $('dueBadge').classList.toggle('hidden', !n);
  const s = streakDays(), U = nextUnit();
  $('sideStats').innerHTML = `🔥 Streak <b>${s}</b> day${s === 1 ? '' : 's'}<br>🔁 Due today <b>${n}</b><br>📘 Units <b>${CURRICULUM.filter(unitDone).length}/${CURRICULUM.length}</b>` +
    (U ? `<br><span class="hint">Next: ${U.emoji} ${esc(U.title)}</span>` : '');
}

// Computer keyboard shortcuts for the Learn tab (the recorder keeps its own: Space / P)
document.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (currentTab !== 'learn' || !openUnit) return;
  const click = id => { const el = $(id); if (el && !el.disabled) { e.preventDefault(); el.click(); return true; } };
  if (unitStep === 'read' && e.key === 'Enter') return click('gotIt');
  if (unitStep !== 'hear') return;
  if (e.key === 'Enter') return click('qNext') || click('qStart') || click('qSay') || click('qAgain');
  if (e.key === 'r' || e.key === 'R') return click('qPlay') || click('qAB');
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9) { const b = document.querySelector(`[data-opt="${n - 1}"]`); if (b && !b.disabled) { e.preventDefault(); b.click(); } }
});
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

// ======================================================================
// Today: the daily routine
// ======================================================================
function renderToday() {
  const due = dueCards().length, U = nextUnit(), doneUnits = CURRICULUM.filter(unitDone).length;
  const cards = Object.keys(srs()).length;
  let learnLine = '🎉 All 9 units finished — keep reviewing and shadowing.';
  if (U) {
    const d = stepsDone(U);
    const step = !d.read ? 'Understand the sound' : !d.hear ? 'Train your ear' : `Say the words (${d.said}/${U.words.length})`;
    learnLine = `<b>Unit ${CURRICULUM.indexOf(U) + 1}: ${esc(U.title)}</b> — next: ${step}`;
  }
  $('tab-today').innerHTML = `
  <div class="cols wide-left">
  <div class="card">
    <h2>Your plan for today (about 20 minutes)</h2>
    <ol class="plan">
      <li><b>🔁 Review</b> — ${due ? `<b>${due}</b> word${due === 1 ? '' : 's'} due. Keeps what you learned from fading.` : 'nothing due today ✓'}
        ${due ? '<br><button class="small primary" id="goReview">Start review</button>' : ''}</li>
      <li><b>📘 Learn</b> — ${learnLine}${U ? '<br><button class="small primary" id="goLearn">Continue</button>' : ''}</li>
      <li><b>🎧 Shadow</b> — 3 sentences, copying the American rhythm. ${doneUnits ? 'Uses sentences from units you finished.' : ''}
        <br><button class="small" id="goShadow">Shadow now</button></li>
    </ol>
  </div>
  <div class="card"><h2>Progress</h2><div class="stats">
    <div>Units finished<br><b>${doneUnits} / ${CURRICULUM.length}</b></div>
    <div>Words in your deck<br><b>${cards}</b></div>
    <div>Due today<br><b>${due}</b></div>
    <div>Streak<br><b>${streakDays()}</b> day${streakDays() === 1 ? '' : 's'}</div>
  </div>
  <div class="steps" style="margin-top:14px">${CURRICULUM.map((U, k) => `<span class="${unitDone(U) ? 'done' : ''}" title="${esc(U.title)}">${U.emoji} ${k + 1}</span>`).join('')}</div>
  </div>
  </div>
  <div class="card">
    <h2>Why this order works</h2>
    <p class="hint">No method can guarantee a perfect accent — studies show steady gains, mostly in how easily people understand you. These are the parts with the best evidence, and the app follows them in this order:</p>
    <ol class="plan">
      <li><b>Learn exactly how each sound is made.</b> Explicit teaching of specific sounds works, especially when you are focused and careful.</li>
      <li><b>Rhythm and the "big" sounds first.</b> Stress, rhythm and sounds that change meaning (like V/W) matter most for being understood; TH matters less.</li>
      <li><b>Train your ear with many voices.</b> Hearing the same sound from 6+ different speakers (called "high-variability" training) improves hearing and usually speaking too.</li>
      <li><b>Say it and get feedback.</b> Practice with feedback, done regularly over weeks, gives bigger gains.</li>
      <li><b>Review on a schedule.</b> Spreading reviews over days and weeks keeps what you learned much better than cramming.</li>
      <li><b>Shadow real sentences.</b> Copying an American speaker in real time helps rhythm, fluency and overall clarity.</li>
    </ol>
    <div class="src">Sources:
      <a href="https://discovery.ucl.ac.uk/10156232/1/OASIS_Summary_Saito_and_Plonsky_2019.pdf" target="_blank">Saito &amp; Plonsky 2019</a> ·
      <a href="https://discovery-pp.ucl.ac.uk/10125305/1/tesq.3027.pdf" target="_blank">comprehensibility meta-analysis (TESOL Quarterly)</a> ·
      <a href="https://www.frontiersin.org/articles/10.3389/fcomm.2021.627378" target="_blank">functional load review</a> ·
      <a href="https://resolve.cambridge.org/core/journals/studies-in-second-language-acquisition/article/high-variability-phonetic-training-hvpt-a-metaanalysis-of-l2-perceptual-training-studies/6ABB8C1F32D88D53EA8D05A4565E76F6/core-reader" target="_blank">HVPT meta-analysis (79 studies)</a> ·
      <a href="https://www.cambridge.org/core/product/E38D8F5CE65DC708137B0E95F97C6BC7" target="_blank">HVPT → speaking meta-analysis</a> ·
      <a href="https://pubmed.ncbi.nlm.nih.gov/16719566/" target="_blank">spacing effect (Cepeda 2006)</a> ·
      <a href="https://ora.ox.ac.uk/objects/uuid:3104cae1-3a6b-400a-b173-de44384238d2" target="_blank">shadowing review (Oxford)</a> ·
      <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4028080" target="_blank">Indian vs American rhythm</a> ·
      <a href="https://academicworks.cuny.edu/gc_etds/1545" target="_blank">V/W for Hindi speakers</a>
      <br>Note: the ear-training voices are high-quality computer voices, not real people, so expect a bit less variety than in the studies.
    </div>
  </div>`;
  $('goReview') && ($('goReview').onclick = () => showTab('review'));
  $('goLearn') && ($('goLearn').onclick = () => { openUnit = U; const d = stepsDone(U); unitStep = !d.read ? 'read' : !d.hear ? 'hear' : 'say'; showTab('learn'); });
  $('goShadow').onclick = () => {
    showTab('shadow');
    const pool = CURRICULUM.filter(U => stepsDone(U).say).flatMap(U => U.sentences);
    if (pool.length) { setLevelButtons('sentence'); level = 'sentence'; load(rnd(pool)); } else setLevel('sentence');
  };
}

// ======================================================================
// Learn: unit list and unit pages
// ======================================================================
function renderLearn() {
  parkPractice();
  if (openUnit) return renderUnit();
  const nx = nextUnit();
  $('tab-learn').innerHTML = `<p class="hint">Work through the units in order — they go from the changes that help most to the ones that help least. Each unit: <b>1 Understand</b> how the sound is made → <b>2 Train your ear</b> with many voices → <b>3 Say it</b> and get scored. Words you say go into your Review deck.</p>
  <div class="units">${CURRICULUM.map((U, i) => {
    const d = stepsDone(U);
    return `<button class="unit ${U === nx ? 'next' : ''}" data-u="${U.id}">
      <div class="hint">${U.emoji} Unit ${i + 1}${U === nx ? ' · <span style="color:var(--ref)">recommended next</span>' : ''}${unitDone(U) ? ' · ✅ done' : ''}</div>
      <div class="t">${esc(U.title)}</div>
      <div class="steps"><span class="${d.read ? 'done' : ''}">1 Understand</span><span class="${d.hear ? 'done' : ''}">2 Ear ${d.quizBest ? Math.round(d.quizBest * 100) + '%' : ''}</span><span class="${d.say ? 'done' : ''}">3 Say ${d.said}/${U.words.length}</span></div>
    </button>`;
  }).join('')}</div>`;
  $('tab-learn').querySelectorAll('[data-u]').forEach(b => b.onclick = () => {
    openUnit = CURRICULUM.find(U => U.id === b.dataset.u);
    const d = stepsDone(openUnit); unitStep = !d.read ? 'read' : !d.hear ? 'hear' : 'say';
    renderUnit();
  });
}

function renderUnit() {
  parkPractice();
  const U = openUnit, i = CURRICULUM.indexOf(U), d = stepsDone(U);
  const stepBtn = (k, label, done) => `<button class="${unitStep === k ? 'on' : ''}" data-step="${k}">${done ? '✅ ' : ''}${label}</button>`;
  $('tab-learn').innerHTML = `
    <div class="bar"><button class="small" id="backUnits">← All units</button><span class="hint">${U.emoji} Unit ${i + 1} of ${CURRICULUM.length}</span></div>
    <h2>${esc(U.title)}</h2>
    <div class="bar">${stepBtn('read', '1 Understand', d.read)}${stepBtn('hear', '2 Train your ear', d.hear)}${stepBtn('say', `3 Say it (${d.said}/${U.words.length})`, d.say)}</div>
    <div id="unitBody"></div>`;
  $('backUnits').onclick = () => { openUnit = null; renderLearn(); };
  $('tab-learn').querySelectorAll('[data-step]').forEach(b => b.onclick = () => { unitStep = b.dataset.step; renderUnit(); });
  ({ read: stepRead, hear: stepHear, say: stepSay })[unitStep](U);
  window.scrollTo({ top: 0 });
}

// ---- Step 1: understand ----
function stepRead(U) {
  const vsName = ACCENT_NAME[U.vs];
  const examples = U.quiz === 'pair'
    ? `<p class="hint">Tap each word. Listen for the difference.</p><div class="chips">${U.pairs.map((p, k) =>
        `<span class="chip" data-pa="${k}">${esc(p[0].text)} <span class="hint">vs</span> ${esc(p[1].text)}</span>`).join('')}</div>`
    : `<p class="hint">Tap a word to hear it in American English${vsName ? `. Tap the small ${U.vs === 'gb' ? '🇬🇧' : '🇮🇳'} button to hear how ${vsName} English says it` : ''}.</p>
       <div class="chips">${U.words.map((w, k) => `<span class="chip" data-w="${k}">${esc(w.text)}<span class="s">${esc(w.syl.join(' '))}</span>
         ${w.other?.length ? `<button class="small" data-o="${k}" style="margin-top:6px">${U.vs === 'gb' ? '🇬🇧' : '🇮🇳'} ${vsName}</button>` : ''}</span>`).join('')}</div>`;
  $('unitBody').innerHTML = `
    <div class="cols">
    <div class="card"><h3>Why it matters</h3><p class="why">${esc(U.why)}</p>
      <h3>How to make it</h3><ol class="how">${U.how.map(h => `<li>${esc(h)}</li>`).join('')}</ol></div>
    <div class="card"><h3>Hear it</h3>${examples}</div>
    </div>
    <div class="bar"><button class="primary" id="gotIt">Got it → Train your ear <kbd>Enter</kbd></button></div>`;
  $('unitBody').querySelectorAll('[data-w]').forEach(c => c.onclick = e => { if (e.target.dataset.o == null) playClip(U.words[+c.dataset.w].audio); });
  $('unitBody').querySelectorAll('[data-o]').forEach(b => b.onclick = e => { e.stopPropagation(); playClip(rnd(U.words[+b.dataset.o].other).src); });
  $('unitBody').querySelectorAll('[data-pa]').forEach(c => c.onclick = async () => {
    const p = U.pairs[+c.dataset.pa], v = rnd(p[0].us).voice;
    const a = p[0].us.find(x => x.voice === v) || p[0].us[0], b = p[1].us.find(x => x.voice === v) || p[1].us[0];
    await playClip(a.src); await wait(350); await playClip(b.src);
  });
  $('gotIt').onclick = () => { updateUnit(U.id, p => p.read = true); markActive(); unitStep = 'hear'; renderUnit(); };
}

// ---- Step 2: ear training quiz (many voices) ----
let quiz = null;
function makeQuiz(U) {
  const N = 10, qs = [];
  if (U.quiz === 'pair') {
    const pool = shuffle(U.pairs.flatMap(p => [[p, 0], [p, 1]]));
    for (let i = 0; i < N; i++) { const [p, k] = pool[i % pool.length]; qs.push({ type: 'pair', p, k, clip: rnd(p[k].us) }); }
  } else if (U.quiz === 'accent') {
    const pool = shuffle(U.words.filter(w => w.us?.length && w.other?.length));
    for (let i = 0; i < N; i++) {
      const w = pool[i % pool.length], us = rnd(w.us), ot = rnd(w.other), usFirst = Math.random() < 0.5;
      qs.push({ type: 'accent', w, a: usFirst ? us : ot, b: usFirst ? ot : us, answer: usFirst ? 0 : 1 });
    }
  } else {
    const pool = shuffle(U.words.filter(w => w.us?.length));
    for (let i = 0; i < N; i++) {
      const w = pool[i % pool.length], parts = w.syl[0].split('-');
      qs.push({ type: 'stress', w, parts, answer: parts.findIndex(s => !/[a-z]/.test(s)), clip: rnd(w.us) });
    }
  }
  return { U, qs, i: 0, right: 0, answered: false };
}

async function playQuestion(q) {
  if (q.type === 'accent') { await playClip(q.a.src); await wait(450); await playClip(q.b.src); }
  else await playClip(q.clip.src);
}

function stepHear(U) {
  if (!quiz || quiz.U !== U) quiz = null;
  if (!quiz) {
    const best = stepsDone(U).quizBest;
    const what = U.quiz === 'pair' ? `You'll hear one word. Pick which one it was.`
      : U.quiz === 'accent' ? `You'll hear the same words twice — once American, once ${ACCENT_NAME[U.vs]}. Pick the American one.`
      : `You'll hear a word. Pick its strong (stressed) syllable.`;
    $('unitBody').innerHTML = `<div class="card"><h3>Train your ear</h3><p class="why">${what} The voices change every time — that's on purpose: hearing many speakers trains your ear faster.</p>
      <p class="hint">10 questions. Score 8 or more to pass.${best ? ` Your best so far: ${Math.round(best * 100)}%.` : ''}</p>
      <button class="primary" id="qStart">Start</button></div>`;
    $('qStart').onclick = () => { quiz = makeQuiz(U); renderQuestion(); };
    return;
  }
  renderQuestion();
}

function renderQuestion() {
  const { U, qs, i, right } = quiz, q = qs[i];
  if (i >= qs.length) return renderQuizEnd();
  const prompt = q.type === 'pair' ? 'Which word did you hear?' : q.type === 'accent' ? `Which one is American?` : 'Which syllable is strong?';
  const sub = q.type === 'accent' ? `<div class="chip" style="display:inline-block">${esc(q.w.text)}<span class="s">${esc(q.w.syl.join(' '))}</span></div>`
    : q.type === 'stress' ? `<div style="font-size:22px">${esc(q.w.text)}</div>` : '';
  const opts = q.type === 'pair' ? q.p.map(x => x.text) : q.type === 'accent' ? ['A', 'B'] : q.parts.map(s => s.toLowerCase());
  $('unitBody').innerHTML = `<div class="card">
    <div class="progress"><div style="width:${i / qs.length * 100}%"></div></div>
    <div class="hint">Question ${i + 1} of ${qs.length} · ${right} right</div>
    <h2 style="margin-top:8px">${prompt}</h2>${sub}
    <div class="bar" style="margin-top:12px">${q.type === 'accent'
      ? '<button id="qA">▶ A</button><button id="qB">▶ B</button><button id="qAB" class="small">▶ A then B</button>'
      : '<button id="qPlay" class="primary">▶ Play again</button>'}</div>
    <div class="quizopts">${opts.map((o, k) => `<button data-opt="${k}">${esc(o)}<kbd>${k + 1}</kbd></button>`).join('')}</div>
    <div class="hint"><span class="keyhint">Keyboard: <kbd>1</kbd> <kbd>2</kbd> … to answer · <kbd>R</kbd> replay · <kbd>Enter</kbd> next</span></div>
    <div id="qFeedback"></div></div>`;
  if (q.type === 'accent') { $('qA').onclick = () => playClip(q.a.src); $('qB').onclick = () => playClip(q.b.src); $('qAB').onclick = () => playQuestion(q); }
  else $('qPlay').onclick = () => playQuestion(q);
  $('unitBody').querySelectorAll('[data-opt]').forEach(b => b.onclick = () => answer(+b.dataset.opt));
  quiz.answered = false;
  playQuestion(q);
}

function answer(k) {
  if (quiz.answered) return;
  quiz.answered = true; markActive();
  const q = quiz.qs[quiz.i], correct = q.type === 'pair' ? q.k : q.answer, ok = k === correct;
  if (ok) quiz.right++;
  $('unitBody').querySelectorAll('[data-opt]').forEach(b => {
    const n = +b.dataset.opt; b.disabled = true;
    if (n === correct) b.classList.add('right'); else if (n === k) b.classList.add('wrong');
  });
  let fb = '';
  if (q.type === 'pair') {
    const other = q.p[1 - q.k], same = other.us.find(x => x.voice === q.clip.voice) || other.us[0];
    fb = `It was <b>${esc(q.p[q.k].text)}</b> (${VOICE_NAME(q.clip.voice)}). <button class="small" id="fbOther">▶ Compare: ${esc(other.text)}</button>`;
    setTimeout(() => $('fbOther') && ($('fbOther').onclick = async () => { await playClip(q.clip.src); await wait(350); await playClip(same.src); }));
  } else if (q.type === 'accent') {
    fb = `A = ${VOICE_NAME(q.a.voice)}, B = ${VOICE_NAME(q.b.voice)}. Listen for: ${esc(quiz.U.how[0])}`;
  } else {
    fb = `Strong syllable: <b style="color:var(--stress)">${esc(q.parts[q.answer])}</b> — ${esc(q.w.syl[0])}`;
  }
  $('qFeedback').innerHTML = `<p style="font-size:16px">${ok ? '✅ Right!' : '❌ Not quite.'} ${fb}</p><button class="primary" id="qNext">Next →</button>`;
  $('qNext').onclick = () => { quiz.i++; renderQuestion(); };
}

function renderQuizEnd() {
  const { U, right, qs } = quiz, pct = right / qs.length, pass = pct >= 0.8;
  updateUnit(U.id, p => p.quizBest = Math.max(p.quizBest || 0, pct));
  quiz = null;
  $('unitBody').innerHTML = `<div class="card"><h2>${pass ? '🎉 Passed!' : 'Keep training'} — ${right} / ${qs.length}</h2>
    <p class="why">${pass ? 'Your ear can now tell the difference. Time to say it yourself.' : 'Your ear needs a few more rounds. Each round uses different voices, so repeating is not wasted — it is the training.'}</p>
    <div class="bar"><button id="qAgain">Another round</button>${pass ? '<button class="primary" id="qSay">Next: Say it →</button>' : ''}</div></div>`;
  $('qAgain').onclick = () => { quiz = makeQuiz(U); renderQuestion(); };
  if (pass) $('qSay').onclick = () => { unitStep = 'say'; renderUnit(); };
}

// ---- Step 3: say it (recorded + scored, then added to the review deck) ----
let sayIndex = 0;
function stepSay(U) {
  const p = unitProgress(U.id);
  if (sayIndex >= U.words.length) sayIndex = 0;
  $('unitBody').innerHTML = `
    <p class="hint">Listen, then record each one. Read the gold syllables. Every word you record goes into your Review deck, so you'll see it again tomorrow, then later and later.</p>
    <div id="sayDone"></div>
    <div class="cols say">
      <div class="chips" id="sayList" style="margin-bottom:14px"></div>
      <div id="sayPractice"></div>
    </div>`;
  const list = () => {
    const p2 = unitProgress(U.id);
    $('sayList').innerHTML = U.words.map((w, k) => {
      const s = p2.said[w.id];
      return `<span class="chip" data-k="${k}" style="${k === sayIndex ? 'border-color:var(--ref)' : ''}">${esc(w.text)}<span class="s" style="color:${s == null ? 'var(--muted)' : color(s)}">${s == null ? '—' : s}</span></span>`;
    }).join('');
    $('sayList').querySelectorAll('[data-k]').forEach(c => c.onclick = () => { sayIndex = +c.dataset.k; list(); practise(U.words[sayIndex], U); });
    const d = stepsDone(U);
    const sb = document.querySelector('[data-step="say"]');
    if (sb) sb.textContent = `${d.say ? '✅ ' : ''}3 Say it (${d.said}/${U.words.length})`;
    $('sayDone').innerHTML = d.say ? `<div class="card"><h2>✅ Unit complete</h2><p class="why">All ${U.words.length} words are in your Review deck. Now try this unit's sentences in Shadow.</p>
      <div class="bar"><button class="primary" id="shadowUnit">🎧 Shadow this unit's sentences</button>${CURRICULUM[CURRICULUM.indexOf(U) + 1] ? '<button id="nextUnitBtn">Next unit →</button>' : ''}</div></div>` : '';
    if (d.say) {
      $('shadowUnit').onclick = () => { showTab('shadow'); setLevelButtons('sentence'); level = 'sentence'; load(rnd(U.sentences)); };
      $('nextUnitBtn') && ($('nextUnitBtn').onclick = () => { openUnit = CURRICULUM[CURRICULUM.indexOf(U) + 1]; unitStep = 'read'; sayIndex = 0; renderUnit(); });
    }
  };
  mountPractice($('sayPractice'));
  $('practiceExtra').innerHTML = '<div class="bar"><button id="sayNext" class="primary">Next word →</button></div>';
  $('sayNext').onclick = () => { sayIndex = (sayIndex + 1) % U.words.length; list(); practise(U.words[sayIndex], U); };
  window.onScored = rec => {
    const w = U.words[sayIndex];
    if (rec.textId !== w.id) return;
    updateUnit(U.id, p => p.said[w.id] = rec.overall ?? 0);
    addCard(w.id); markActive(); updateBadge(); list();
  };
  list();
  practise(U.words[sayIndex], U, false);
}

// ======================================================================
// Review: spaced repetition session
// ======================================================================
let session = null;
function renderReview() {
  parkPractice();
  const due = dueCards();
  if (session && session.i < session.ids.length) return reviewCard();
  if (session) {   // finished
    const s = session; session = null;
    $('tab-review').innerHTML = `<div class="card"><h2>🎉 Review done — ${s.ids.length} word${s.ids.length === 1 ? '' : 's'}</h2>
      <p class="why">Again: ${s.g.again} · Good: ${s.g.good} · Easy: ${s.g.easy}. Words you found easy come back later; "again" words come back tomorrow.</p>
      <button class="primary" id="revToday">Back to Today</button></div>`;
    $('revToday').onclick = () => showTab('today');
    return;
  }
  const all = srs(), upcoming = Object.values(all).filter(c => c.due > today()).map(c => c.due).sort()[0];
  const boxes = [1, 2, 3, 4, 5, 6, 7].map(b => Object.values(all).filter(c => c.box === b).length);
  $('tab-review').innerHTML = `<div class="card">
    <h2>${due.length ? `${due.length} word${due.length === 1 ? '' : 's'} to review` : 'Nothing to review right now ✓'}</h2>
    <p class="why">Each word comes back just before you'd forget it: tomorrow, then in 2 days, 4, 7, 15, 30, 60. Say it, check the score, then tell the app how it went.</p>
    ${!Object.keys(all).length ? '<p class="hint">Your deck is empty — finish "Say it" in a Learn unit to add words.</p>' : ''}
    ${!due.length && upcoming ? `<p class="hint">Next review: ${upcoming}.</p>` : ''}
    <div class="stats" style="margin:10px 0 14px">${boxes.map((n, k) => `<div>Box ${k + 1}<br><b>${n}</b></div>`).join('')}</div>
    ${due.length ? '<button class="primary" id="revStart">Start review</button>' : ''}</div>`;
  $('revStart') && ($('revStart').onclick = () => { session = { ids: shuffle(due), i: 0, g: { again: 0, good: 0, easy: 0 } }; reviewCard(); });
}

function reviewCard() {
  const id = session.ids[session.i], w = wordById(id);
  $('tab-review').innerHTML = `<div class="progress"><div style="width:${session.i / session.ids.length * 100}%"></div></div>
    <div class="hint" style="margin-bottom:10px">Word ${session.i + 1} of ${session.ids.length} · ${w.unitObj.emoji} ${esc(w.unitObj.title)}</div>
    <div id="revPractice"></div>`;
  mountPractice($('revPractice'));
  $('practiceExtra').innerHTML = `<div class="card"><div class="hint">How did it go? (Record first to get a suggestion — or just say it out loud and grade yourself.)</div>
    <div class="grades"><button data-g="again">😣 Again</button><button data-g="good">🙂 Good</button><button data-g="easy">😎 Easy</button></div></div>`;
  const grades = $('practiceExtra').querySelectorAll('[data-g]');
  grades.forEach(b => b.onclick = () => { gradeCard(id, b.dataset.g); session.g[b.dataset.g]++; session.i++; updateBadge(); renderReview(); });
  window.onScored = rec => {
    if (rec.textId !== id) return;
    // thresholds set from tests: native American voices average ~85+ on short items
    const s = rec.overall ?? 0, sug = s < 55 ? 'again' : s < 80 ? 'good' : 'easy';
    grades.forEach(b => b.classList.toggle('suggest', b.dataset.g === sug));
  };
  practise(w, w.unitObj);
}

// ======================================================================
// Start
// ======================================================================
if (!window.CURRICULUM) {   // an old copy of data.js was loaded: ask for a reload instead of crashing
  document.querySelector('main').insertAdjacentHTML('afterbegin',
    '<div class="card"><b>New lessons downloaded.</b> <button class="primary small" onclick="location.reload()">Reload to start</button></div>');
  window.CURRICULUM = [];
}
showTab(localStorage.getItem('aa-tab') || 'today');
