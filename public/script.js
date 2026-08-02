/* =====================================================
   Rash — AI Study Companion Frontend Logic
   Theme, Tabs, Voice (STT + TTS), Schedule, Notes, Chat
   Multi-select bulk delete for Schedule & Notes
   ===================================================== */
(function () {
  'use strict';

  // ---------- DOM refs ----------
  const messagesEl = document.getElementById('messages');
  const welcomeEl = document.getElementById('welcome');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('sendBtn');
  const micBtn = document.getElementById('micBtn');
  const typingEl = document.getElementById('typing');
  const resetBtn = document.getElementById('resetBtn');
  const voiceModeBtn = document.getElementById('voiceModeBtn');
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');

  const setupModal = document.getElementById('setupModal');
  const closeModalBtn = document.getElementById('closeModal');
  const groqKeyInput = document.getElementById('groqKeyInput');
  const geminiKeyInput = document.getElementById('geminiKeyInput');
  const saveKeyBtn = document.getElementById('saveKeyBtn');
  const apiKeyError = document.getElementById('apiKeyError');

  const toastEl = document.getElementById('toast');

  // ---------- State ----------
  let sessionId = null;
  let isWaiting = false;
  let voiceMode = false;

  /* ==================================================
     THEME TOGGLE (dark / light, persisted)
     ================================================== */
  const THEME_KEY = 'rash-theme';
  const MOON_SVG =
    '<svg id="themeIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  const SUN_SVG =
    '<svg id="themeIcon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>' +
    '<line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>' +
    '<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/>' +
    '<line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>' +
    '<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY) || 'dark';
    } catch (e) {
      return 'dark';
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    if (themeToggle) {
      themeToggle.innerHTML = theme === 'light' ? MOON_SVG : SUN_SVG;
    }
  }

  function initTheme() {
    const current = document.documentElement.getAttribute('data-theme') || getStoredTheme();
    applyTheme(current === 'light' ? 'light' : 'dark');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        applyTheme(next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch (e) { /* ignore */ }
      });
    }
  }

  /* ==================================================
     TABS
     ================================================== */
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  function switchTab(name) {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    panels.forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
    if (name === 'schedule') loadSchedule('today');
    if (name === 'notes') loadNotes();
  }

  tabs.forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  /* ==================================================
     HELPERS
     ================================================== */
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    const date = new Date(y, m - 1, d);
    const today = new Date();
    const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
    const isToday = todayStr() === dateStr;
    const isTomorrow = todayStr() === `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    if (isToday) return 'Today';
    if (isTomorrow) return 'Tomorrow';
    return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function fmtTime(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  function showToast(msg, ms = 3500) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toastEl.classList.add('hidden');
      toastEl.classList.remove('show');
    }, ms);
  }

  /* ==================================================
     MARKDOWN RENDER
     ================================================== */
  function renderMarkdown(text) {
    let html = escapeHTML(text);
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      return '<pre><code>' + code + '</code></pre>';
    });
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    html = html.replace(/^###\s*(.*)$/gm, '<h4>$1</h4>');
    html = html.replace(/^##\s*(.*)$/gm, '<h4>$1</h4>');
    html = html.replace(/^#\s*(.*)$/gm, '<h4>$1</h4>');
    html = html.replace(/^\s*[-•]\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    html = html.replace(/^\s*(\d+)\.\s+(.*)$/gm, '<li>$2</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ol>$1</ol>');
    const parts = html.split('</pre>');
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i].includes('<pre>')) {
        parts[i] = parts[i].replace(/\n/g, '<br/>');
      }
    }
    html = parts.join('</pre>');
    return html;
  }

  /* ==================================================
     VOICE MODULE (TTS + STT)
     ================================================== */
  function stripMarkdown(text) {
    return text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/^\s*[-•]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/✅|🎓|📚|🔔|📝|⚠️|🤖|🗓|💬|📅|🔊|🎤|👍|🚀|💡|🧠|✨/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  let voices = [];
  function loadVoices() {
    voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  }
  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function speak(text, rate = 1) {
    if (!window.speechSynthesis) return false;
    window.speechSynthesis.cancel();
    const clean = stripMarkdown(text);
    if (!clean) return false;
    const u = new SpeechSynthesisUtterance(clean);
    const enVoice = voices.find((v) => /en[-_](US|GB|IN)/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang));
    if (enVoice) u.voice = enVoice;
    u.rate = rate;
    u.pitch = 1;
    window.speechSynthesis.speak(u);
    return true;
  }

  function stopSpeaking() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  let recognition = null;
  let listening = false;

  function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      micBtn.title = 'Speech not supported in this browser';
      micBtn.style.opacity = '0.4';
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      inputEl.value = transcript;
      autoResize();
      listening = false;
      micBtn.classList.remove('listening');
      sendMessage();
    };
    recognition.onerror = (e) => {
      listening = false;
      micBtn.classList.remove('listening');
      if (e.error !== 'aborted') showToast('Mic error: ' + e.error);
    };
    recognition.onend = () => {
      listening = false;
      micBtn.classList.remove('listening');
    };
  }

  function toggleMic() {
    if (!recognition) {
      showToast('Speech input is not supported in this browser. Use Chrome or Edge.');
      return;
    }
    if (listening) {
      recognition.stop();
      listening = false;
      micBtn.classList.remove('listening');
      return;
    }
    try {
      recognition.start();
      listening = true;
      micBtn.classList.add('listening');
      showToast('🎤 Listening... speak now');
    } catch (e) {
      showToast('Could not start mic. Check permissions.');
    }
  }

  /* ==================================================
     CHAT
     ================================================== */
  function addMessage(role, text, { speakIt = false } = {}) {
    if (welcomeEl && !welcomeEl.classList.contains('hidden')) {
      welcomeEl.classList.add('hidden');
      welcomeEl.style.display = 'none';
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'message ' + role;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = role === 'bot' ? renderMarkdown(text) : escapeHTML(text);

    if (role === 'bot') {
      const actions = document.createElement('div');
      actions.className = 'bubble-actions';
      const speakBtn = document.createElement('button');
      speakBtn.className = 'speak-btn';
      speakBtn.innerHTML = '🔊 Listen';
      speakBtn.title = 'Read this answer aloud';
      speakBtn.addEventListener('click', () => {
        speakBtn.classList.add('speaking');
        speak(text, voiceMode ? 1 : 0.95);
        speakBtn.textContent = '⏹ Stop';
        speakBtn.onclick = () => {
          stopSpeaking();
          speakBtn.textContent = '🔊 Listen';
        };
      });
      actions.appendChild(speakBtn);
      bubble.appendChild(actions);
    }

    wrapper.appendChild(bubble);
    messagesEl.appendChild(wrapper);
    scrollToBottom();

    if (speakIt && role === 'bot') {
      setTimeout(() => speak(text, voiceMode ? 1 : 0.95), 300);
    }
    return wrapper;
  }

  function scrollToBottom() {
    const container = document.querySelector('.chat-container');
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }

  function showTyping() {
    typingEl.classList.remove('hidden');
    scrollToBottom();
  }
  function hideTyping() {
    typingEl.classList.add('hidden');
  }

  async function sendMessage() {
    const message = inputEl.value.trim();
    if (!message || isWaiting) return;

    inputEl.value = '';
    autoResize();

    addMessage('user', message);
    isWaiting = true;
    sendBtn.disabled = true;
    showTyping();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId, voiceMode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');

      sessionId = data.sessionId;
      const shouldSpeak = voiceMode;
      addMessage('bot', data.reply, { speakIt: shouldSpeak });

      if (data.action && data.action.action !== 'none') {
        loadSchedule('today');
        loadNotes();
      }
    } catch (err) {
      addMessage('bot', '⚠️ ' + (err.message || 'Connection error. Please try again.'));
    } finally {
      isWaiting = false;
      sendBtn.disabled = false;
      hideTyping();
      inputEl.focus();
    }
  }

  async function resetChat() {
    if (sessionId) {
      try {
        await fetch('/api/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
      } catch (e) { /* ignore */ }
    }
    sessionId = null;
    messagesEl.innerHTML = '';
    welcomeEl.classList.remove('hidden');
    welcomeEl.style.display = '';
    inputEl.value = '';
    hideTyping();
    stopSpeaking();
    inputEl.focus();
  }

  /* ==================================================
     VOICE MODE TOGGLE
     ================================================== */
  async function setVoiceMode(on) {
    voiceMode = on;
    voiceModeBtn.classList.toggle('active', on);
    voiceModeBtn.innerHTML = on ? '🔊 <span>Voice ON</span>' : '🔊 <span>Voice</span>';
    try {
      await fetch('/api/voice-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceMode: on })
      });
    } catch (e) { /* ignore */ }
    showToast(on ? '🔊 Voice mode ON — short spoken answers' : 'Voice mode OFF — detailed answers');
  }

  /* ==================================================
     SCHEDULE — Multi-Select Bulk Delete
     ================================================== */
  let scheduleFilter = 'today';
  let editingScheduleId = null;
  let scheduleSelectionMode = false;
  let scheduleSelected = new Set();

  function updateScheduleBulkBar() {
    const bar = document.getElementById('scheduleBulkBar');
    const countEl = document.getElementById('scheduleSelectedCount');
    if (scheduleSelectionMode && scheduleSelected.size > 0) {
      bar.classList.remove('hidden');
      countEl.textContent = scheduleSelected.size + ' selected';
    } else {
      bar.classList.add('hidden');
    }
  }

  function toggleScheduleSelectBtn() {
    const btn = document.getElementById('scheduleSelectBtn');
    if (scheduleSelectionMode) {
      scheduleSelectionMode = false;
      scheduleSelected.clear();
      btn.textContent = 'Select';
      btn.classList.remove('selecting');
      document.getElementById('scheduleBulkBar').classList.add('hidden');
      loadSchedule();
    } else {
      scheduleSelectionMode = true;
      btn.textContent = 'Done';
      btn.classList.add('selecting');
      loadSchedule();
    }
  }

  async function deleteSelectedSchedule() {
    if (!scheduleSelected.size) return;
    if (!confirm('Delete ' + scheduleSelected.size + ' selected schedule item(s)?')) return;
    const ids = Array.from(scheduleSelected);
    try {
      const res = await fetch('/api/schedule/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      showToast('🗑️ Deleted ' + data.deleted + ' item(s)');
      scheduleSelected.clear();
      scheduleSelectionMode = false;
      document.getElementById('scheduleSelectBtn').textContent = 'Select';
      document.getElementById('scheduleSelectBtn').classList.remove('selecting');
      document.getElementById('scheduleBulkBar').classList.add('hidden');
      loadSchedule();
    } catch (e) {
      showToast('Error: ' + e.message);
    }
  }

  async function loadSchedule(filter) {
    if (filter) scheduleFilter = filter;
    document.querySelectorAll('.filter-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.filter === scheduleFilter);
    });

    const listEl = document.getElementById('scheduleList');
    listEl.innerHTML = '<p class="empty-state">Loading...</p>';

    try {
      let url = '/api/schedule';
      if (scheduleFilter === 'today') url += '?date=' + todayStr();
      else if (scheduleFilter === 'upcoming') url += '?upcoming=1&days=7';
      const res = await fetch(url);
      const items = await res.json();

      if (!items.length) {
        listEl.innerHTML = '<p class="empty-state">Nothing here. Tap "+ Add" to schedule something! 📅</p>';
        return;
      }

      listEl.innerHTML = '';
      items.forEach((item) => listEl.appendChild(renderScheduleItem(item)));
    } catch (e) {
      listEl.innerHTML = '<p class="empty-state">Failed to load schedule.</p>';
    }
  }

  function renderScheduleItem(item) {
    const div = document.createElement('div');
    div.className = 'schedule-item' + (item.completed ? ' completed' : '') + ' priority-' + (item.priority || 'normal');

    const left = document.createElement('div');
    left.className = 'schedule-item-left';

    if (scheduleSelectionMode) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'item-checkbox';
      cb.checked = scheduleSelected.has(item.id);
      cb.addEventListener('change', () => {
        if (cb.checked) scheduleSelected.add(item.id);
        else scheduleSelected.delete(item.id);
        updateScheduleBulkBar();
      });
      left.appendChild(cb);
    } else {
      const checkbox = document.createElement('button');
      checkbox.className = 'check-btn';
      checkbox.innerHTML = item.completed ? '✅' : '⬜';
      checkbox.title = item.completed ? 'Mark incomplete' : 'Mark complete';
      checkbox.addEventListener('click', async () => {
        await fetch('/api/schedule/' + item.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed: item.completed ? 0 : 1 })
        });
        loadSchedule();
      });
      left.appendChild(checkbox);
    }

    const info = document.createElement('div');
    info.className = 'schedule-info';

    const title = document.createElement('div');
    title.className = 'schedule-title';
    title.textContent = item.title;

    const meta = document.createElement('div');
    meta.className = 'schedule-meta';
    const parts = [];
    if (item.subject) parts.push('<span class="tag tag-' + item.subject.toLowerCase().replace(/[^a-z0-9]/g, '') + '">' + escapeHTML(item.subject) + '</span>');
    if (item.date) parts.push('📅 ' + fmtDate(item.date));
    if (item.time) parts.push('🕐 ' + fmtTime(item.time));
    if (item.priority === 'high') parts.push('<span class="badge-high">High</span>');
    meta.innerHTML = parts.join(' · ') || '—';

    info.appendChild(title);
    info.appendChild(meta);
    left.appendChild(info);
    div.appendChild(left);

    if (!scheduleSelectionMode) {
      const actions = document.createElement('div');
      actions.className = 'schedule-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'mini-btn';
      editBtn.textContent = '✏️';
      editBtn.title = 'Edit';
      editBtn.addEventListener('click', () => openScheduleModal(item));
      const delBtn = document.createElement('button');
      delBtn.className = 'mini-btn danger';
      delBtn.textContent = '🗑️';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', async () => {
        if (confirm('Delete "' + item.title + '"?')) {
          await fetch('/api/schedule/' + item.id, { method: 'DELETE' });
          loadSchedule();
        }
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      div.appendChild(actions);
    }

    return div;
  }

  function openScheduleModal(item) {
    editingScheduleId = item ? item.id : null;
    document.getElementById('scheduleModalTitle').textContent = item ? 'Edit Schedule Item' : 'Add Schedule Item';
    document.getElementById('schTitle').value = item ? item.title : '';
    document.getElementById('schSubject').value = item ? item.subject || '' : '';
    document.getElementById('schDate').value = item ? item.date : todayStr();
    document.getElementById('schTime').value = item ? item.time || '' : '';
    document.getElementById('schPriority').value = item ? item.priority || 'normal' : 'normal';
    document.getElementById('schNote').value = item ? item.note || '' : '';
    document.getElementById('scheduleError').classList.add('hidden');
    const delBtn = document.getElementById('deleteScheduleBtn');
    if (item) delBtn.classList.remove('hidden');
    else delBtn.classList.add('hidden');
    document.getElementById('scheduleModal').classList.remove('hidden');
  }

  async function saveSchedule() {
    const title = document.getElementById('schTitle').value.trim();
    const date = document.getElementById('schDate').value;
    const time = document.getElementById('schTime').value;
    const subject = document.getElementById('schSubject').value;
    const priority = document.getElementById('schPriority').value;
    const note = document.getElementById('schNote').value.trim();
    const errEl = document.getElementById('scheduleError');

    if (!title) { errEl.textContent = 'Please enter a title.'; errEl.classList.remove('hidden'); return; }
    if (!date) { errEl.textContent = 'Please pick a date.'; errEl.classList.remove('hidden'); return; }

    const body = { title, date, time, subject, priority, note };
    try {
      if (editingScheduleId) {
        await fetch('/api/schedule/' + editingScheduleId, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
      } else {
        await fetch('/api/schedule', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
      }
      document.getElementById('scheduleModal').classList.add('hidden');
      loadSchedule();
      showToast('✅ Saved to schedule');
    } catch (e) {
      errEl.textContent = 'Failed to save. Please try again.';
      errEl.classList.remove('hidden');
    }
  }

  /* ==================================================
     NOTES — Multi-Select Bulk Delete
     ================================================== */
  let editingNoteId = null;
  let notesSelectionMode = false;
  let notesSelected = new Set();

  function updateNotesBulkBar() {
    const bar = document.getElementById('notesBulkBar');
    const countEl = document.getElementById('notesSelectedCount');
    if (notesSelectionMode && notesSelected.size > 0) {
      bar.classList.remove('hidden');
      countEl.textContent = notesSelected.size + ' selected';
    } else {
      bar.classList.add('hidden');
    }
  }

  function toggleNotesSelectBtn() {
    const btn = document.getElementById('notesSelectBtn');
    if (notesSelectionMode) {
      notesSelectionMode = false;
      notesSelected.clear();
      btn.textContent = 'Select';
      btn.classList.remove('selecting');
      document.getElementById('notesBulkBar').classList.add('hidden');
      loadNotes();
    } else {
      notesSelectionMode = true;
      btn.textContent = 'Done';
      btn.classList.add('selecting');
      loadNotes();
    }
  }

  async function deleteSelectedNotes() {
    if (!notesSelected.size) return;
    if (!confirm('Delete ' + notesSelected.size + ' selected note(s)?')) return;
    const ids = Array.from(notesSelected);
    try {
      const res = await fetch('/api/notes/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      showToast('🗑️ Deleted ' + data.deleted + ' note(s)');
      notesSelected.clear();
      notesSelectionMode = false;
      document.getElementById('notesSelectBtn').textContent = 'Select';
      document.getElementById('notesSelectBtn').classList.remove('selecting');
      document.getElementById('notesBulkBar').classList.add('hidden');
      loadNotes();
    } catch (e) {
      showToast('Error: ' + e.message);
    }
  }

  async function loadNotes() {
    const listEl = document.getElementById('notesList');
    listEl.innerHTML = '<p class="empty-state">Loading...</p>';
    try {
      const res = await fetch('/api/notes');
      const notes = await res.json();
      if (!notes.length) {
        listEl.innerHTML = '<p class="empty-state">No notes yet. Tap "+ Add" or say "note this: ..." 📝</p>';
        return;
      }
      listEl.innerHTML = '';
      notes.forEach((n) => listEl.appendChild(renderNote(n)));
    } catch (e) {
      listEl.innerHTML = '<p class="empty-state">Failed to load notes.</p>';
    }
  }

  function renderNote(note) {
    const div = document.createElement('div');
    div.className = 'note-card' + (note.pinned ? ' pinned' : '');

    const head = document.createElement('div');
    head.className = 'note-head';

    if (notesSelectionMode) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'item-checkbox';
      cb.checked = notesSelected.has(note.id);
      cb.addEventListener('change', () => {
        if (cb.checked) notesSelected.add(note.id);
        else notesSelected.delete(note.id);
        updateNotesBulkBar();
      });
      head.appendChild(cb);
    }

    const title = document.createElement('div');
    title.className = 'note-title';
    title.textContent = note.title + (note.pinned ? ' 📌' : '');
    head.appendChild(title);

    const subj = document.createElement('span');
    if (note.subject) subj.className = 'tag tag-' + note.subject.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (note.subject) subj.textContent = note.subject;
    if (note.subject) head.appendChild(subj);

    const content = document.createElement('div');
    content.className = 'note-content';
    content.innerHTML = renderMarkdown(note.content);
    div.appendChild(head);
    div.appendChild(content);

    if (!notesSelectionMode) {
      const actions = document.createElement('div');
      actions.className = 'schedule-actions';
      const pinBtn = document.createElement('button');
      pinBtn.className = 'mini-btn';
      pinBtn.textContent = note.pinned ? '📌' : '📍';
      pinBtn.title = note.pinned ? 'Unpin' : 'Pin';
      pinBtn.addEventListener('click', async () => {
        await fetch('/api/notes/' + note.id, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned: note.pinned ? 0 : 1 })
        });
        loadNotes();
      });
      const editBtn = document.createElement('button');
      editBtn.className = 'mini-btn';
      editBtn.textContent = '✏️';
      editBtn.title = 'Edit';
      editBtn.addEventListener('click', () => openNoteModal(note));
      const delBtn = document.createElement('button');
      delBtn.className = 'mini-btn danger';
      delBtn.textContent = '🗑️';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', async () => {
        if (confirm('Delete this note?')) {
          await fetch('/api/notes/' + note.id, { method: 'DELETE' });
          loadNotes();
        }
      });
      actions.appendChild(pinBtn);
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      div.appendChild(actions);
    }
    return div;
  }

  function openNoteModal(note) {
    editingNoteId = note ? note.id : null;
    document.getElementById('noteModalTitle').textContent = note ? 'Edit Note' : 'Add Note';
    document.getElementById('noteTitle').value = note ? note.title : '';
    document.getElementById('noteSubject').value = note ? note.subject || '' : '';
    document.getElementById('noteContent').value = note ? note.content : '';
    document.getElementById('noteError').classList.add('hidden');
    const delBtn = document.getElementById('deleteNoteBtn');
    if (note) delBtn.classList.remove('hidden');
    else delBtn.classList.add('hidden');
    document.getElementById('noteModal').classList.remove('hidden');
  }

  async function saveNote() {
    const title = document.getElementById('noteTitle').value.trim();
    const content = document.getElementById('noteContent').value.trim();
    const subject = document.getElementById('noteSubject').value;
    const errEl = document.getElementById('noteError');

    if (!content) { errEl.textContent = 'Please write some content.'; errEl.classList.remove('hidden'); return; }

    const body = { title: title || 'Note', content, subject };
    try {
      if (editingNoteId) {
        await fetch('/api/notes/' + editingNoteId, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
      } else {
        await fetch('/api/notes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
      }
      document.getElementById('noteModal').classList.add('hidden');
      loadNotes();
      showToast('✅ Note saved');
    } catch (e) {
      errEl.textContent = 'Failed to save. Please try again.';
      errEl.classList.remove('hidden');
    }
  }

  /* ==================================================
     REMINDERS (poll for due schedule items)
     ================================================== */
  let lastRemindedIds = new Set();
  let audioCtx = null;

  function armAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* ignore */ }
  }
  const _armOnce = () => { armAudio(); };
  document.addEventListener('pointerdown', _armOnce, { once: true });
  document.addEventListener('keydown', _armOnce, { once: true });

  function playRing() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      const notes = [659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = now + i * 0.18;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.55);
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  async function checkReminders() {
    try {
      const res = await fetch('/api/schedule?date=' + todayStr());
      const items = await res.json();
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();

      for (const item of items) {
        if (item.completed) continue;
        if (!item.time) continue;
        const [h, m] = item.time.split(':').map(Number);
        const itemMin = h * 60 + m;
        if (nowMin === itemMin && !lastRemindedIds.has(item.id)) {
          lastRemindedIds.add(item.id);
          playRing();
          setTimeout(() => speak('Reminder! ' + item.title), 500);
          showToast('🔔 Reminder: ' + item.title + (item.time ? ' at ' + fmtTime(item.time) : ''));
        }
      }
      if (lastRemindedIds.size > 50) lastRemindedIds.clear();
    } catch (e) { /* ignore */ }
  }

  /* ==================================================
     SUBJECT / SAMPLE CHIPS
     ================================================== */
  function setupSubjectChips() {
    document.querySelectorAll('.subject-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const subject = chip.dataset.subject;
        inputEl.value = 'I have a doubt in ' + subject + ': ';
        autoResize();
        inputEl.focus();
        const len = inputEl.value.length;
        inputEl.setSelectionRange(len, len);
      });
    });
    document.querySelectorAll('.sample-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        inputEl.value = chip.textContent.trim();
        autoResize();
        sendMessage();
      });
    });
  }

  /* ==================================================
     API SETUP MODAL
     ================================================== */
  function openSetupModal() {
    setupModal.classList.remove('hidden');
    apiKeyError.classList.add('hidden');
    groqKeyInput.value = '';
    geminiKeyInput.value = '';
    setTimeout(() => groqKeyInput.focus(), 50);
  }
  function closeSetupModal() {
    setupModal.classList.add('hidden');
  }

  async function saveApiKey() {
    const groqKey = groqKeyInput.value.trim();
    const geminiKey = geminiKeyInput.value.trim();
    if (!groqKey && !geminiKey) {
      apiKeyError.textContent = 'Please paste at least one free API key (GROQ or Gemini).';
      apiKeyError.classList.remove('hidden');
      return;
    }
    saveKeyBtn.disabled = true;
    saveKeyBtn.textContent = 'Connecting...';
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groqKey, geminiKey })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save key.');
      closeSetupModal();
      const banner = document.querySelector('.error-banner');
      if (banner) banner.remove();
      const parts = [];
      if (data.groqConfigured) parts.push('GROQ');
      if (data.geminiConfigured) parts.push('Gemini');
      const active = parts.length ? parts.join(' + ') : 'AI';
      addMessage('bot', '✅ Connected! Rash is online and ready (FREE ' + active + '). Ask me any doubt or tell me to schedule/note something!');
    } catch (err) {
      apiKeyError.textContent = err.message || 'Failed to connect. Please check your key.';
      apiKeyError.classList.remove('hidden');
    } finally {
      saveKeyBtn.disabled = false;
      saveKeyBtn.textContent = 'Save & Connect';
    }
  }

  /* ==================================================
     HEALTH CHECK
     ================================================== */
  async function checkHealth() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (data.voiceMode) {
        voiceMode = true;
        voiceModeBtn.classList.add('active');
        voiceModeBtn.innerHTML = '🔊 <span>Voice ON</span>';
      }
      if (!data.configured) {
        const banner = document.createElement('div');
        banner.className = 'error-banner';
        banner.innerHTML =
          '<span>⚠️ Rash is <strong>not connected</strong>. Click to add your free GROQ or Gemini key.</span>' +
          '<button id="setupKeyBtn">Add Key</button>';
        const container = document.querySelector('.chat-container');
        container.prepend(banner);
        container.querySelector('#setupKeyBtn').addEventListener('click', openSetupModal);
      }
    } catch (e) { /* ignore */ }
  }

  /* ==================================================
     AUTO-RESIZE
     ================================================== */
  function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
  }

  /* ==================================================
     EVENT LISTENERS
     ================================================== */
  sendBtn.addEventListener('click', sendMessage);
  resetBtn.addEventListener('click', resetChat);
  micBtn.addEventListener('click', toggleMic);
  voiceModeBtn.addEventListener('click', () => setVoiceMode(!voiceMode));

  inputEl.addEventListener('input', autoResize);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  closeModalBtn.addEventListener('click', closeSetupModal);
  saveKeyBtn.addEventListener('click', saveApiKey);
  setupModal.addEventListener('click', (e) => { if (e.target === setupModal) closeSetupModal(); });
  [groqKeyInput, geminiKeyInput].forEach((el) => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveApiKey(); } });
  });

  // Schedule modal
  document.getElementById('addScheduleBtn').addEventListener('click', () => openScheduleModal(null));
  document.getElementById('closeScheduleModal').addEventListener('click', () => document.getElementById('scheduleModal').classList.add('hidden'));
  document.getElementById('saveScheduleBtn').addEventListener('click', saveSchedule);
  document.getElementById('deleteScheduleBtn').addEventListener('click', async () => {
    if (editingScheduleId && confirm('Delete this item?')) {
      await fetch('/api/schedule/' + editingScheduleId, { method: 'DELETE' });
      document.getElementById('scheduleModal').classList.add('hidden');
      loadSchedule();
    }
  });
  document.getElementById('scheduleModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('scheduleModal')) document.getElementById('scheduleModal').classList.add('hidden');
  });
  document.querySelectorAll('.filter-btn').forEach((b) => b.addEventListener('click', () => loadSchedule(b.dataset.filter)));

  // Schedule multi-select
  document.getElementById('scheduleSelectBtn').addEventListener('click', toggleScheduleSelectBtn);
  document.getElementById('scheduleBulkDelete').addEventListener('click', deleteSelectedSchedule);
  document.getElementById('scheduleBulkCancel').addEventListener('click', () => {
    scheduleSelected.clear();
    toggleScheduleSelectBtn();
  });

  // Notes modal
  document.getElementById('addNoteBtn').addEventListener('click', () => openNoteModal(null));
  document.getElementById('closeNoteModal').addEventListener('click', () => document.getElementById('noteModal').classList.add('hidden'));
  document.getElementById('saveNoteBtn').addEventListener('click', saveNote);
  document.getElementById('deleteNoteBtn').addEventListener('click', async () => {
    if (editingNoteId && confirm('Delete this note?')) {
      await fetch('/api/notes/' + editingNoteId, { method: 'DELETE' });
      document.getElementById('noteModal').classList.add('hidden');
      loadNotes();
    }
  });
  document.getElementById('noteModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('noteModal')) document.getElementById('noteModal').classList.add('hidden');
  });

  // Notes multi-select
  document.getElementById('notesSelectBtn').addEventListener('click', toggleNotesSelectBtn);
  document.getElementById('notesBulkDelete').addEventListener('click', deleteSelectedNotes);
  document.getElementById('notesBulkCancel').addEventListener('click', () => {
    notesSelected.clear();
    toggleNotesSelectBtn();
  });

  /* ==================================================
     INIT
     ================================================== */
  function init() {
    initTheme();
    setupSubjectChips();
    checkHealth();
    initSpeechRecognition();
    inputEl.focus();

    checkReminders();
    setInterval(checkReminders, 15000);
  }

  init();
})();
