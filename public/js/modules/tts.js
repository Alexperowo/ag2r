// public/js/modules/tts.js — Web Speech API Speech Synthesis for AG2R

export function isTtsEnabled() {
  return window.localStorage.getItem('ag2r_tts_enabled') !== 'false';
}

export function setTtsEnabled(enabled) {
  window.localStorage.setItem('ag2r_tts_enabled', enabled ? 'true' : 'false');
  if (!enabled && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

// Chrome has a known bug: utterances longer than ~200 chars silently stop.
// Split text into sentence-sized chunks and queue them sequentially.
function splitIntoChunks(text, maxLen = 180) {
  const sentences = text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    if ((current + ' ' + s).length > maxLen && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current = current ? current + ' ' + s : s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Cached Russian voice
let _cachedRuVoice = null;
let _voicesChecked = false;

function getRussianVoice() {
  if (_voicesChecked && _cachedRuVoice !== null) return _cachedRuVoice;
  
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  
  _voicesChecked = true;
  
  // Prefer Google Russian voice, then Microsoft, then any Russian
  _cachedRuVoice = 
    voices.find(v => v.lang === 'ru-RU' && v.name.includes('Google')) ||
    voices.find(v => v.lang === 'ru-RU') ||
    voices.find(v => v.lang && v.lang.startsWith('ru')) ||
    null;
  
  console.log('[TTS] Russian voice:', _cachedRuVoice ? _cachedRuVoice.name : 'NOT FOUND');
  console.log('[TTS] All voices:', voices.map(v => `${v.lang}:${v.name}`).join(', '));
  
  return _cachedRuVoice;
}

export function extractCleanText(element) {
  const clone = element.cloneNode(true);
  
  // Remove ALL elements that produce non-content text
  clone.querySelectorAll([
    'button',                       // UI buttons (Copy, Review, Worked for ...)
    'details', 'summary',           // Collapsible sections
    'svg',                          // SVG icons
    'pre',                          // Code blocks
    'code',                         // Inline code
    '.tts-play-btn',                // Our own TTS button
    '.mobile-copy-btn',             // Copy buttons
    '.material-symbols-rounded',    // Icon font text (play_arrow, volume_up, etc.)
    '[data-tooltip-id]',            // Tooltip triggers
    '[aria-hidden="true"]',         // Hidden elements
    'style',                        // Style tags
    'script',                       // Script tags
  ].join(', ')).forEach(el => el.remove());
  
  let text = clone.innerText || clone.textContent || '';
  
  // Strip remaining English UI artifacts
  text = text
    .replace(/Thought for\s+\S+/gi, '')
    .replace(/Worked for\s+\S+/gi, '')
    .replace(/\d+\s*files?\s*changed\s*[\+\-\d\s]*/gi, '')
    .replace(/\bReview\b/g, '')
    .replace(/\bContinue\b/g, '')
    .replace(/\bCopy\b/g, '')
    .replace(/\bCopied!?\b/g, '')
    .replace(/\bWorking\.?\b/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  return text;
}

export async function speakText(text) {
  if (!isTtsEnabled()) return;

  if (!text || text.length < 3) {
    console.warn('[TTS] Text too short:', text);
    return;
  }

  console.log('[TTS] Speaking text (' + text.length + ' chars):', text.substring(0, 150) + '...');

  // Try High-Quality Neural TTS (Edge TTS via /speak) by default
  try {
    const res = await fetch('/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (res.ok) {
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      
      // Track playback
      window._currentTtsAudio = audio;
      audio.onended = () => { URL.revokeObjectURL(audioUrl); window._currentTtsAudio = null; };
      audio.onerror = () => { URL.revokeObjectURL(audioUrl); window._currentTtsAudio = null; };
      
      await audio.play();
      console.log('[TTS] Playing Neural TTS audio');
      return;
    }
  } catch (err) {
    console.debug('[TTS] Neural TTS failed, falling back to browser voice:', err.message);
  }

  // Fallback to browser built-in SpeechSynthesis
  if (!('speechSynthesis' in window)) {
    console.warn('[TTS] SpeechSynthesis not supported');
    return;
  }

  window.speechSynthesis.cancel();

  const ruVoice = getRussianVoice();
  const chunks = splitIntoChunks(text);

  chunks.forEach((chunk, i) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = 'ru-RU';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    if (ruVoice) utterance.voice = ruVoice;

    window.speechSynthesis.speak(utterance);
  });
}

// Pre-load voices for mobile browsers
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    _cachedRuVoice = null;
    _voicesChecked = false;
    getRussianVoice();
  };
  // Trigger initial load
  window.speechSynthesis.getVoices();
}

export function addTTSButtons(container) {
  // Use the exact selector from AG 2.4.3
  const agentBubbles = container.querySelectorAll('[role="article"][aria-label="Agent response"]');

  console.log('[TTS] Found agent bubbles:', agentBubbles.length, '| TTS enabled:', isTtsEnabled());

  agentBubbles.forEach(bubble => {
    if (bubble.querySelector('.tts-play-btn')) return;

    bubble.style.position = 'relative';

    const btn = document.createElement('button');
    btn.className = 'tts-play-btn';
    btn.innerHTML = '<span class="material-symbols-rounded">play_arrow</span>';
    btn.title = 'Озвучить ответ';

    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();

      // If already speaking, stop
      if (window._currentTtsAudio || window.speechSynthesis.speaking) {
        if (window._currentTtsAudio) {
          window._currentTtsAudio.pause();
          window._currentTtsAudio = null;
        }
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel();
        }
        const icon = btn.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = 'play_arrow';
        btn.style.color = '';
        return;
      }

      const text = extractCleanText(bubble);
      console.log('[TTS] Extracted text:', text.substring(0, 200));

      if (text && text.length > 3) {
        // Visual feedback — change to stop icon
        const icon = btn.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = 'stop';
        btn.style.color = '#38bdf8';

        speakText(text);

        // Monitor for end of speech to reset button
        const checkEnd = setInterval(() => {
          if (!window._currentTtsAudio && !window.speechSynthesis.speaking) {
            clearInterval(checkEnd);
            if (icon) icon.textContent = 'play_arrow';
            btn.style.color = '';
          }
        }, 500);
      }
    });

    bubble.appendChild(btn);
  });
}
