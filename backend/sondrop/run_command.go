package main

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const musicToolsImage = "music-tools"

func runEyeD3(parent context.Context, filePath string) (string, error) {
	return runMusicToolsCommand(
		parent,
		filePath,
		"eyeD3",
		"--no-color",
		"--no-config",
	)
}

func runSongRec(parent context.Context, filePath string) (string, error) {
	return runMusicToolsCommand(
		parent,
		filePath,
		"songrec",
		"audio-file-to-recognized-song",
	)
}

func runMusicToolsCommand(parent context.Context, filePath string, tool string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	absolutePath, err := filepath.Abs(filePath)
	if err != nil {
		return "", fmt.Errorf("resolve upload path: %w", err)
	}

	songsDir := filepath.Dir(absolutePath)
	songPath := "/songs/" + filepath.Base(absolutePath)

	commandArgs := []string{
		"run",
		"--rm",
		"-v",
		fmt.Sprintf("%s:/songs", songsDir),
		musicToolsImage,
		tool,
	}
	commandArgs = append(commandArgs, args...)
	commandArgs = append(commandArgs, songPath)

	cmd := exec.CommandContext(ctx, "docker", commandArgs...)
	Debugf("running command: %q", cmd.Args)

	output, err := cmd.CombinedOutput()
	return string(output), err
}

func combineAnalysisOutput(eyeD3Output string, songrecOutput string) string {
	var sections []string

	sections = append(sections, formatAnalysisSection("eyeD3", eyeD3Output))
	sections = append(sections, formatAnalysisSection("songrec", songrecOutput))

	return strings.Join(sections, "\n\n")
}

func formatAnalysisSection(title string, output string) string {
	trimmedOutput := strings.TrimSpace(output)
	if trimmedOutput == "" {
		trimmedOutput = "No output returned."
	}

	return fmt.Sprintf("%s\n%s\n%s", title, strings.Repeat("=", len(title)), trimmedOutput)
}
