# ⚡ Rash — AI Study Companion for Class 10 Students

A full-stack **AI companion** that runs on a **Raspberry Pi Zero 2 W** (or any PC) and is accessed from any small device on your network. It helps Class 10 CBSE students with:

| Subject | Coverage |
|---------|----------|
| 🔬 **Science** | Physics, Chemistry, Biology (NCERT, Ch 1–13) |
| 📐 **Maths** | All NCERT chapters (Algebra, Trigonometry, Statistics, etc.) |
| ✍️ **English** | First Flight, Footprints Without Feet, grammar & writing |
| 🇮🇳 **Hindi** | Kshitij, Kritika, Sparsh, Sanchayan |
| 🌏 **SST** | History, Geography, Civics, Economics |
| 💻 **IT (402)** | DBMS, HTML/CSS, Digital Documentation |
| 🛒 **Retail (401)** | Store operations, billing, customer service, inventory |
| 🤖 **AI (417)** | AI concepts, Python, Data Science basics |

## ✨ Features

- 🤖 **AI tutor** — powered by **free** GROQ + Gemini (no paid programs)
- 🎨 **Dark / Light theme** — sleek modern UI with a one-tap theme toggle (saved per browser)
- 🗄️ **Persistent database** — SQLite (`node:sqlite`, zero native deps) stores chat history, schedule & notes. Survives restarts.
- 🔊 **Voice module** (free, built into your browser):
  - 🎤 **Speak your doubt** (Speech-to-Text, mic button)
  - 🔊 **Listen to answers** (Text-to-Speech, per-answer "Listen" button)
  - 🗣 **Voice Mode toggle** — gives short 1–3 sentence spoken answers instead of long explanations
- 📅 **Schedule & tasks** — add, edit, complete, delete; filters for Today / Upcoming 7 days / All
  - **AI-driven**: say *"Remind me to revise Physics at 5 pm tomorrow"* → it auto-saves to your schedule
  - 🔔 **Reminder notifications** (toast + spoken, when voice mode is on)
  - ✅ **Multi-select bulk delete** — tap "Select" to choose multiple items and delete them all at once
- 📝 **Notes** — save important data (formulas, dates, key points) with subject tags
  - **AI-driven**: say *"Note this: Newton's 2nd law is F = ma"* → auto-saved
  - ✅ **Multi-select bulk delete** — tap "Select" to choose multiple notes and delete them in one go
- 🗄️ **AI database retrieval** — ask the AI about your saved data: *"What's in my saved notes?"* or *"What's on my schedule today?"* — the AI reads from the database and summarizes the results
- 💬 **Session memory** — follow-up questions work naturally, history persists across restarts
- 📱 **Mobile-first UI** — tabs for Chat / Schedule / Notes; works great on small phones

## 🚀 Setup

### Option A — Raspberry Pi Zero 2 W (recommended for "desktop companion")

1. **Copy the project to the Pi** (e.g. `/home/pi/student-ai-chatbot`).
2. **Install Node.js 22+** (for built-in SQLite):
   ```bash
   # On Raspberry Pi OS (bookworm), Node 22+ is available via NodeSource:
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   node --version   # should be v22.x or newer
   ```
3. **Configure your API keys**:
   ```bash
   cp .env.example .env
   nano .env    # set GROQ_API_KEY and/or GEMINI_API_KEY
   ```
4. **Install deps & run**:
   ```bash
   npm install
   ./start-linux.sh
   ```
5. **Auto-start on boot** (optional but recommended):
   ```bash
   sudo cp deploy/companion.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable companion
   sudo systemctl start companion
   ```
6. **Access it from your small device**: open `http://<raspberry-pi-ip>:3000` in the browser on your phone/tablet/laptop.

> ⚠️ **Voice input note:** The microphone (Speech-to-Text) requires a **secure context** (`https://` or `localhost`). For LAN voice input, either use a device that treats the Pi's IP as trusted, or set up a reverse proxy with HTTPS (e.g. Caddy or nginx + self-signed cert). **Text-to-Speech (listening to answers) works over plain HTTP.**

### Option B — Windows PC (one-click)
Double-click **`start.bat`** — it installs dependencies (if needed) and starts the server automatically. Open http://localhost:3000.

### Option C — Manual (any OS)
```bash
npm install
npm start
```

## 🎤 Using the Voice Module

1. Open the app in **Chrome** or **Edge** (best voice support).
2. Click the **🎤 mic** button next to the input box and speak your doubt or command.
3. Click **🔊 Listen** under any answer to hear it read aloud.
4. Toggle **Voice Mode** (header button) to make the AI reply with short, speakable sentences — perfect for quick spoken answers.

## 🌗 Dark / Light Theme

- Tap the **moon / sun** button in the top-right header to switch themes instantly.
- Your choice is remembered for that browser (via `localStorage`), so it stays even after you close and reopen the app.

## 🗣️ AI-Driven Commands (try these)

- *"Remind me to revise Physics at 5 pm tomorrow"* → saves to Schedule
- *"Add Maths homework due Friday"* → saves to Schedule
- *"Note this: the quadratic formula is x = (-b ± √(b²-4ac)) / 2a"* → saves to Notes
- *"What is the difference between mixtures and compounds?"* → normal study answer
- *"Explain photosynthesis in 2 lines"* (voice mode) → short spoken answer
- *"What's in my saved notes?"* → AI retrieves from the database and summarizes your notes
- *"What's on my schedule today?"* → AI reads your schedule from the database

## 📁 Project Structure

```
student-ai-chatbot/
├── server.js          → Express + AI providers + DB + schedule/notes/history/action APIs
├── db.js              → SQLite (node:sqlite) storage with JSON fallback
├── data/              → companion.db (auto-created)
├── package.json
├── .env.example       → Free API key template
├── .env               → Your real keys (git-ignored)
├── start.bat          → Windows one-click start
├── start-linux.sh     → Linux / Pi startup script
├── deploy/
│   └── companion.service → systemd auto-start for Raspberry Pi
├── README.md
└── public/
    ├── index.html     → Tabs UI (Chat / Schedule / Notes)
    ├── style.css      → Mobile-first styling + dark/light theme
    └── script.js      → Frontend logic + voice module + theme toggle
```

## ⚙️ Configuration

| Env Variable | Default | Description |
|---|---|---|
| `AI_PROVIDER` | `groq` | Free provider to use: `groq` or `gemini` |
| `GROQ_API_KEY` | — | Free GROQ key (get at https://console.groq.com) |
| `GEMINI_API_KEY` | — | Free Google Gemini key (get at https://aistudio.google.com) |
| `AI_MODEL` | provider default | Override model |
| `PORT` | `3000` | Server port |

## 🛠️ Tech Stack
- **Backend**: Node.js, Express, built-in SQLite (`node:sqlite`), GROQ SDK, Google Generative AI SDK
- **Frontend**: Vanilla HTML/CSS/JS (no build step), Web Speech API for voice
- **Deployment**: systemd on Raspberry Pi OS; zero native dependencies → works on ARM

---
Made with ❤️ for students. 100% free AI — no paid programs.

