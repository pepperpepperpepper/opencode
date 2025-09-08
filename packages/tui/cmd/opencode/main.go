package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"fmt"
	tea "github.com/charmbracelet/bubbletea/v2"
	flag "github.com/spf13/pflag"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode-sdk-go/option"
	"github.com/sst/opencode/internal/api"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/clipboard"
	"github.com/sst/opencode/internal/tui"
	"path/filepath"
)

var Version = "dev"

func main() {
	version := Version
	if version != "dev" && !strings.HasPrefix(Version, "v") {
		version = "v" + Version
	}
	var model *string = flag.String("model", "", "model to begin with")
	var prompt *string = flag.String("prompt", "", "prompt to begin with")
	var mode *string = flag.String("mode", "", "mode to begin with")
	flag.Parse()

	url := os.Getenv("OPENCODE_SERVER")

	appInfoStr := os.Getenv("OPENCODE_APP_INFO")
	var appInfo opencode.App
	err := json.Unmarshal([]byte(appInfoStr), &appInfo)
	if err != nil {
		slog.Error("Failed to unmarshal app info", "error", err)
		os.Exit(1)
	}

	modesStr := os.Getenv("OPENCODE_MODES")
	var modes []opencode.Mode
	err = json.Unmarshal([]byte(modesStr), &modes)
	if err != nil {
		slog.Error("Failed to unmarshal modes", "error", err)
		os.Exit(1)
	}

	stat, err := os.Stdin.Stat()
	if err != nil {
		slog.Error("Failed to stat stdin", "error", err)
		os.Exit(1)
	}

	// Check if there's data piped to stdin
	if (stat.Mode() & os.ModeCharDevice) == 0 {
		stdin, err := io.ReadAll(os.Stdin)
		if err != nil {
			slog.Error("Failed to read stdin", "error", err)
			os.Exit(1)
		}
		stdinContent := strings.TrimSpace(string(stdin))
		if stdinContent != "" {
			if prompt == nil || *prompt == "" {
				prompt = &stdinContent
			} else {
				combined := *prompt + "\n" + stdinContent
				prompt = &combined
			}
		}
	}

	httpClient := opencode.NewClient(
		option.WithBaseURL(url),
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// Set up file logging to tui.log
	homeDir, homeErr := os.UserHomeDir()
	if homeErr != nil {
		fmt.Fprintf(os.Stderr, "Failed to get user home: %v\n", homeErr)
		os.Exit(1)
	}
	logDir := filepath.Join(homeDir, ".local", "share", "opencode-unchained", "log")
	if mkdirErr := os.MkdirAll(logDir, 0755); mkdirErr != nil {
		fmt.Fprintf(os.Stderr, "Failed to create log dir: %v\n", mkdirErr)
		os.Exit(1)
	}
	logPath := filepath.Join(logDir, "tui.log")
	logFile, openErr := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if openErr != nil {
		fmt.Fprintf(os.Stderr, "Failed to open log file: %v\n", openErr)
		os.Exit(1)
	}
	// Redirect stderr to log file
	os.Stderr = logFile
	defer logFile.Close()
	// Set up slog to use the same file
	handler := slog.NewTextHandler(logFile, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})
	slog.SetDefault(slog.New(handler))
	slog.Debug("TUI launched", "app", appInfoStr, "modes", modesStr)

	go func() {
		err = clipboard.Init()
		if err != nil {
			slog.Error("Failed to initialize clipboard", "error", err)
		}
	}()

	// Create main context for the application
	app_, err := app.New(ctx, version, appInfo, modes, httpClient, model, prompt, mode)
	if err != nil {
		panic(err)
	}

	// Enable Kitty keyboard protocol for enhanced key detection (e.g., distinguishing ctrl+c from ctrl+shift+c)
	// This enables progressive enhancement with disambiguate escape codes and report event types
	fmt.Printf("\x1b[=1s") // Enable Kitty keyboard protocol
	fmt.Printf("\x1b[=2s") // Enable disambiguate escape codes
	fmt.Printf("\x1b[=4s") // Enable report event types

	program := tea.NewProgram(
		tui.NewModel(app_),
		tea.WithAltScreen(),
		tea.WithMouseCellMotion(),
	)

	// Set up signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		stream := httpClient.Event.ListStreaming(ctx)
		for stream.Next() {
			evt := stream.Current().AsUnion()
			if _, ok := evt.(opencode.EventListResponseEventStorageWrite); ok {
				continue
			}
			program.Send(evt)
		}
		if err := stream.Err(); err != nil {
			slog.Error("Error streaming events", "error", err)
			program.Send(err)
		}
	}()

	go api.Start(ctx, program, httpClient)

	// Handle signals in a separate goroutine
	go func() {
		sig := <-sigChan
		slog.Info("Received signal, shutting down gracefully", "signal", sig)
		program.Quit()
	}()

	// Run the TUI
	result, err := program.Run()
	if err != nil {
		slog.Error("TUI error", "error", err)
	}

	// Disable Kitty keyboard protocol to restore terminal to original state
	fmt.Printf("\x1b[=0s") // Disable Kitty keyboard protocol

	slog.Info("TUI exited", "result", result)
}
