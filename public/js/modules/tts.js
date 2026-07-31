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

let _currentAudio = null;
let _currentAudioUrl = null;
let _currentBtn = null;
let _currentText = null;

export function stopAllTts() {
  if (_currentAudio) {
    try {
      _currentAudio.pause();
      _currentAudio.currentTime = 0;
    } catch {}
    if (_currentAudioUrl) {
      try { URL.revokeObjectURL(_currentAudioUrl); } catch {}
    }
    _currentAudio = null;
    _currentAudioUrl = null;
    _currentBtn = null;
    _currentText = null;
    window._currentTtsAudio = null;
  }
  if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
  document.querySelectorAll('.tts-play-btn').forEach(btn => {
    const icon = btn.querySelector('.material-symbols-rounded');
    if (icon) icon.textContent = 'play_arrow';
    btn.style.color = '';
  });
}

export async function speakText(text, activeBtn = null, force = false) {
  if (!force && !activeBtn && !isTtsEnabled()) return;

  if (!text || text.length < 3) {
    console.warn('[TTS] Text too short:', text);
    return;
  }

  // Case 1: Audio is currently PLAYING -> PAUSE IT!
  if (_currentAudio && !_currentAudio.paused && !_currentAudio.ended) {
    try {
      _currentAudio.pause();
      if (_currentBtn) {
        const icon = _currentBtn.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = 'play_arrow';
        _currentBtn.style.color = '#38bdf8';
      }
      if (activeBtn && activeBtn !== _currentBtn) {
        const icon = activeBtn.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = 'play_arrow';
        activeBtn.style.color = '#38bdf8';
        _currentBtn = activeBtn;
      }
      return;
    } catch (e) {
      console.debug('[TTS] Pause error:', e.message);
    }
  }

  // Case 2: Audio is currently PAUSED -> RESUME IT!
  if (_currentAudio && _currentAudio.paused && !_currentAudio.ended) {
    try {
      _currentBtn = activeBtn || _currentBtn;
      await _currentAudio.play();
      if (_currentBtn) {
        const icon = _currentBtn.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = 'pause';
        _currentBtn.style.color = '#38bdf8';
      }
      return;
    } catch (e) {
      console.debug('[TTS] Resume error:', e.message);
    }
  }

  // Case 1.5: Native TTS is speaking -> Toggle Pause/Resume
  if (!_currentAudio && _currentBtn && _currentBtn === activeBtn && 'speechSynthesis' in window && window.speechSynthesis.speaking) {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      if (_currentBtn) {
        const icon = _currentBtn.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = 'pause';
        _currentBtn.style.color = '#38bdf8';
      }
    } else {
      window.speechSynthesis.pause();
      if (_currentBtn) {
        const icon = _currentBtn.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = 'play_arrow';
        _currentBtn.style.color = '#38bdf8';
      }
    }
    return;
  }

  // Case 3: New audio or starting fresh -> Stop previous and start new audio
  stopAllTts();
  _currentBtn = activeBtn;
  _currentText = text;

  if (activeBtn) {
    const icon = activeBtn.querySelector('.material-symbols-rounded');
    if (icon) icon.textContent = 'pause';
    activeBtn.style.color = '#38bdf8';
  }

  // Try High-Quality Neural TTS (Edge TTS via /speak) by default
  try {
    const res = await fetch('/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (res.ok) {
      const blob = await res.blob();
      _currentAudioUrl = URL.createObjectURL(blob);
      _currentAudio = new Audio(_currentAudioUrl);
      window._currentTtsAudio = _currentAudio;

      _currentAudio.onended = () => {
        if (_currentAudioUrl) {
          try { URL.revokeObjectURL(_currentAudioUrl); } catch {}
        }
        if (_currentBtn) {
          const icon = _currentBtn.querySelector('.material-symbols-rounded');
          if (icon) icon.textContent = 'play_arrow';
          _currentBtn.style.color = '';
        }
        _currentAudio = null;
        _currentAudioUrl = null;
        _currentBtn = null;
        _currentText = null;
        window._currentTtsAudio = null;
      };

      _currentAudio.onerror = () => {
        if (_currentAudioUrl) {
          try { URL.revokeObjectURL(_currentAudioUrl); } catch {}
        }
        if (_currentBtn) {
          const icon = _currentBtn.querySelector('.material-symbols-rounded');
          if (icon) icon.textContent = 'play_arrow';
          _currentBtn.style.color = '';
        }
        _currentAudio = null;
        _currentAudioUrl = null;
        _currentBtn = null;
        _currentText = null;
        window._currentTtsAudio = null;
      };

      await _currentAudio.play();
      console.log('[TTS] Playing Neural TTS audio');
      return;
    }
  } catch (err) {
    console.debug('[TTS] Neural TTS failed, falling back to browser voice:', err.message);
  }

  // Fallback to browser built-in SpeechSynthesis
  if (!('speechSynthesis' in window)) {
    console.warn('[TTS] SpeechSynthesis not supported');
    stopAllTts();
    return;
  }

  const ruVoice = getRussianVoice();
  const chunks = splitIntoChunks(text);

  chunks.forEach((chunk, i) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = 'ru-RU';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    if (ruVoice) utterance.voice = ruVoice;

    if (i === chunks.length - 1) {
      utterance.onend = () => stopAllTts();
      utterance.onerror = () => stopAllTts();
    }

    window.speechSynthesis.speak(utterance);
  });
}

export function getAgentBubbles(container = document) {
  let bubbles = container.querySelectorAll('[role="article"][aria-label="Agent response"], [role="article"]:not([aria-label*="User"]), [data-testid="agent-message"]');
  if (bubbles.length === 0) {
    bubbles = container.querySelectorAll('.prose');
  }
  return Array.from(bubbles).filter(bubble => {
    const label = (bubble.getAttribute('aria-label') || '').toLowerCase();
    return !label.includes('user prompt') && !label.includes('user message');
  });
}

// Pre-load voices for mobile browsers
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    _cachedRuVoice = null;
    _voicesChecked = false;
    getRussianVoice();
  };
  window.speechSynthesis.getVoices();
}

export function addTTSButtons(container) {
  const agentBubbles = getAgentBubbles(container);

  agentBubbles.forEach(bubble => {
    if (bubble.querySelector('.tts-play-btn')) return;

    bubble.style.position = 'relative';

    const btn = document.createElement('button');
    btn.className = 'tts-play-btn';

    const text = extractCleanText(bubble);

    if (_currentAudio && _currentText === text) {
      _currentBtn = btn;
      const isPlaying = !_currentAudio.paused && !_currentAudio.ended;
      btn.innerHTML = `<span class="material-symbols-rounded">${isPlaying ? 'pause' : 'play_arrow'}</span>`;
      btn.style.color = '#38bdf8';
    } else {
      btn.innerHTML = '<span class="material-symbols-rounded">play_arrow</span>';
    }

    btn.title = 'Озвучить ответ';

    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentBubbleText = extractCleanText(bubble);
      if (currentBubbleText && currentBubbleText.length > 3) {
        speakText(currentBubbleText, btn, true);
      }
    });

    bubble.appendChild(btn);
  });
}
