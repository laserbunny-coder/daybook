// Talking to Claude out loud. The mic in Ask Claude listens, sends what was said when you pause,
// reads Claude's answer aloud, then listens again, so it works like a phone call until you tap the mic
// or stay quiet. Uses the browser's own speech recognition and voices (Chrome on Android and computers,
// Safari, Edge). Where there is none, the mic doesn't show.
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
export const supported = !!Rec && 'speechSynthesis' in window;

let send = async () => null;   // (question) => reply text, set by initVoice
let note = () => {};           // shows a short message
let state = 'off';             // off | listening | thinking | speaking
let rec = null, heard = '', quiet = 0, voice = null;

export function initVoice(onSend, toast) {
  send = onSend; note = toast;
  const f = document.getElementById('askf'); if (!f || !supported || f.querySelector('.mic')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'mic'; b.setAttribute('aria-label', 'Talk to Claude'); b.title = 'Talk to Claude';
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg><i class="wave" aria-hidden="true"><b></b><b></b><b></b><b></b></i>';
  b.addEventListener('click', tap);
  f.insertBefore(b, f.querySelector('[type=submit]'));
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice); pickVoice();
}

// Mic tap: start; while Claude talks, cut in and listen; otherwise stop.
function tap() {
  if (state === 'off') { quiet = 0; listen(); }
  else if (state === 'speaking') { speechSynthesis.cancel(); listen(); }
  else stop();
}
export function stop() {
  set('off'); speechSynthesis.cancel();
  if (rec) { const r = rec; rec = null; try { r.abort(); } catch { /* already ended */ } }
  const q = document.getElementById('askq'); if (q) q.placeholder = 'Ask about your week or a project';
}

function set(s) {
  state = s;
  const ai = document.getElementById('ai'); if (ai) ai.dataset.voice = s;
  const b = document.querySelector('#askf .mic');
  if (b) b.setAttribute('aria-label', { off: 'Talk to Claude', listening: 'Listening. Tap to stop', thinking: 'Thinking. Tap to stop', speaking: 'Claude is talking. Tap to cut in' }[s]);
  const q = document.getElementById('askq');
  if (q) q.placeholder = { off: 'Ask about your week or a project', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Tap the mic to cut in' }[s];
}

function listen() {
  if (rec) { try { rec.abort(); } catch { /* ignore */ } }
  const q = document.getElementById('askq');
  const r = rec = new Rec();
  r.lang = navigator.language || 'en-US'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  heard = '';
  r.onresult = e => {
    let t = ''; for (const x of e.results) t += x[0].transcript;
    heard = t.trim(); if (q) q.value = heard;
  };
  r.onerror = e => {
    if (rec !== r) return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stop(); note('Daybook needs the microphone. Allow it in your browser settings, then tap the mic again.'); }
    else if (e.error === 'network') { stop(); note('Talking needs an internet connection.'); }
    // no-speech and aborted end below
  };
  r.onend = () => {
    if (rec !== r) return; rec = null;
    if (state !== 'listening') return;
    if (!heard) { if (++quiet >= 2) stop(); else listen(); return; } // a pause before speaking gets one more try
    quiet = 0; const said = heard; if (q) q.value = '';
    set('thinking');
    send(said).then(reply => { if (state === 'thinking') speak(reply); }, () => { if (state === 'thinking') stop(); });
  };
  set('listening');
  try { r.start(); } catch { stop(); }
}

// Reads the answer aloud a sentence at a time (long single utterances get cut off in some browsers),
// then listens again.
function speak(text) {
  const parts = plain(text).match(/[^.!?\n]+[.!?]*\s*/g)?.map(s => s.trim()).filter(Boolean) || [];
  if (!parts.length) { listen(); return; }
  set('speaking'); speechSynthesis.cancel();
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = navigator.language || 'en-US';
    u.rate = 1.05;
    if (i === parts.length - 1) u.onend = () => { if (state === 'speaking') setTimeout(() => state === 'speaking' && listen(), 250); };
    u.onerror = e => { if (e.error !== 'interrupted' && e.error !== 'canceled' && state === 'speaking') stop(); };
    speechSynthesis.speak(u);
  });
}
const plain = t => String(t || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*(?:[-*•]|\d+\.)\s+/gm, '').replace(/https?:\/\/\S+/g, 'the link');

// The most natural British voice the device has (Michael likes the light British accent of the Claude app);
// for someone who doesn't speak English, the most natural voice in their own language
function pickVoice() {
  const all = speechSynthesis.getVoices(); if (!all.length) return;
  const lang = (navigator.language || 'en-US').toLowerCase(), base = lang.split('-')[0];
  const tag = v => v.lang.toLowerCase().replace('_', '-');
  const uk = base === 'en' ? all.filter(v => tag(v) === 'en-gb') : [];
  const mine = all.filter(v => tag(v) === lang);
  const near = uk.length ? uk : mine.length ? mine : all.filter(v => tag(v).startsWith(base));
  const rank = v => (/natural|neural|online|premium|enhanced/i.test(v.name) ? 0 : /google/i.test(v.name) ? 1 : v.localService ? 3 : 2);
  voice = near.slice().sort((a, b) => rank(a) - rank(b))[0] || null;
}

// Stop when the app goes to the background or Ask Claude closes, since the mic to stop it is gone too
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && state !== 'off') stop(); });
new MutationObserver(() => { if (state !== 'off' && !document.getElementById('ai')?.getClientRects().length) stop(); })
  .observe(document.body, { attributes: true, attributeFilter: ['class', 'data-tab'] });
