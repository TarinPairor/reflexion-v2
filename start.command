#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "=============================="
echo "   Reflexion — Starting"
echo "=============================="
echo ""

# ── Check setup has been run ──────────────────────────────────────────────────
if [ ! -f ".env" ]; then
    echo "ERROR: Setup has not been completed."
    echo "Please double-click setup.command first."
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

# ── Stop both servers cleanly when Terminal is closed or Ctrl+C is pressed ────
cleanup() {
    echo ""
    echo "Stopping Reflexion servers..."
    kill $NODE_PID $PYTHON_PID 2>/dev/null
    echo "Stopped. You can close this window."
    exit 0
}
trap cleanup INT TERM

# ── Start servers ─────────────────────────────────────────────────────────────
echo "Starting dashboard server..."
node server.js &
NODE_PID=$!

echo "Starting ML analysis server..."
python3 audio_server.py &
PYTHON_PID=$!

# ── Wait a moment then open the dashboard ─────────────────────────────────────
sleep 3
echo ""
echo "=============================="
echo "   Reflexion is running!"
echo "=============================="
echo ""
echo "Dashboard: http://localhost:3000/dashboard"
echo ""
open http://localhost:3000/dashboard

echo "Servers are running in the background."
echo "Keep this window open while using Reflexion."
echo "Press Ctrl+C or close this window to stop."
echo ""

# ── Keep running until stopped ────────────────────────────────────────────────
wait $NODE_PID $PYTHON_PID
