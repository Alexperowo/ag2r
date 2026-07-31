import { state } from './state.js';

let recognition = null;
let isRecording = false;
let currentMicBtn = null;
let currentInput = null;
let originalPlaceholder = '';

export function initSTT() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.debug('[STT] SpeechRecognition not supported in this browser.');
    document.querySelectorAll('.mic-btn').forEach(btn => {
      btn.classList.add('unsupported');
      btn.title = 'Voice input not supported in your browser';
      btn.addEventListener('click', () => {
        alert('Voice input is not supported in this browser. Try Chrome or Safari.');
      });
    });
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  // Try to use the browser's default language, or fallback to Russian/English
  recognition.lang = navigator.language || 'ru-RU';

  let autoRestartCount = 0;

  let sessionFinalTranscript = '';

  recognition.onstart = () => {
    isRecording = true;
    sessionFinalTranscript = '';
    if (currentMicBtn) currentMicBtn.classList.add('recording');
    if (currentInput) {
      currentInput.dataset.initialValue = currentInput.value;
      originalPlaceholder = currentInput.placeholder;
      currentInput.placeholder = 'Listening...';
    }
  };

  recognition.onresult = (event) => {
    let interimStr = '';
    let currentFinalStr = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      let t = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        currentFinalStr += t;
      } else {
        interimStr += t;
      }
    }

    // Android duplicate bug fix + Buffer flush fix
    if (currentFinalStr) {
      let cF = currentFinalStr.trim().toLowerCase();
      let sF = sessionFinalTranscript.trim().toLowerCase();

      // If the new final string starts with the old final string, the browser is cumulative.
      // E.g. old = "hello", new = "hello world". We should just replace it.
      if (sF && cF.startsWith(sF)) {
        sessionFinalTranscript = currentFinalStr;
      } else {
        // Otherwise, it's new text (buffer flushed or normal appending).
        if (sessionFinalTranscript && !sessionFinalTranscript.endsWith(' ') && !currentFinalStr.startsWith(' ')) {
          sessionFinalTranscript += ' ';
        }
        sessionFinalTranscript += currentFinalStr;
      }
    }

    if (currentInput) {
      let prefix = currentInput.dataset.initialValue || '';
      if (prefix && !prefix.endsWith(' ')) prefix += ' ';

      const combined = (prefix + sessionFinalTranscript + (sessionFinalTranscript && !sessionFinalTranscript.endsWith(' ') && interimStr && !interimStr.startsWith(' ') ? ' ' : '') + interimStr);
      currentInput.value = combined;
      
      currentInput.style.height = 'auto';
      currentInput.style.height = Math.min(currentInput.scrollHeight, 120) + 'px';
      currentInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  recognition.onerror = (event) => {
    console.debug('[STT] Error:', event.error);
    stopRecording();
  };

  recognition.onend = () => {
    // If it ended automatically (e.g. timeout), restart up to 3 times
    if (isRecording && autoRestartCount < 3) {
      autoRestartCount++;
      try {
        recognition.start();
      } catch (e) {
        stopRecording();
      }
    } else {
      stopRecording();
    }
  };

  function stopRecording() {
    isRecording = false;
    if (currentMicBtn) {
      currentMicBtn.classList.remove('recording');
    }
    if (currentInput) {
      currentInput.placeholder = originalPlaceholder;
      delete currentInput.dataset.initialValue;
    }
    try {
      recognition.stop();
    } catch(e) {}
    currentMicBtn = null;
    currentInput = null;
  }

  // We need to attach listeners dynamically because mic buttons can be re-rendered 
  // (e.g. new-session.js replaces its HTML).
  // So we use event delegation on the document body.
  document.body.addEventListener('click', (e) => {
    const micBtn = e.target.closest('.mic-btn');
    if (!micBtn) return;
    
    if (micBtn.classList.contains('unsupported')) return;

    if (isRecording && currentMicBtn === micBtn) {
      // Stop recording
      isRecording = false; // Prevents auto-restart
      recognition.stop();
      return;
    }

    // If recording on another button, stop that one first
    if (isRecording) {
      isRecording = false;
      recognition.stop();
    }

    currentMicBtn = micBtn;
    
    // Determine which input to fill
    if (micBtn.id === 'ag2r-new-session-mic') {
      currentInput = document.getElementById('ag2r-new-session-input');
    } else {
      currentInput = document.getElementById('message-input');
    }

    if (currentInput) {
      currentInput.dataset.initialValue = currentInput.value;
      try {
        recognition.start();
      } catch (err) {
        console.debug('[STT] Start error:', err);
      }
    }
  });

  // Expose stop function to state so it can be stopped when message is sent
  state.stopMainMic = () => {
    if (isRecording) {
      isRecording = false;
      recognition.stop();
    }
  };
}
