package util

import (
	"regexp"
	"strings"

	"github.com/charmbracelet/lipgloss/v2"
)

// PreventHyphenBreaks replaces regular hyphens with non-breaking hyphens to prevent
// sparse word breaks in hyphenated terms like "claude-code-action".
// This improves readability by keeping hyphenated words together.
// Only preserves hyphens within words, not markdown syntax like bullet points.
func PreventHyphenBreaks(text string) string {
	// Use regex to match hyphens that are between word characters
	// This preserves hyphens in words like "claude-code-action" but not in "- [ ]"
	re := regexp.MustCompile(`(\w)-(\w)`)
	return re.ReplaceAllString(text, "$1\u2011$2")
}

// RestoreHyphens converts non-breaking hyphens back to regular hyphens.
// This should be called after text processing (like word wrapping) is complete.
func RestoreHyphens(text string) string {
	return strings.ReplaceAll(text, "\u2011", "-")
}

// ProcessTextWithHyphens applies hyphen preservation to text during processing.
// It wraps the provided processFunc with hyphen handling.
func ProcessTextWithHyphens(text string, processFunc func(string) string) string {
	preserved := PreventHyphenBreaks(text)
	processed := processFunc(preserved)
	return RestoreHyphens(processed)
}

// GetMessageContainerFrame calculates the actual horizontal frame size
// (padding + borders) for message containers based on current theme.
func GetMessageContainerFrame() int {
	style := lipgloss.NewStyle().
		BorderStyle(lipgloss.ThickBorder()).
		BorderLeft(true).
		BorderRight(true).
		PaddingLeft(2).
		PaddingRight(2)
	return style.GetHorizontalFrameSize()
}

// GetMarkdownContainerFrame calculates the actual horizontal frame size
// for markdown containers based on current theme.
func GetMarkdownContainerFrame() int {
	// Markdown containers use the same styling as message containers
	return GetMessageContainerFrame()
}

// ExtractURLs finds all URLs in a text string and returns them with their positions
func ExtractURLs(text string) []struct {
	URL   string
	Start int
	End   int
} {
	// URL regex pattern
	urlRegex := regexp.MustCompile(`https?://[^\s]+`)
	matches := urlRegex.FindAllStringIndex(text, -1)

	var urls []struct {
		URL   string
		Start int
		End   int
	}

	for _, match := range matches {
		urls = append(urls, struct {
			URL   string
			Start int
			End   int
		}{
			URL:   text[match[0]:match[1]],
			Start: match[0],
			End:   match[1],
		})
	}

	return urls
}
