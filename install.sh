#!/usr/bash

set -e

echo "🔧 CORTEX Installer"
echo "================"
echo

echo "This script will help you install and configure CORTEX."
echo

# Check for Bun
if ! command -v bun >/dev/null 2>&1; then
  echo "❌ Bun is not installed."
  echo "   Visit https://bun.sh to install Bun."
  echo
  exit 1
fi

echo "✅ Bun detected: $(bun --version)"
echo

# Install CORTEX
mkdir -p "$HOME/bin"
echo "📥 Installing CORTEX..."

cat > "$HOME/bin/cortex" <<'EOF'
#!/usr/bin/env bash

# CORTEX CLI wrapper

COMMAND="$1"
shift

case "$COMMAND" in
  "init")
    echo "Initializing CORTEX config..."
    if [ -f "cortex.json" ]; then
      echo "❌ cortex.json already exists. Use 'cortex setup' instead."
      exit 1
    fi
    cp "$(dirname "$0")/../cortex.json.example" cortex.json
    echo "✅ Created cortex.json — edit it to configure."
    echo "   Run 'bun run dev' to start the shell."
    ;;
  "setup")
    echo "Opening CORTEX configuration..."
    if [ ! -f "cortex.json" ]; then
      echo "❌ cortex.json not found. Run 'cortex init' first."
      exit 1
    fi
    # Open with system editor
    if command -v code >/dev/null 2>&1; then
      code cortex.json
    elif command -v vim >/dev/null 2>&1; then
      vim cortex.json
    elif command -v nano >/dev/null 2>&1; then
      nano cortex.json
    else
      echo "Please edit cortex.json manually."
    fi
    ;;
  "dev")
    echo "Starting CORTEX shell..."
    "$HOME/.local/bin/bun" run shell/repl.ts "$@"
    ;;
  "web")
    echo "Starting CORTEX dashboard..."
    "$HOME/.local/bin/bun" run shell/web.ts "$@"
    ;;
  "daemon")
    echo "Starting CORTEX daemon..."
    "$HOME/.local/bin/bun" run shell/daemon.ts "$@"
    ;;
  "voice")
    echo "Starting CORTEX voice assistant..."
    "$HOME/.local/bin/bun" run shell/voice.ts "$@"
    ;;
  *)
    echo "CORTEX - Consciousness Layer for CLI AI Agents"
    echo
    echo "Usage: cortex <command> [options]"
    echo
    echo "Commands:"
    echo "  init     Initialize a new CORTEX config (cortex.json)"
    echo "  setup    Edit the existing CORTEX config"
    echo "  dev      Start the interactive shell (REPL)"
    echo "  web      Start the web dashboard"
    echo "  daemon   Start as a background daemon"
    echo "  voice    Start voice assistant mode"
    echo
    echo "For more information, visit: https://github.com/Adarsh1Y/cortex"
    ;;
esac
EOF

chmod +x "$HOME/bin/cortex"

echo "✅ CORTEX CLI installed at ~/bin/cortex"
echo

# Create .bashrc source
cat >> "$HOME/.bashrc" <<'EOF'

# CORTEX CLI alias
if command -v cortex >/dev/null 2>&1; then
  alias cortex="cortex"
fi
EOF

echo "✅ Added cortex to PATH in ~/.bashrc"
echo

echo "🎉 Installation complete!"
echo

echo "Next steps:"
echo "  1. Run 'cortex init' to create your CORTEX config"
echo "  2. Edit cortex.json with your preferences"
echo "  3. Run 'cortex dev' to start the shell"
echo

echo "For detailed setup instructions, visit the documentation."
