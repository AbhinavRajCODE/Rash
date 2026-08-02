#!/usr/bin/env bash
# =============================================================
#  Rash — Linux / Raspberry Pi startup script
#  Usage:  ./start-linux.sh    (from the project folder)
# =============================================================
set -e

cd "$(dirname "$0")"

echo "=============================================="
echo "  ⚡ Rash — AI Study Companion — Starting..."
echo "=============================================="
echo

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies (this can take a while on a Pi Zero 2 W)..."
  npm install
  echo
fi

# Use the .env file if present
if [ -f ".env" ]; then
  echo "✓ Found .env — API keys will be loaded."
else
  echo "⚠️  No .env found. Copy .env.example to .env and add your GROQ/Gemini keys."
fi

echo
echo "Starting Rash at http://localhost:${PORT:-3000}"
echo "Access it from any device on your network via http://<raspberry-pi-ip>:${PORT:-3000}"
echo "Press Ctrl+C to stop."
echo

exec npm start

