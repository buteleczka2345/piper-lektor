document.addEventListener('DOMContentLoaded', () => {
  const toggleLektorBtn = document.getElementById('toggleLektorBtn');
  const testVoiceBtn = document.getElementById('testVoiceBtn');
  const voiceSelect = document.getElementById('voiceSelect');
  const activeVoiceName = document.getElementById('activeVoiceName');
  const speedSlider = document.getElementById('speedSlider');
  const speedLabel = document.getElementById('speedLabel');
  const duckSlider = document.getElementById('duckSlider');
  const duckLabel = document.getElementById('duckLabel');
  const censorToggle = document.getElementById('censorToggle');
  const censorLabel = document.getElementById('censorLabel');
  const censorModeSelect = document.getElementById('censorModeSelect');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  const TTS_URL = 'http://127.0.0.1:8765/tts';
  const HEALTH_URL = 'http://127.0.0.1:8765/health';

  // Wczytaj stan
  chrome.storage.local.get(['selectedVoice', 'speechRate', 'duckVolume', 'filterEnabled', 'filterMode', 'lektorEnabled'], (res) => {
    if (res.selectedVoice) {
      voiceSelect.value = res.selectedVoice;
      activeVoiceName.textContent = voiceSelect.options[voiceSelect.selectedIndex]?.text.split(' ')[0] || res.selectedVoice;
    }
    if (res.speechRate) {
      speedSlider.value = res.speechRate;
      speedLabel.textContent = Number(res.speechRate).toFixed(2) + 'x';
    }
    if (res.duckVolume !== undefined) {
      duckSlider.value = res.duckVolume;
      duckLabel.textContent = Math.round(Number(res.duckVolume) * 100) + '%';
    }
    if (res.filterEnabled !== undefined) {
      censorToggle.checked = res.filterEnabled;
      censorLabel.textContent = res.filterEnabled ? 'Włączony' : 'Wyłączony';
      censorLabel.style.color = res.filterEnabled ? '#10b981' : '#94a3b8';
    }
    if (res.filterMode) {
      censorModeSelect.value = res.filterMode;
    }
    if (res.lektorEnabled) {
      toggleLektorBtn.textContent = '🔊 Lektor WŁĄCZONY';
      toggleLektorBtn.classList.add('active');
    }
  });

  // Sprawdź status Piper
  fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) })
    .then(res => {
      if (res.ok) {
        statusDot.classList.add('online');
        statusText.textContent = 'Piper 8765 Online';
      }
    })
    .catch(() => {
      statusDot.classList.remove('online');
      statusText.textContent = 'Piper Offline (WebSpeech)';
    });

  // Obsługa przycisków i suwaków
  toggleLektorBtn.addEventListener('click', () => {
    chrome.storage.local.get(['lektorEnabled'], (res) => {
      const next = !res.lektorEnabled;
      chrome.storage.local.set({ lektorEnabled: next });
      toggleLektorBtn.textContent = next ? '🔊 Lektor WŁĄCZONY' : '🔇 Lektor OFF';
      if (next) toggleLektorBtn.classList.add('active');
      else toggleLektorBtn.classList.remove('active');

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleLektor', enabled: next });
        }
      });
    });
  });

  voiceSelect.addEventListener('change', () => {
    const val = voiceSelect.value;
    activeVoiceName.textContent = voiceSelect.options[voiceSelect.selectedIndex]?.text.split(' ')[0] || val;
    chrome.storage.local.set({ selectedVoice: val });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'setVoice', voice: val });
      }
    });
  });

  speedSlider.addEventListener('input', () => {
    const val = speedSlider.value;
    speedLabel.textContent = Number(val).toFixed(2) + 'x';
    chrome.storage.local.set({ speechRate: val });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'setSpeed', speed: val });
      }
    });
  });

  duckSlider.addEventListener('input', () => {
    const val = duckSlider.value;
    duckLabel.textContent = Math.round(Number(val) * 100) + '%';
    chrome.storage.local.set({ duckVolume: val });
  });

  censorToggle.addEventListener('change', () => {
    const checked = censorToggle.checked;
    censorLabel.textContent = checked ? 'Włączony' : 'Wyłączony';
    censorLabel.style.color = checked ? '#10b981' : '#94a3b8';
    chrome.storage.local.set({ filterEnabled: checked });
  });

  censorModeSelect.addEventListener('change', () => {
    chrome.storage.local.set({ filterMode: censorModeSelect.value });
  });

  // Test głosu
  testVoiceBtn.addEventListener('click', async () => {
    const testText = "Cześć! To jest próbka głosu polskiego lektora Piper.";
    testVoiceBtn.textContent = '⏳ Mówię...';
    try {
      const resp = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: testText, voice: voiceSelect.value, speed: parseFloat(speedSlider.value) })
      });
      if (resp.ok) {
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => { testVoiceBtn.textContent = '▶️ Test Głosu'; };
        audio.play();
        return;
      }
    } catch (e) {}

    // Fallback Web Speech
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(testText);
      u.lang = 'pl-PL';
      u.rate = parseFloat(speedSlider.value);
      u.onend = () => { testVoiceBtn.textContent = '▶️ Test Głosu'; };
      window.speechSynthesis.speak(u);
    } else {
      testVoiceBtn.textContent = '▶️ Test Głosu';
    }
  });
});
