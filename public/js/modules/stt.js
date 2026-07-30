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

  recognition.onstart = () => {
    isRecording = true;
    autoRestartCount = 0;
    if (currentMicBtn) currentMicBtn.classList.add('recording');
    if (currentInput) {
      originalPlaceholder = currentInput.placeholder;
      currentInput.placeholder = 'Listening...';
    }
  };

  recognition.onresult = (event) => {
    let transcripts = [];
    for (let i = 0; i < event.results.length; ++i) {
      let t = event.results[i][0].transcript.trim();
      if (t) transcripts.push(t);
    }
    
    // Clean up Android Chrome cumulative/duplicate bug
    let finalStr = '';
    for (let i = 0; i < transcripts.length; i++) {
      let current = transcripts[i];
      let isSubsumed = false;
      
      // Check if this transcript is subsumed by ANY subsequent transcript
      for (let j = i + 1; j < transcripts.length; j++) {
        let next = transcripts[j];
        if (next.toLowerCase().startsWith(current.toLowerCase())) {
          isSubsumed = true;
          break;
        }
      }
      
      if (!isSubsumed) {
        if (finalStr.length > 0) finalStr += ' ';
        finalStr += current;
      }
    }
    
    if (currentInput) {
      // Append a space if there's already text and it doesn't end with space
      let prefix = currentInput.dataset.initialValue || '';
      if (prefix && !prefix.endsWith(' ')) prefix += ' ';
      
      const combined = prefix + finalStr;
      currentInput.value = combined;
      
      // Auto-resize if it's a textarea
      currentInput.style.height = 'auto';
      currentInput.style.height = Math.min(currentInput.scrollHeight, 120) + 'px';
      
      // Trigger input event for any listeners (like updateActionButton)
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
