# How to Compile the OpenCode TUI

## Overview

The OpenCode TUI is a Go application that can be compiled into a standalone binary. This project uses a **Go workspace** to handle the multi-module structure, with a `go.work` file at the repository root.

## Prerequisites

- Go 1.24.0 or later
- Working Go environment

## Understanding the Repository Structure

This project uses a Go workspace with local module replacements:

```
/home/pepper/.local/src/opencode/
├── go.work                    ← Workspace configuration
└── packages/tui/
    ├── go.mod                ← Main module with local replacements
    ├── cmd/opencode/main.go  ← Main entry point
    ├── input/                ← Local replacement for github.com/charmbracelet/x/input
    │   └── go.mod
    └── sdk/                  ← Local replacement for github.com/sst/opencode-sdk-go
        └── go.mod
```

The `go.work` file contains:

```go
go 1.24.0

use ./packages/tui
```

The `go.mod` file contains these key lines:

```go
replace (
	github.com/charmbracelet/x/input => ./input
	github.com/sst/opencode-sdk-go => ./sdk
)
```

## Compilation Steps

### Important Note: Directory Navigation

When working with this repository, you may encounter issues with directory persistence. **Always use the `cd directory && command` pattern** to ensure you're executing commands in the correct directory:

```bash
# Good: This ensures you're in the right directory
cd packages/tui && go build -o opencode ./cmd/opencode

# Bad: This may not work as expected due to directory changes
cd packages/tui
go build -o opencode ./cmd/opencode
```

### Option 1: From the TUI Directory (Recommended)

#### 1. Build the Binary

```bash
cd packages/tui && go build -o opencode ./cmd/opencode
```

#### 2. Verify the Build

```bash
cd packages/tui && ls -la opencode
```

You should see output similar to:

```
-rwxr-xr-x 1 pepper pepper 26485103 Aug 12 21:04 opencode
```

#### 3. Test the Binary

```bash
cd packages/tui && ./opencode --help
```

Expected output:

```
Usage of ./opencode:
      --mode string     mode to begin with
      --model string    model to begin with
      --prompt string   prompt to begin with
```

### Option 2: From the Repository Root

#### 1. Build the Binary

```bash
cd /home/pepper/.local/src/opencode && go build -o opencode ./packages/tui/cmd/opencode
```

#### 2. Verify and Test

```bash
cd /home/pepper/.local/src/opencode && ls -la opencode
cd /home/pepper/.local/src/opencode && ./opencode --help
```

## How the Go Workspace Works

The repository structure has a `.git` directory at `/home/pepper/.local/src/opencode/` but the Go module is at `/home/pepper/.local/src/opencode/packages/tui/`. The `go.work` file at the repository root tells Go how to handle this structure:

1. **Workspace Definition**: The `go.work` file defines a workspace that includes the TUI module
2. **Module Resolution**: Go uses the workspace to resolve module paths correctly
3. **Local Replacements**: The `replace` directives in `go.mod` handle the local dependencies

## Common Issues and Solutions

### Issue: Directory Navigation Problems

**Problem**: Commands don't execute in the expected directory, causing path errors.

**Solution**: Always use the `cd directory && command` pattern to ensure proper directory context:

```bash
# Correct approach - ensures directory context
cd packages/tui && go build -o opencode ./cmd/opencode
cd packages/tui && ls -la opencode
cd packages/tui && ./opencode --help

# Incorrect approach - may fail due to directory changes
cd packages/tui
go build -o opencode ./cmd/opencode  # This might run in wrong directory
```

### Issue: "cannot find main module, but found .git/config"

**Problem**: Go detects a `.git` directory but can't find the workspace configuration.

**Solution**: Make sure the `go.work` file exists at the repository root:

```bash
# Check if go.work exists
cd /home/pepper/.local/src/opencode && ls -la go.work

# If it doesn't exist, create it:
cd /home/pepper/.local/src/opencode && cat > go.work << 'EOF'
go 1.24.0

use ./packages/tui
EOF
```

### Issue: Module path not found

**Problem**: Go can't find the local replacement modules.

**Solution**: Run `go mod tidy` to ensure all dependencies are properly resolved:

```bash
cd packages/tui && go mod tidy
```

### Issue: Build succeeds but no binary created

**Problem**: The build completed but no output file appears.

**Solution**: Make sure you're using the correct output path:

```bash
# This creates the binary in the current directory
cd packages/tui && go build -o opencode ./cmd/opencode

# NOT this (which would create it in cmd/opencode/)
cd packages/tui && go build ./cmd/opencode
```

### Issue: "stat ... directory not found"

**Problem**: The build command can't find the specified path.

**Solution**: Use the correct path relative to your current directory:

```bash
# From TUI directory:
cd packages/tui && go build -o opencode ./cmd/opencode

# From repository root:
cd /home/pepper/.local/src/opencode && go build -o opencode ./packages/tui/cmd/opencode
```

## Build Details

### Binary Information

- **Size**: ~26MB (includes all dependencies)
- **Architecture**: AMD64
- **OS**: Linux (cross-compilation possible)
- **CGO**: Disabled by default

### Dependencies

The build includes these key dependencies:

- charmbracelet/bubbletea/v2 (TUI framework)
- charmbracelet/lipgloss/v2 (styling)
- charmbracelet/glamour (markdown rendering)
- sst/opencode-sdk-go (API client)

## Development vs Production Builds

### Development Build

```bash
cd packages/tui && go build -o opencode ./cmd/opencode
```

### Production Build (with optimizations)

```bash
cd packages/tui && go build -ldflags="-s -w" -o opencode ./cmd/opencode
```

### Cross-compilation Example

```bash
# Build for macOS
cd packages/tui && GOOS=darwin GOARCH=amd64 go build -o opencode-darwin ./cmd/opencode

# Build for Windows
cd packages/tui && GOOS=windows GOARCH=amd64 go build -o opencode.exe ./cmd/opencode
```

## Running the Compiled Binary

```bash
./opencode --help
```

## Integration with Node.js CLI

The Node.js CLI (in `/packages/opencode`) handles TUI execution in two ways:

### Development Mode

Uses `go run` to execute the TUI source directly:

```bash
go run ./main.go
```

This is what happens when you run `bun run src/index.ts` in development.

### Production Mode

Uses pre-compiled embedded binaries that are bundled with the Node.js package.

## Important Notes

- **Workspace is required**: The `go.work` file at the repository root is essential for building
- **Local replacements**: The `replace` directives in `go.mod` handle the multi-module structure
- **Build location**: You can build from either the repository root or the TUI directory
- **Path awareness**: Use relative paths correctly based on your current directory

## Troubleshooting

### Checking Module Status

```bash
# Check all modules and replacements
go list -m all

# Verify module graph
go mod graph

# Clean up module cache
go clean -modcache
```

### Rebuilding Dependencies

If you encounter persistent issues:

```bash
# Clean and rebuild
cd packages/tui && rm go.sum
cd packages/tui && go mod tidy
cd packages/tui && go build -o opencode ./cmd/opencode
```

### Understanding Local Replacements

The `replace` directives in `go.mod` tell Go:

1. "When you see `github.com/charmbracelet/x/input`, use the local `./input` directory instead"
2. "When you see `github.com/sst/opencode-sdk-go`, use the local `./sdk` directory instead"

This allows development with local changes to these dependencies without publishing them.

### Workspace Configuration

The `go.work` file is the key to making this repository structure work:

```go
go 1.24.0

use ./packages/tui
```

This tells Go:

- "We're using Go workspaces"
- "The TUI module is located at `./packages/tui`"
- "Resolve all module paths relative to this workspace"

### Verifying Workspace Setup

To verify your workspace is configured correctly:

```bash
# From repository root
cd /home/pepper/.local/src/opencode && go work use ./packages/tui
cd /home/pepper/.local/src/opencode && go list -m all
```

This should show the TUI module and all its dependencies without errors.
