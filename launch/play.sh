#!/usr/bin/env bash
# VOIDSTRIKE — Local Play Launcher (macOS / Linux)
# Double-click or run: ./launch/play.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PORT="${VOIDSTRIKE_PORT:-3000}"
URL="http://localhost:$PORT"

cd "$PROJECT_DIR"

# ============================================
# Colors
# ============================================
RED='\033[0;31m'
GREEN='\033[0;32m'
PURPLE='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${PURPLE}${BOLD}"
echo "  ╔═══════════════════════════════════╗"
echo "  ║         V O I D S T R I K E       ║"
echo "  ║       Local Play Launcher         ║"
echo "  ╚═══════════════════════════════════╝"
echo -e "${NC}"

# ============================================
# Check Node.js
# ============================================
if ! command -v node &>/dev/null; then
  echo -e "${RED}Node.js not found. Install it from https://nodejs.org${NC}"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}Node.js 18+ required (found $(node -v))${NC}"
  exit 1
fi

# ============================================
# Install dependencies if needed
# ============================================
if [ ! -d "node_modules" ]; then
  echo -e "${PURPLE}Installing dependencies...${NC}"
  npm install
  echo ""
fi

# ============================================
# Build or Dev mode
# ============================================
MODE="${1:-dev}"

if [ "$MODE" = "build" ] || [ "$MODE" = "prod" ]; then
  echo -e "${PURPLE}Building for production...${NC}"
  npm run build
  echo ""
  echo -e "${GREEN}Starting production server on port $PORT...${NC}"
  # Start server in background
  npx next start -p "$PORT" &
  SERVER_PID=$!
else
  echo -e "${GREEN}Starting dev server on port $PORT...${NC}"
  # Start dev server in background
  npx next dev -p "$PORT" &
  SERVER_PID=$!
fi

# ============================================
# Wait for server to be ready
# ============================================
echo -n "Waiting for server"
RETRIES=0
MAX_RETRIES=60
while ! curl -s "$URL" >/dev/null 2>&1; do
  echo -n "."
  sleep 1
  RETRIES=$((RETRIES + 1))
  if [ "$RETRIES" -ge "$MAX_RETRIES" ]; then
    echo ""
    echo -e "${RED}Server failed to start after ${MAX_RETRIES}s${NC}"
    kill "$SERVER_PID" 2>/dev/null
    exit 1
  fi
done
echo ""
echo -e "${GREEN}Server ready!${NC}"
echo ""

# ============================================
# Open browser in app mode
# ============================================
open_app_mode() {
  local url="$1"

  # Try Chrome first (app mode for native-feeling window)
  if command -v google-chrome &>/dev/null; then
    google-chrome --app="$url" --start-maximized 2>/dev/null &
    return 0
  fi
  if command -v google-chrome-stable &>/dev/null; then
    google-chrome-stable --app="$url" --start-maximized 2>/dev/null &
    return 0
  fi
  if command -v chromium &>/dev/null; then
    chromium --app="$url" --start-maximized 2>/dev/null &
    return 0
  fi
  if command -v chromium-browser &>/dev/null; then
    chromium-browser --app="$url" --start-maximized 2>/dev/null &
    return 0
  fi

  # macOS: try Chrome, then Edge, then default browser
  if [ "$(uname)" = "Darwin" ]; then
    if [ -d "/Applications/Google Chrome.app" ]; then
      open -a "Google Chrome" --args --app="$url" --start-maximized 2>/dev/null
      return 0
    fi
    if [ -d "/Applications/Microsoft Edge.app" ]; then
      open -a "Microsoft Edge" --args --app="$url" --start-maximized 2>/dev/null
      return 0
    fi
    # Fallback to default browser
    open "$url"
    return 0
  fi

  # Try Edge on Linux
  if command -v microsoft-edge &>/dev/null; then
    microsoft-edge --app="$url" --start-maximized 2>/dev/null &
    return 0
  fi

  # Fallback: xdg-open
  if command -v xdg-open &>/dev/null; then
    xdg-open "$url" 2>/dev/null &
    return 0
  fi

  echo -e "${PURPLE}Open manually: $url${NC}"
  return 1
}

echo -e "${PURPLE}Launching VOIDSTRIKE...${NC}"
open_app_mode "$URL"

echo ""
echo -e "${BOLD}Game running at: ${PURPLE}$URL${NC}"
echo -e "Press ${BOLD}Ctrl+C${NC} to stop the server."
echo ""

# ============================================
# Cleanup on exit
# ============================================
trap "echo ''; echo 'Shutting down...'; kill $SERVER_PID 2>/dev/null; exit 0" INT TERM
wait "$SERVER_PID"
