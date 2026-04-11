#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "=============================="
echo "   Reflexion — Setup"
echo "=============================="
echo ""
echo "This will install everything needed to run Reflexion."
echo "It only needs to be run once."
echo ""
read -p "Press Enter to begin..."
echo ""

# ── Homebrew ──────────────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
    echo "Installing Homebrew (you may be asked for your Mac password)..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add Homebrew to PATH for Apple Silicon Macs
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo "✓ Homebrew installed"
else
    echo "✓ Homebrew already installed"
fi
echo ""

# ── Node.js ───────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    echo "Installing Node.js..."
    brew install node
    echo "✓ Node.js installed"
else
    echo "✓ Node.js already installed"
fi
echo ""

# ── Python 3 ──────────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "Installing Python 3..."
    brew install python3
    echo "✓ Python 3 installed"
else
    echo "✓ Python 3 already installed"
fi
echo ""

# ── Node packages ─────────────────────────────────────────────────────────────
echo "Installing Node.js packages..."
npm install
echo "✓ Node.js packages installed"
echo ""

# ── Python packages ───────────────────────────────────────────────────────────
echo "Installing Python packages (this may take a few minutes)..."
pip3 install -r requirements_audio.txt
echo "✓ Python packages installed"
echo ""

# ── .env file ─────────────────────────────────────────────────────────────────
echo "=============================="
echo "   OpenAI API Key"
echo "=============================="
echo ""
if [ -f ".env" ]; then
    echo "✓ .env file already exists — skipping"
else
    echo "Please enter your OpenAI API key."
    echo "It starts with 'sk-' and can be found at platform.openai.com"
    echo ""
    read -p "Paste your API key here: " api_key
    echo "OPENAI_API_KEY=$api_key" > .env
    echo "✓ .env file created"
fi
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
echo "=============================="
echo "   Setup Complete!"
echo "=============================="
echo ""
echo "You can now double-click start.command every time you want to run Reflexion."
echo ""
read -p "Press Enter to close..."
