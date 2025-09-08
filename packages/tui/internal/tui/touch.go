package tui

import (
	"github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
)

// TouchEvent represents a touch gesture
type TouchEvent struct {
	Type  TouchType
	X, Y  int
	Delta int    // For swipe gestures
	Pane  string // "editor" or "messages"
}

type TouchType int

const (
	TouchDown TouchType = iota
	TouchUp
	TouchMove
	TouchSwipeUp
	TouchSwipeDown
)

// TouchMessage wraps TouchEvent for Bubble Tea
type TouchMessage struct {
	TouchEvent
}

// Implement the tea.Msg interface
func (TouchMessage) Msg() {}

// Enhanced touch handling could be added here
// This is a placeholder for future touch enhancements
func (m *Model) handleTouch(msg TouchMessage) tea.Cmd {
	// For now, we'll rely on the existing mouse wheel handling
	// But we could add more sophisticated touch gesture handling here
	return nil
}

// TouchIndicator returns a visual indicator for touch feedback
func (m *Model) TouchIndicator() string {
	if m.focusedPane == "messages" {
		return lipgloss.NewStyle().Foreground(lipgloss.Color("69")).Render("👆")
	}
	return ""
}
