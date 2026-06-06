package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const musicToolsContainerName = "music-tools"

var serverRootPath string
var dockerMountPoint string
var songsDBPath string

func configureMusicTools(rootPath string, mountPoint string, dbPath string) {
	serverRootPath = rootPath
	dockerMountPoint = mountPoint
	songsDBPath = dbPath
}

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
	// Get audio duration
	fingerprint, _, err := runFPCalc(parent, filePath)
	if err != nil {
		return "", fmt.Errorf("get audio duration: %w", err)
	}

	// If the song is shorter than 15 seconds, use the whole file
	duration := fingerprint.Duration
	if duration <= 15 {
		return runMusicToolsCommand(
			parent,
			filePath,
			"songrec",
			"audio-file-to-recognized-song",
		)
	}

	// Create fragment file path with `.frag` inserted before the original extension
	fragmentPath := fragmentFileName(filePath)

	// Extract random 15-second fragment using ffmpeg
	err = extractAudioFragment(parent, filePath, fragmentPath, duration)
	if err != nil {
		return "", fmt.Errorf("extract audio fragment: %w", err)
	}

	// Clean up fragment file after we're done
	defer os.Remove(fragmentPath)

	// Run songrec on the fragment
	return runMusicToolsCommand(
		parent,
		fragmentPath,
		"songrec",
		"audio-file-to-recognized-song",
	)
}

func fragmentFileName(filePath string) string {
	ext := filepath.Ext(filePath)
	if ext == "" {
		return filePath + ".frag"
	}
	return strings.TrimSuffix(filePath, ext) + ".frag" + ext
}

func extractAudioFragment(parent context.Context, inputPath string, outputPath string, totalDuration float64) error {
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	// Calculate random start time (allowing 15 seconds from that point)
	maxStartTime := totalDuration - 15
	startTime := rand.Float64() * maxStartTime

	// Convert paths to docker mount paths
	musicToolsInputPath, err := musicToolsPath(inputPath)
	if err != nil {
		return fmt.Errorf("resolve input path: %w", err)
	}
	musicToolsOutputPath, err := musicToolsPath(outputPath)
	if err != nil {
		return fmt.Errorf("resolve output path: %w", err)
	}

	cmd := exec.CommandContext(ctx, "docker", "exec", musicToolsContainerName, "ffmpeg",
		"-ss", fmt.Sprintf("%.2f", startTime),
		"-i", musicToolsInputPath,
		"-t", "15",
		"-c", "copy",
		"-y",
		musicToolsOutputPath,
	)

	Debugf("running command: %q", cmd.Args)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	if err != nil {
		stderrText := strings.TrimSpace(stderr.String())
		if stderrText != "" {
			Errorf("ffmpeg stderr: %s", stderrText)
		}
	}

	return err
}

type audioFingerprint struct {
	Duration    float64
	Fingerprint string
}

type songIndexData struct {
	Duration        float64 `json:"duration"`
	Fingerprint     string  `json:"fingerprint"`
	FingerprintHash string  `json:"fingerprint_hash"`
	Artist          string  `json:"artist"`
	TrackName       string  `json:"track_name"`
	Album           string  `json:"album"`
	Genre           string  `json:"genre"`
	Comment         string  `json:"comment"`
	Language        string  `json:"language"`
}

func runSongDupRecord(parent context.Context, filePath string) (songIndexData, string, error) {
	output, err := runMusicToolsCommand(
		parent,
		filePath,
		"songdup-record",
	)
	if err != nil {
		return songIndexData{}, output, err
	}

	var parsed songIndexData
	jsonOutput := strings.TrimSpace(output)
	for _, line := range strings.Split(jsonOutput, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "{") && strings.HasSuffix(line, "}") {
			jsonOutput = line
		}
	}
	if err := json.Unmarshal([]byte(jsonOutput), &parsed); err != nil {
		return songIndexData{}, output, fmt.Errorf("parse songdup-record output: %w", err)
	}
	if parsed.Fingerprint == "" {
		return songIndexData{}, output, fmt.Errorf("songdup-record returned an empty fingerprint")
	}

	return parsed, output, nil
}

type similarityMatch struct {
	Path       string  `json:"path"`
	FileName   string  `json:"file_name"`
	Duration   float64 `json:"duration"`
	Similarity float64 `json:"similarity"`
}

type similarityResult struct {
	Matches []similarityMatch `json:"matches"`
}

func runSongDupSimilarity(parent context.Context, filePath string, limit int, minSimilarity float64) ([]similarityMatch, string, error) {
	dbPath, err := musicToolsPath(songsDBPath)
	if err != nil {
		return nil, "", fmt.Errorf("resolve songs db path: %w", err)
	}

	output, err := runMusicToolsCommand(
		parent,
		filePath,
		"songdup-similarity",
		"--db", dbPath,
		"--limit", strconv.Itoa(limit),
		"--min-similarity", strconv.FormatFloat(minSimilarity, 'f', -1, 64),
	)
	if err != nil {
		return nil, output, err
	}

	jsonOutput := strings.TrimSpace(output)
	for _, line := range strings.Split(jsonOutput, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "{") && strings.HasSuffix(line, "}") {
			jsonOutput = line
		}
	}

	var parsed similarityResult
	if err := json.Unmarshal([]byte(jsonOutput), &parsed); err != nil {
		return nil, output, fmt.Errorf("parse songdup-similarity output: %w", err)
	}

	return parsed.Matches, output, nil
}

func runFPCalc(parent context.Context, filePath string) (audioFingerprint, string, error) {
	output, err := runMusicToolsCommand(
		parent,
		filePath,
		"fpcalc",
		"-json",
	)
	if err != nil {
		return audioFingerprint{}, output, err
	}

	var parsed struct {
		Duration    float64 `json:"duration"`
		Fingerprint string  `json:"fingerprint"`
	}
	if err := json.Unmarshal([]byte(output), &parsed); err != nil {
		return audioFingerprint{}, output, fmt.Errorf("parse fpcalc output: %w", err)
	}
	if parsed.Fingerprint == "" {
		return audioFingerprint{}, output, fmt.Errorf("fpcalc returned an empty fingerprint")
	}

	return audioFingerprint{
		Duration:    parsed.Duration,
		Fingerprint: parsed.Fingerprint,
	}, output, nil
}

func applySelectedMetadataWithLyrics(parent context.Context, filePath string, selectedMetadata map[string]string, artworkPath string, lyricsPath string) (string, error) {
	args := []string{"--remove-all"}

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
	if comment := selectedMetadata["comment"]; comment != "" {
		args = append(args, "--comment", comment)
	}
	if language := selectedMetadata["language"]; language != "" {
		// Normalize language: first letter uppercase, rest lowercase
		normalizedLanguage := strings.ToLower(language)
		if len(normalizedLanguage) > 0 {
			normalizedLanguage = strings.ToUpper(normalizedLanguage[:1]) + normalizedLanguage[1:]
		}
		args = append(args, "--text-frame", "TLAN:"+normalizedLanguage)
	}
	if artworkPath != "" {
		musicToolsArtworkPath, err := musicToolsPath(artworkPath)
		if err != nil {
			return "", fmt.Errorf("resolve artwork path: %w", err)
		}
		args = append(args, "--add-image", musicToolsArtworkPath+":FRONT_COVER")
	}
	if lyricsPath != "" {
		musicToolsLyricsPath, err := musicToolsPath(lyricsPath)
		if err != nil {
			return "", fmt.Errorf("resolve lyrics path: %w", err)
		}
		args = append(args, "--add-lyrics", musicToolsLyricsPath)
	}

	args = append(args, "--encoding", "utf16")
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
	musicToolsFilePath, err := musicToolsPath(absolutePath)
	if err != nil {
		return "", err
	}

	commandArgs := []string{
		"exec",
		musicToolsContainerName,
		tool,
	}
	commandArgs = append(commandArgs, args...)
	commandArgs = append(commandArgs, musicToolsFilePath)

	cmd := exec.CommandContext(ctx, "docker", commandArgs...)
	Debugf("running command: %q", cmd.Args)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	if err != nil {
		stderrText := strings.TrimSpace(stderr.String())
		if stderrText != "" {
			Errorf("command stderr: %s", stderrText)
		}
	}

	return stdout.String() + stderr.String(), err
}

func musicToolsPath(path string) (string, error) {
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if serverRootPath == "" {
		return absolutePath, nil
	}

	absoluteRootPath, err := filepath.Abs(serverRootPath)
	if err != nil {
		return "", err
	}
	relativePath, err := filepath.Rel(absoluteRootPath, absolutePath)
	if err != nil {
		return "", err
	}
	if relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%s is outside root path %s", absolutePath, absoluteRootPath)
	}

	return filepath.ToSlash(filepath.Join(dockerMountPoint, relativePath)), nil
}
