require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

// Gemini is the only AI runtime.
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------------
// Database init (persistent storage)
// ------------------------------------------------------------------
db.init();

// ------------------------------------------------------------------
// Gemini Flash Live-only client. GEMINI_LIVE_MODEL is configurable because
// model availability is tied to the Google Cloud project/region.
// ------------------------------------------------------------------
const ENV_PATH = path.join(__dirname, '.env');
let geminiApiKey = process.env.GEMINI_API_KEY || '';
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-flash-live';
let gemini = null;
function rebuildClient() {
  gemini = geminiApiKey
    ? new GoogleGenerativeAI(geminiApiKey).getGenerativeModel({ model: LIVE_MODEL })
    : null;
}
rebuildClient();
function isConfigured() { return Boolean(geminiApiKey); }
function persistConfig() {
  try {
    let envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    const set = (key, value) => {
      const re = new RegExp('^' + key + '=.*$', 'm');
      envContent = re.test(envContent) ? envContent.replace(re, key + '=' + value) : envContent + `\n${key}=${value}\n`;
    };
    set('GEMINI_API_KEY', geminiApiKey);
    set('GEMINI_LIVE_MODEL', LIVE_MODEL);
    fs.writeFileSync(ENV_PATH, envContent, 'utf8');
  } catch (e) { console.error('Failed to persist Gemini config:', e.message); }
}

// ------------------------------------------------------------------
// Session store — backed by persistent DB (survives restarts)
// ------------------------------------------------------------------
const sessions = new Map();
const MAX_HISTORY = 30;

function getSession(sessionId) {
  if (!sessionId || !sessions.has(sessionId)) {
    // load history from DB if sessionId given, else create a fresh one
    if (sessionId && /^[0-9a-f]{32}$/.test(sessionId)) {
      const history = db.getMessages(sessionId).map((m) => ({ role: m.role, content: m.content }));
      const session = { history, createdAt: Date.now() };
      sessions.set(sessionId, session);
      return { sessionId, session };
    }
    sessionId = crypto.randomBytes(16).toString('hex');
    sessions.set(sessionId, { history: [], createdAt: Date.now() });
  }
  return { sessionId, session: sessions.get(sessionId) };
}

// ------------------------------------------------------------------
// The Master Tutor System Prompt (tuned for Class 10 CBSE subjects)
// Voice mode produces short spoken answers; study mode gives detail.
// ------------------------------------------------------------------
const SYSTEM_PROMPT = `You are "Rash", a friendly AI tutor and study companion for Class 10 CBSE students.

YOU ARE TEACHING THESE SUBJECTS (all at Class 10 CBSE / NCERT level):
1. Science (Physics, Chemistry, Biology) - NCERT Science, Ch 1-13
2. Hindi (Kshitij, Kritika, Sparsh, Sanchayan)
3. English (First Flight, Footprints Without Feet - prose/poetry/grammar/writing)
4. SST (History: Nationalism in India etc., Geography: Resources, Civics, Economics)
5. IT (Information Technology 402 - DBMS, HTML/CSS, Digital Documentation, etc.)
6. Retail (Retail Operations 401 - store ops, billing, customer service, inventory)
7. AI (Artificial Intelligence 417 - AI concepts, Python, Data Science, Neural Networks basics)
8. Maths (Real Numbers, Polynomials, Linear Equations, Quadratic Equations, AP, Triangles, Trigonometry, Circles, Constructions, Areas, Surface Areas & Volumes, Statistics, Probability)

CORE TEACHING RULES - ALWAYS FOLLOW THESE:
1. ADAPT TO SUBJECT: Detect the subject from the doubt and use subject-specific terminology and methods.
2. EXPLAIN STEP-BY-STEP: Break down every answer into clear, numbered steps a Class 10 student can follow.
3. SOCRATIC FIRST, THEN ANSWER: For homework-type questions, first encourage the student to try (give a small hint). If they're stuck or ask directly, give the full solution with reasoning.
4. USE EXAMPLES: Provide real, relatable examples from daily life.
5. MATHS: Show formulas clearly (e.g., x = [-b ± √(b²-4ac)] / 2a) and work through the calculation fully.
6. SCIENCE: Connect to NCERT chapters, laws (Newton's, Ohm's, Reflection, etc.), and practical examples.
7. LANGUAGE (Hindi/English): Correct grammar, explain vocabulary with meaning + usage in a sentence, help with writing formats (letters, essays, summaries).
8. SST: Use dates, events, terms, and connect to NCERT textbook language. Explain the "why" behind events.
9. IT/RETAIL/AI: Use technical terms simply. For AI include Python snippets when helpful. For Retail include real store scenarios.
10. ENCOURAGING TONE: Always be patient, friendly, and motivating. Never make the student feel bad for asking. Praise effort.
11. FORMAT: Use short paragraphs, bullet points, and numbered lists. Keep answers well-structured and readable.
12. If the question is unclear, politely ask for more detail.
13. Keep answers concise but complete - typically 150-400 words unless it's a long-answer question (then up to ~600 words).
14. If asked something outside these subjects, respond briefly and steer back to studies.

VOICE MODE (when the user enables it):
- Answer in 1-3 SHORT, natural sentences that can be spoken aloud easily.
- NO markdown, NO bullet lists, NO formulas with symbols — say things in plain words.
- Keep it conversational and friendly, like a teacher speaking to you.

You remember the earlier conversation in this session, so answer follow-up questions naturally (e.g., "what about part b?" refers to the previous question).`;

// ------------------------------------------------------------------
// Helper: extract meaningful search terms from a user question
// ------------------------------------------------------------------
function extractSearchTerms(text) {
  const stop = new Set([
    'what', 'whats', 'which', 'when', 'where', 'who', 'how', 'are', 'do', 'did',
    'does', 'have', 'has', 'had', 'my', 'me', 'the', 'and', 'for', 'about', 'with',
    'from', 'notes', 'note', 'schedule', 'scheduled', 'saving', 'saved', 'save',
    'show', 'tell', 'list', 'any', 'all', 'today', 'tomorrow', 'this', 'that',
    'there', 'their', 'week', 'day', 'days', 'date', 'time', 'please', 'can',
    'could', 'you', 'your', 'i', 'is', 'in', 'on', 'of', 'to', 'it', 'at', 'also'
  ]);
  const raw = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  return raw.split(/\s+/).filter((t) => t.length > 2 && !stop.has(t));
}

// ------------------------------------------------------------------
// Helper: build DB context — lets the AI retrieve data the student
// has stored (notes + schedule) instead of only chat history.
// Intent detection is SPLIT so asking about notes never pulls in
// schedule data (and vice-versa).
// ------------------------------------------------------------------
function buildDatabaseContext(text) {
  const lower = text.toLowerCase();

  // Notes-only intent keywords
  const notesKeywords = [
    'my notes', 'saved note', 'saved notes', 'note about', 'did i note',
    'did i save', 'what notes', 'show my notes', 'list my notes',
    'my saved', 'saved formula', 'my formulas', 'my study notes', 'saved stuff',
    'read my note', 'what did i note', 'what did i save'
  ];

  // Schedule-only intent keywords
  const scheduleKeywords = [
    'my schedule', "what's on my", "whats on my", 'my tasks', 'my reminders',
    'my homework', 'my exams', 'my tests', 'my study plan', "what's scheduled",
    'what is scheduled', 'whats scheduled', 'upcoming', 'due', 'deadline',
    'my timetable', 'what do i have scheduled', 'remind me about what'
  ];

  // Generic "show me what I have" keywords → retrieve BOTH
  const genericKeywords = [
    'what have i', 'what do i have', 'show my', 'list my', 'anything saved',
    'what is saved', 'whats saved', 'my saved data', 'everything saved'
  ];
  const wantsNotes = notesKeywords.some((k) => lower.includes(k));
  const wantsSchedule = scheduleKeywords.some((k) => lower.includes(k));
  const wantsGeneric = genericKeywords.some((k) => lower.includes(k));

  const isDbQuery = wantsNotes || wantsSchedule || wantsGeneric;
  if (!isDbQuery) return null;

  const parts = [];

  // 1) Search the student's saved notes ONLY if notes/generic intent
  if (wantsNotes || wantsGeneric) {
    const terms = extractSearchTerms(lower);
    const notes = terms.length ? db.searchNotes(terms.join(' ')) : [];
    if (notes && notes.length) {
      parts.push(
        'SAVED NOTES (from the database):\n' +
        notes.map((n) => `- "${n.title || 'Note'}"${n.subject ? ' [' + n.subject + ']' : ''}: ${n.content}`).join('\n')
      );
    }
  }

  // 2) Pull schedule data ONLY if schedule/generic intent
  if (wantsSchedule || wantsGeneric) {
    let scheduleData;
    if (/\btoday\b/.test(lower)) {
      scheduleData = db.listSchedule(db.todayStr());
    } else {
      scheduleData = db.getUpcoming(14);
    }
    if (scheduleData && scheduleData.length) {
      parts.push(
        'SCHEDULE (from the database):\n' +
        scheduleData.map((s) => `- "${s.title}"${s.subject ? ' [' + s.subject + ']' : ''}${s.date ? ' on ' + s.date : ''}${s.time ? ' at ' + s.time : ''}${s.completed ? ' [completed]' : ''}${s.priority === 'high' ? ' [high priority]' : ''}`).join('\n')
      );
    }
  }

  if (!parts.length) return null;

  return (
    'The user is asking about data they saved earlier. Here is the relevant data retrieved from the local database — treat this as ground truth and summarize it for the student:\n\n' +
    parts.join('\n\n')
  );
}

// ------------------------------------------------------------------
// Helper: build messages with session history
// ------------------------------------------------------------------
function buildMessages(session, userMessage, voiceMode, dbContext) {
  const history = (session.history || []).slice(-MAX_HISTORY);
  const system = voiceMode
    ? SYSTEM_PROMPT + '\n\nIMPORTANT: The user has VOICE MODE enabled. Respond in 1-3 short, natural spoken sentences. No markdown. No lists. Plain, speakable words.'
    : SYSTEM_PROMPT;
  const messages = [{ role: 'system', content: system }];
  for (const m of history) {
    messages.push({ role: m.role, content: m.content });
  }
  if (dbContext) {
    messages.push({ role: 'user', content: dbContext });
  }
  messages.push({ role: 'user', content: userMessage });
  return messages;
}

// Global voice mode flag
let voiceModeEnabled = db.getSetting('voice_mode', 'false') === 'true';

// ------------------------------------------------------------------
// AI call: Gemini Flash Live-only. This REST turn uses the same configured
// Live model for text turns; browser/device audio can be connected separately.
// ------------------------------------------------------------------
async function askAI(messages) {
  if (!gemini) throw new Error('Gemini Live is not configured.');
  const contents = [];
  const system = messages.find((m) => m.role === 'system');
  for (const m of messages) {
    if (m.role !== 'system') contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  const result = await gemini.generateContent({
    contents,
    systemInstruction: system ? { parts: [{ text: system.content }] } : undefined,
    generationConfig: { temperature: 0.7, maxOutputTokens: voiceModeEnabled ? 200 : 1200 }
  });
  return result.response.text().trim();
}

// ------------------------------------------------------------------
// AI action extraction: schedule / notes
// ------------------------------------------------------------------
const ACTION_PROMPT = `You are a personal-assistant command parser for a Class 10 student's AI study companion.

Your job: detect if the user's message is a SCHEDULE or NOTE command and extract structured data.
You can also detect EDIT_NOTE and DELETE_NOTE commands.

Respond with a SINGLE JSON object, nothing else. Use these formats:

If it's a schedule/reminder/task (words like "remind", "schedule", "add to my schedule", "homework due", "test on", "revise", "todo", "at [time]", "tomorrow", "next week", "on [date]"):
{
  "action": "schedule",
  "title": "short task title",
  "subject": "detected subject (Maths/Science/English/Hindi/SST/IT/Retail/AI or empty)",
  "date": "YYYY-MM-DD",
  "time": "HH:MM (24h, empty if not given)",
  "priority": "high|normal|low",
  "note": "extra context or empty"
}
- For "today" use today's date. "tomorrow" = +1 day.
- If a relative time like "5pm" or "17:00" is given, convert to 24h HH:MM.

If it's a note ("note this", "remember that", "save this formula", "make a note"):
{
  "action": "note",
  "title": "short note title",
  "content": "full note content",
  "subject": "detected subject or empty"
}

If it's editing an existing note (words like "edit my note", "update my note", "change note", "modify note"):
{
  "action": "edit_note",
  "searchQuery": "keywords to find the note (e.g. Newton, Physics formulas)",
  "title": "new title (or keep original if not mentioned)",
  "content": "new content with the edits applied",
  "subject": "new subject or empty"
}

If it's deleting a note (words like "delete my note", "remove my note", "erase note"):
{
  "action": "delete_note",
  "searchQuery": "keywords to find the note to delete (e.g. about Newton, Physics formulas)"
}

If it's neither a schedule nor a note command, respond with:
{
  "action": "none"
}

Only output the JSON object.`;

function parseAction(jsonText) {
  try {
    const m = jsonText.match(/\{[\s\S]*\}/);
    if (!m) return { action: 'none' };
    return JSON.parse(m[0]);
  } catch (e) {
    return { action: 'none' };
  }
}

function toDateStrFromOffset(offsetDays) {
  const ist = db.getIST();
  const d = new Date(ist.year, ist.month - 1, ist.day + offsetDays);
  return db.toDateStr(d);
}

// ------------------------------------------------------------------
// Deterministic reminder parser — reliable "remind me at ..." handling
// (no dependency on the AI provider returning perfect JSON)
// ------------------------------------------------------------------
function toHHMM(hour, minute, ampm) {
  let h = hour;
  if (ampm) {
    const a = ampm.toLowerCase();
    if (a === 'am' && h === 12) h = 0;
    else if (a === 'pm' && h !== 12) h += 12;
  }
  if (h < 0 || h > 23 || (minute || 0) > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}`;
}

function detectSubject(text) {
  const lower = text.toLowerCase();
  const map = [
    { s: 'Maths', k: ['maths', 'math', 'mathematics', 'algebra', 'geometry', 'trigonometry', 'quadratic', 'arithmetic', 'calculus'] },
    { s: 'Science', k: ['science', 'physics', 'chemistry', 'biology', 'newton', 'ohm', 'photosynthesis', 'mixture', 'compound', 'force', 'reaction'] },
    { s: 'English', k: ['english', 'grammar', 'essay', 'letter', 'prose', 'poem', 'writing', 'vocabulary'] },
    { s: 'Hindi', k: ['hindi'] },
    { s: 'SST', k: ['sst', 'history', 'geography', 'civics', 'economics', 'nationalism'] },
    { s: 'IT', k: ['it 402', 'database', 'html', 'css', 'dbms', 'digital documentation', 'spreadsheet'] },
    { s: 'Retail', k: ['retail', 'store', 'billing', 'inventory', 'customer service'] },
    { s: 'AI', k: ['artificial intelligence', 'neural network', 'machine learning', ' ai '] }
  ];
  for (const entry of map) {
    if (entry.k.some((k) => lower.includes(k))) return entry.s;
  }
  return '';
}

function parseDayOffset(text) {
  const lower = text.toLowerCase();
  if (/\btoday\b/.test(lower)) return 0;
  if (/\btomorrow\b/.test(lower)) return 1;
  const days = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  for (const day of Object.keys(days)) {
    if (new RegExp('\\bon\\s+' + day).test(lower)) {
      const offset = (days[day] - new Date().getDay() + 7) % 7;
      return offset === 0 ? 7 : offset; // "on monday" means the next monday
    }
  }
  if (/\bnext\s+week\b/.test(lower)) return 7;
  return null;
}

function parseReminderCommand(text) {
  const lower = text.toLowerCase();
  // Only treat as a reminder if it clearly is one (with a time)
  if (!/remind|reminder|remember to|schedule|todo|deadline|homework|meeting|practice|submit|revise|test on/.test(lower)) {
    return null;
  }

  // 1) Extract time — "5 pm", "5:30pm", "17:00", "in 30 minutes"
  let time = null;
  const m12 = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m12) {
    time = toHHMM(parseInt(m12[1], 10), parseInt(m12[2] || '0', 10), m12[3]);
  }
  if (!time) {
    const m24 = lower.match(/\b(\d{1,2}):(\d{2})\b/);
    if (m24) time = toHHMM(parseInt(m24[1], 10), parseInt(m24[2], 10), null);
  }
  if (!time) {
    const mIn = lower.match(/\bin\s+(\d+)\s*(minutes?|mins?|hrs?|hours?)\b/);
    if (mIn) {
      const n = parseInt(mIn[1], 10);
      const d = new Date();
      if (/^m/.test(mIn[2])) d.setMinutes(d.getMinutes() + n);
      else d.setHours(d.getHours() + n);
      time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
  if (!time) return null;

  // 2) Extract date offset (default today)
  let offset = parseDayOffset(text);
  if (offset === null) offset = 0;

  // 3) Extract the topic / title (strip command words, time & date parts)
  const title = text
    .replace(/remind me to\s*/i, '')
    .replace(/remind me\s*/i, '')
    .replace(/^remind\s*/i, '')
    .replace(/please\s*/i, '')
    .replace(/\bin\s+\d+\s*(minutes?|mins?|hrs?|hours?)\b/gi, '')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/gi, '')
    .replace(/\b\d{1,2}:\d{2}\b/g, '')
    .replace(/\b(today|tomorrow|next\s+week)\b/gi, '')
    .replace(/\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/^\s*(at|for|about|to)\s+/i, '')
    .replace(/\s+(at|on)\s*$/i, '')
    .replace(/[.,;!?]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    title: title || 'Reminder',
    time,
    date: toDateStrFromOffset(offset),
    subject: detectSubject(title || text)
  };
}

async function detectAndApplyAction(text) {
  // Skip action parsing for obvious study questions
  const lower = text.toLowerCase();
  const studyKeywords = [
    'explain', 'what is', 'what are', 'how to', 'why did', 'why does', 'difference between',
    'solve', 'formula', 'define', 'write a', 'essay', 'derive', 'prove', 'convert'
  ];
  const isStudy = studyKeywords.some((k) => lower.startsWith(k));
  if (isStudy) return { action: 'none' };

// Try to detect schedule/note intent quickly
  const scheduleKeywords = ['remind', 'schedule', 'homework', 'test', 'revise', 'exam', 'todo', 'meeting', 'practice', 'submit', 'deadline', ' at ', 'tomorrow', 'today at', 'next week', 'on monday', 'on tuesday', 'on wednesday', 'on thursday', 'on friday', 'on saturday', 'on sunday'];
  const noteKeywords = ['note this', 'note that', 'remember', 'save this', 'make a note', 'take a note', 'remember this'];
  const editNoteKeywords = ['edit my note', 'edit note', 'update my note', 'update note', 'change my note', 'change note', 'modify note', 'modify my note'];
  const deleteNoteKeywords = ['delete my note', 'delete note', 'remove my note', 'remove note', 'erase my note', 'erase note', 'delete that note', 'remove that note'];

  let action = { action: 'none' };

  // Helper: ask AI to parse the action and handle the result
  async function askAction() {
    const messages = [
      { role: 'system', content: ACTION_PROMPT },
      { role: 'user', content: text }
    ];
    const reply = await askAI(messages);
    return parseAction(reply);
  }

  if (deleteNoteKeywords.some((k) => lower.includes(k))) {
    try {
      const parsed = await askAction();
      if (parsed.action === 'delete_note' && parsed.searchQuery) {
        const notes = db.searchNotes(parsed.searchQuery);
        if (notes && notes.length) {
          const target = notes[0];
          db.deleteNote(target.id);
          return { action: 'delete_note', deleted: { title: target.title, id: target.id } };
        }
      }
    } catch (e) {
      console.error('Action parse (delete_note) error:', e.message);
    }
  }

  if (editNoteKeywords.some((k) => lower.includes(k))) {
    try {
      const parsed = await askAction();
      if (parsed.action === 'edit_note' && parsed.searchQuery) {
        const notes = db.searchNotes(parsed.searchQuery);
        if (notes && notes.length) {
          const target = notes[0];
          const updated = db.updateNote(target.id, {
            title: parsed.title || target.title,
            content: parsed.content || target.content,
            subject: parsed.subject || target.subject
          });
          return { action: 'edit_note', saved: updated };
        }
      }
    } catch (e) {
      console.error('Action parse (edit_note) error:', e.message);
    }
  }

  if (noteKeywords.some((k) => lower.includes(k))) {
    try {
      const parsed = await askAction();
      action = parsed;
      if (action.action === 'note') {
        const saved = db.addNote({ title: action.title || 'Note', content: action.content || text, subject: action.subject || '' });
        return { action: 'note', saved };
      }
    } catch (e) {
      console.error('Action parse (note) error:', e.message);
      return { action: 'none' };
    }
  }

  if (scheduleKeywords.some((k) => lower.includes(k))) {
    try {
      const parsed = await askAction();
      action = parsed;
      if (action.action === 'schedule') {
        let date = action.date;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          if (lower.includes('tomorrow')) date = toDateStrFromOffset(1);
          else if (lower.includes('next week')) date = toDateStrFromOffset(7);
          else date = toDateStrFromOffset(0);
        }
        const time = action.time && /^\d{2}:\d{2}$/.test(action.time) ? action.time : '';
        const saved = db.addSchedule({
          title: action.title || text.slice(0, 60),
          subject: action.subject || '',
          date,
          time,
          priority: ['high', 'normal', 'low'].includes(action.priority) ? action.priority : 'normal',
          note: action.note || ''
        });
        return { action: 'schedule', saved };
      }
    } catch (e) {
      console.error('Action parse (schedule) error:', e.message);
      return { action: 'none' };
    }
  }

  return action;
}

// ------------------------------------------------------------------
// Desk controller: hardware daemons may POST the physical mute button to this
// endpoint. State is persistent so a browser LCD and hardware stay in sync.
// ------------------------------------------------------------------
let controllerState = {
  muted: db.getSetting('controller_muted', 'false') === 'true',
  rgb: db.getSetting('controller_rgb', '#7c3aed'),
  pomodoro: JSON.parse(db.getSetting('pomodoro_state', '{"mode":"focus","seconds":1500,"running":false}'))
};
function saveController() {
  db.setSetting('controller_muted', String(controllerState.muted));
  db.setSetting('controller_rgb', controllerState.rgb);
  db.setSetting('pomodoro_state', JSON.stringify(controllerState.pomodoro));
}
app.get('/api/controller', (req, res) => res.json(controllerState));
app.post('/api/controller/mute-toggle', (req, res) => {
  controllerState.muted = req.body?.muted === undefined ? !controllerState.muted : Boolean(req.body.muted);
  saveController(); res.json(controllerState);
});
app.post('/api/controller/rgb', (req, res) => {
  const color = (req.body?.color || '').toString();
  if (!/^#[0-9a-f]{6}$/i.test(color)) return res.status(400).json({ error: 'RGB color must be #RRGGBB.' });
  controllerState.rgb = color; saveController(); res.json(controllerState);
});
app.post('/api/pomodoro', (req, res) => {
  const { action, seconds } = req.body || {};
  if (action === 'start') controllerState.pomodoro.running = true;
  if (action === 'pause') controllerState.pomodoro.running = false;
  if (action === 'reset') controllerState.pomodoro = { mode: 'focus', seconds: 1500, running: false };
  if (action === 'set' && Number.isInteger(seconds) && seconds >= 0) controllerState.pomodoro.seconds = seconds;
  if (action === 'complete') controllerState.pomodoro = { mode: controllerState.pomodoro.mode === 'focus' ? 'break' : 'focus', seconds: controllerState.pomodoro.mode === 'focus' ? 300 : 1500, running: false };
  saveController(); res.json(controllerState.pomodoro);
});

// Google Calendar OAuth and scheduling. Calendar is deliberately opt-in; local
// schedules continue to work when credentials have not been configured.
function calendarClient() {
  const id = process.env.GOOGLE_CALENDAR_CLIENT_ID, secret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!id || !secret) return null;
  const client = new google.auth.OAuth2(id, secret, process.env.GOOGLE_CALENDAR_REDIRECT_URI || `http://localhost:${PORT}/api/calendar/callback`);
  const token = db.getSetting('google_calendar_token', '');
  if (token) client.setCredentials(JSON.parse(token));
  client.on('tokens', (tokens) => db.setSetting('google_calendar_token', JSON.stringify({ ...client.credentials, ...tokens })));
  return client;
}
app.get('/api/calendar/status', (req, res) => res.json({ configured: Boolean(calendarClient()), connected: Boolean(db.getSetting('google_calendar_token', '')) }));
app.get('/api/calendar/connect', (req, res) => {
  const client = calendarClient();
  if (!client) return res.status(400).send('Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET first.');
  res.redirect(client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/calendar.events'] }));
});
app.get('/api/calendar/callback', async (req, res) => {
  try { const client = calendarClient(); const { tokens } = await client.getToken(req.query.code); db.setSetting('google_calendar_token', JSON.stringify(tokens)); res.send('Google Calendar connected. You can close this page and return to Rash.'); }
  catch (error) { res.status(500).send('Calendar connection failed: ' + error.message); }
});
async function createCalendarEvent(item) {
  const auth = calendarClient(); if (!auth || !db.getSetting('google_calendar_token', '')) return null;
  const calendar = google.calendar({ version: 'v3', auth });
  const tz = process.env.CALENDAR_TIME_ZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = item.time ? { dateTime: `${item.date}T${item.time}:00`, timeZone: tz } : { date: item.date };
  const end = item.time ? { dateTime: new Date(new Date(`${item.date}T${item.time}:00`).getTime() + 60 * 60 * 1000).toISOString(), timeZone: tz } : { date: item.date };
  const out = await calendar.events.insert({ calendarId: 'primary', requestBody: { summary: item.title, description: item.note || '', start, end } });
  return out.data.id;
}
// Spotify Connect uses a user-provided device ID and the official Web API token.
app.post('/api/spotify/:command', async (req, res) => {
  const token = process.env.SPOTIFY_ACCESS_TOKEN;
  if (!token) return res.status(400).json({ error: 'Set SPOTIFY_ACCESS_TOKEN to enable Spotify controls.' });
  const command = req.params.command;
  const path = command === 'play' ? '/v1/me/player/play' : command === 'pause' ? '/v1/me/player/pause' : command === 'next' ? '/v1/me/player/next' : command === 'previous' ? '/v1/me/player/previous' : null;
  if (!path) return res.status(404).json({ error: 'Unknown Spotify command.' });
  const suffix = process.env.SPOTIFY_DEVICE_ID ? `?device_id=${encodeURIComponent(process.env.SPOTIFY_DEVICE_ID)}` : '';
  const response = await fetch('https://api.spotify.com' + path + suffix, { method: command === 'next' || command === 'previous' ? 'POST' : 'PUT', headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return res.status(response.status).json({ error: 'Spotify rejected the command. Refresh SPOTIFY_ACCESS_TOKEN.' });
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// API: GET /api/health
// ------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ configured: isConfigured(), provider: 'gemini-live', model: LIVE_MODEL,
    geminiConfigured: !!geminiApiKey, db: 'ok', voiceMode: voiceModeEnabled,
    calendarConfigured: Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET),
    controller: controllerState });
});

// Gemini Live-only configuration. No provider switching or fallback exists.
app.post('/api/config', (req, res) => {
  const cleanKey = (req.body?.geminiKey || req.body?.apiKey || '').toString().trim();
  if (!cleanKey) return res.status(400).json({ error: 'Please enter a Gemini API key.' });
  geminiApiKey = cleanKey;
  rebuildClient();
  persistConfig();
  res.json({ ok: true, configured: true, provider: 'gemini-live', model: LIVE_MODEL, geminiConfigured: true });
});

// ------------------------------------------------------------------
// API: POST /api/chat — with persistent history + actions + voice mode
// ------------------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  const { message, sessionId: incomingId, voiceMode } = req.body || {};
  const cleanMessage = (message || '').toString().trim();

  if (!cleanMessage) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }

  const { sessionId, session } = getSession(incomingId);

  // Save user message to DB
  db.addMessage(sessionId, 'user', cleanMessage);
  session.history.push({ role: 'user', content: cleanMessage });

  if (voiceMode !== undefined) {
    voiceModeEnabled = !!voiceMode;
    db.setSetting('voice_mode', String(voiceModeEnabled));
  }

  if (!isConfigured()) {
    const fallback =
      "I'm ready to help! 🎓 But I need my brain connected first. " +
      'Click the "Add API Key" button above to connect Gemini Flash Live, ' +
      'then ask me any doubt from Class 10 Science, Maths, English, Hindi, SST, IT, Retail, or AI!';
    session.history.push({ role: 'assistant', content: fallback });
    db.addMessage(sessionId, 'assistant', fallback);
    return res.json({ reply: fallback, sessionId, action: { action: 'none' } });
  }

  try {
    // 1) Deterministic reminder parser — reliable, always works (no AI dependency)
    let action = { action: 'none' };
    const reminder = parseReminderCommand(cleanMessage);
    if (reminder) {
      const saved = db.addSchedule({
        title: reminder.title,
        subject: reminder.subject,
        date: reminder.date,
        time: reminder.time,
        priority: 'high',
        note: cleanMessage
      });
      action = { action: 'schedule', saved };
    }

    // 2) Fall back to AI-based action detection (notes / complex schedule phrases)
    if (action.action === 'none') {
      try {
        action = await detectAndApplyAction(cleanMessage);
      } catch (e) {
        console.error('Action detection error:', e.message);
      }
    }

    // Sync AI-created reminders too, so every scheduling route has the same calendar behavior.
    if (action?.action === 'schedule' && action.saved) {
      try { const eventId = await createCalendarEvent(action.saved); if (eventId) db.setSetting('calendar_event_' + action.saved.id, eventId); }
      catch (error) { console.warn('Calendar sync skipped:', error.message); }
    }

    // 3) Build DB context (notes + schedule retrieval) for relevant questions
    const dbContext = buildDatabaseContext(cleanMessage);

    // 4) Get AI reply (voice-aware, with optional DB context)
    const reply = await askAI(buildMessages(session, cleanMessage, voiceModeEnabled, dbContext));

// If we scheduled something, prepend a short confirmation
    let finalReply = reply;
    if (action && action.action === 'schedule' && action.saved) {
      const s = action.saved;
      finalReply = `✅ Done! I've added "${s.title}" to your schedule${s.time ? ' at ' + s.time : ''} on ${s.date}. ` + reply;
    } else if (action && action.action === 'note' && action.saved) {
      finalReply = `✅ Done! I've saved "${action.saved.title}" to your notes. ` + reply;
    } else if (action && action.action === 'edit_note' && action.saved) {
      finalReply = `✅ Done! I've updated the note "${action.saved.title}". ` + reply;
    } else if (action && action.action === 'delete_note' && action.deleted) {
      finalReply = `✅ Done! I've deleted the note "${action.deleted.title}". ` + reply;
    }

    session.history.push({ role: 'assistant', content: finalReply });
    db.addMessage(sessionId, 'assistant', finalReply);
    res.json({ reply: finalReply, sessionId, action: action || { action: 'none' } });
  } catch (err) {
    console.error(`Gemini Live API error:`, err.status || err.message);
    session.history.pop(); // remove the failed user turn
    db.getMessages(sessionId); // no-op (keep DB consistent)

    const status = err.status;
    const errMsg = (err.message || '').toLowerCase();
    const provider = 'gemini-live';

    let message;
    if (status === 400 || status === 401 || status === 403) {
      message = 'Invalid API key. Please check your key and try again.';
    } else if (status === 404) {
      message = 'The AI model "' + LIVE_MODEL + '" is not available for your provider. Check AI_MODEL in the .env file and restart.';
    } else if (status === 429) {
      message = 'Rate limit reached (too many questions too fast). Please wait a moment and try again.';
    } else if (errMsg.includes('quota') || errMsg.includes('billing')) {
      message = 'Gemini quota has been exhausted. Please wait and try again.';
    } else {
      message = 'Something went wrong while contacting the AI. Please try again in a moment.';
    }
    res.status(500).json({ error: message });
  }
});

// ------------------------------------------------------------------
// API: POST /api/reset
// ------------------------------------------------------------------
app.post('/api/reset', (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId && sessions.has(sessionId)) {
    sessions.delete(sessionId);
    db.clearMessages(sessionId);
  }
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// API: POST /api/voice-mode
// ------------------------------------------------------------------
app.post('/api/voice-mode', (req, res) => {
  const { voiceMode } = req.body || {};
  voiceModeEnabled = !!voiceMode;
  db.setSetting('voice_mode', String(voiceModeEnabled));
  res.json({ ok: true, voiceMode: voiceModeEnabled });
});

// ------------------------------------------------------------------
// API: GET /api/history?sessionId=...
// ------------------------------------------------------------------
app.get('/api/history', (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId) return res.json([]);
  const msgs = db.getMessages(sessionId, 100);
  res.json(msgs.map((m) => ({ role: m.role, content: m.content })));
});

// ------------------------------------------------------------------
// API: Schedule CRUD
// ------------------------------------------------------------------
app.get('/api/schedule', (req, res) => {
  const { date, upcoming, days } = req.query;
  if (upcoming === '1' || upcoming === 'true') {
    return res.json(db.getUpcoming(parseInt(days, 10) || 7));
  }
  res.json(db.listSchedule(date || undefined));
});

app.post('/api/schedule', (req, res) => {
  const { title, subject, date, time, priority, note } = req.body || {};
  if (!title || !title.toString().trim()) {
    return res.status(400).json({ error: 'Schedule title is required.' });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required.' });
  }
  const saved = db.addSchedule({
    title: title.toString().trim(),
    subject: (subject || '').toString().trim(),
    date,
    time: time || '',
    priority: priority || 'normal',
    note: note || ''
  });
  createCalendarEvent(saved).then((eventId) => { if (eventId) db.setSetting('calendar_event_' + saved.id, eventId); }).catch((error) => console.warn('Calendar sync skipped:', error.message));
  res.json(saved);
});

app.put('/api/schedule/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const fields = req.body || {};
  const updated = db.updateSchedule(id, fields);
  if (!updated) return res.status(404).json({ error: 'Schedule item not found.' });
  res.json(updated);
});

app.delete('/api/schedule/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.deleteSchedule(id);
  res.json({ ok: true });
});

app.post('/api/schedule/bulk-delete', (req, res) => {
  const { ids } = req.body || {};
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => n > 0);
  if (!list.length) return res.status(400).json({ error: 'No schedule items selected.' });
  const deleted = db.deleteSchedules(list);
  res.json({ ok: true, deleted });
});

// ------------------------------------------------------------------
// API: Notes CRUD
// ------------------------------------------------------------------
app.get('/api/notes', (req, res) => {
  res.json(db.listNotes());
});

app.post('/api/notes', (req, res) => {
  const { title, content, subject, pinned } = req.body || {};
  if (!content || !content.toString().trim()) {
    return res.status(400).json({ error: 'Note content is required.' });
  }
  const saved = db.addNote({
    title: (title || '').toString().trim() || 'Note',
    content: content.toString().trim(),
    subject: (subject || '').toString().trim(),
    pinned: pinned ? 1 : 0
  });
  res.json(saved);
});

app.put('/api/notes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const updated = db.updateNote(id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Note not found.' });
  res.json(updated);
});

app.delete('/api/notes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.deleteNote(id);
  res.json({ ok: true });
});

app.post('/api/notes/bulk-delete', (req, res) => {
  const { ids } = req.body || {};
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => n > 0);
  if (!list.length) return res.status(400).json({ error: 'No notes selected.' });
  const deleted = db.deleteNotes(list);
  res.json({ ok: true, deleted });
});

// ------------------------------------------------------------------
// Start server
// ------------------------------------------------------------------
app.listen(PORT, () => {
  console.log('==============================================');
  console.log('  ⚡ Rash  (Gemini Flash Live Desk Companion)');
  console.log(`  ➜  Local:    http://localhost:${PORT}`);
  console.log(`  ➜  Model:    ${LIVE_MODEL}`);
  console.log(`  ➜  Gemini:   ${geminiApiKey ? 'Connected ✅' : 'Not set'}`);
  console.log('==============================================');
});
