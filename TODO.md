

## Steps
- [x] 1. `db.js` — Add `searchNotes(query)` function and export it.
- [x] 2. `server.js` — Add `buildDatabaseContext(text)` to fetch notes/schedule context for the AI.
- [x] 3. `server.js` — Inject DB context into `buildMessages()` and wire into `/api/chat`.
- [x] 4. `server.js` — Add bulk-delete endpoints: `POST /api/schedule/bulk-delete` & `POST /api/notes/bulk-delete`.
- [x] 5. `public/index.html` — Add Select buttons + bulk action bars for Schedule & Notes; add DB-query sample chips.
- [x] 6. `public/script.js` — Add selection mode, item checkboxes, and bulk-delete handlers.
- [x] 7. `public/style.css` — Add styles for Select button, bulk bar, and checkboxes.
- [x] 8. `db.js` — Add `deleteSchedules()` bulk-delete function.
- [x] 9. `README.md` — Update features list.
- [x] 10. `server.js` — Auto-failover: when a provider hits a 429 rate limit, switch to the other configured provider (GROQ ↔ Gemini) and retry automatically.
- [x] 11. All done! ✅
