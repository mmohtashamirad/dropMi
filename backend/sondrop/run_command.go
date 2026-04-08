package main

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"time"
)

const musicToolsImage = "music-tools"

func runEyeD3(parent context.Context, filePath string) (string, error) {
	return runMusicToolsCommand(
		parent,
		filePath,
		"eyeD3",
		"--plugin",
		"json",
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

func applySelectedMetadata(parent context.Context, filePath string, selectedMetadata map[string]string, artworkPath string) (string, error) {
	return applySelectedMetadataWithLyrics(parent, filePath, selectedMetadata, artworkPath, "")
}

func applySelectedMetadataWithLyrics(parent context.Context, filePath string, selectedMetadata map[string]string, artworkPath string, lyricsPath string) (string, error) {
	var args []string

	if artist := selectedMetadata["artist"]; artist != "" {
		args = append(args, "-a", artist, "-b", artist)
	}
	if album := selectedMetadata["album"]; album != "" {
		args = append(args, "-A", album)
	}
	if title := selectedMetadata["track_name"]; title != "" {
		args = append(args, "-t", title)
	}
	if genre := selectedMetadata["genre"]; genre != "" {
		args = append(args, "-G", genre)
	}
	if artworkPath != "" {
		args = append(args, "--add-image", "/songs/"+filepath.Base(artworkPath)+":FRONT_COVER")
	}
	if lyricsPath != "" {
		args = append(args, "--add-lyrics", "/songs/"+filepath.Base(lyricsPath))
	}

	args = append(args, "--preserve-file-times")

	return runMusicToolsCommand(
		parent,
		filePath,
		"eyeD3",
		args...,
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
