#!/bin/bash

echo "🔍 Starting OpenCode with FULL debug logging enabled"
echo "=================================================="
echo ""
echo "Debug logs will be written to:"
echo "  - Console output (for AI SDK patches)"
echo "  - ~/.local/share/opencode/log/session-debug.log"
echo "  - ~/.local/share/opencode/log/dev.log"
echo ""
echo "Environment variables being set:"
echo "  OPENCODE_DEBUG=true"
echo "  OPENCODE_DEBUG_SESSION=true"
echo "  OPENCODE_DEBUG_STREAM=true"
echo "  OPENCODE_DEBUG_TOOLS=true"
echo "  NODE_ENV=development"
echo "  DEBUG=* (enables all debug output from libraries)"
echo ""
echo "Press Ctrl+C to stop"
echo "=================================================="
echo ""

# Export all debug environment variables
export OPENCODE_DEBUG=true
export OPENCODE_DEBUG_SESSION=true
export OPENCODE_DEBUG_STREAM=true
export OPENCODE_DEBUG_TOOLS=true
export NODE_ENV=development
export DEBUG="*"

# Change to opencode directory
cd /home/pepper/.local/src/opencode

# Run opencode with all debug flags
exec bun run /home/pepper/.local/src/opencode/packages/opencode/src/index.ts --debug --debug-session --debug-stream --debug-tools "$@"