#!/bin/bash

# Build local TUI binary for testing
# This script builds the Go TUI binary and caches it for use with bun run dev

set -e

echo "🔨 Building local TUI binary..."

# Build the Go TUI binary
cd packages/tui
echo "📦 Building Go TUI binary..."
go build -o opencode-tui cmd/opencode/main.go

# Make it executable
chmod +x opencode-tui

echo "✅ TUI binary built: packages/tui/opencode-tui"

# Get the cache directory for opencode
CACHE_DIR="$HOME/.cache/opencode"
mkdir -p "$CACHE_DIR/tui"

# Copy the binary to cache for bun run dev to use
cp opencode-tui "$CACHE_DIR/tui/opencode-$(go env GOOS)-$(go env GOARCH)"

echo "📁 Binary cached to: $CACHE_DIR/tui/"
echo "🎯 Ready for testing!"
echo ""
echo "Usage:"
echo "  ./packages/tui/opencode-tui          # Run TUI directly"
echo "  bun run dev                        # Run via TypeScript CLI (uses go run in dev)"
echo "  ./build-local.sh                   # Rebuild after changes"

bun run dev
