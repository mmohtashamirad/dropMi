package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func createTempUploadFile(dir string, originalName string) (*os.File, string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, "", err
	}

	tempFile, err := os.CreateTemp(dir, "sondrop-*"+filepath.Ext(originalName))
	if err != nil {
		return nil, "", err
	}

	return tempFile, tempFile.Name(), nil
}

func saveUploadedFile(dst *os.File, src io.Reader, tempPath string) error {
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		os.Remove(tempPath)
		return err
	}

	if err := dst.Close(); err != nil {
		os.Remove(tempPath)
		return err
	}

	return nil
}

func validateUploadID(uploadID string) (string, error) {
	if uploadID == "" || filepath.Base(uploadID) != uploadID {
		return "", errors.New("Invalid upload ID.")
	}

	return uploadID, nil
}

func tempUserDir(rootDir string, username string) string {
	userPart := sanitizePathPart(username)
	if userPart == "" {
		userPart = "unknown_user"
	}

	return filepath.Join(rootDir, userPart)
}

func tempUploadPath(rootDir string, username string, uploadID string) string {
	return filepath.Join(tempUserDir(rootDir, username), uploadID)
}

func finalUploadPath(dir string, uploadID string) string {
	return filepath.Join(dir, uploadID)
}

func metadataDrivenUploadPath(rootDir string, username string, selectedMetadata map[string]string, sourcePath string, fallbackName string) string {
	userPart := sanitizePathPart(username)
	if userPart == "" {
		userPart = "unknown_user"
	}

	artistPart := sanitizePathPart(selectedMetadata["artist"])
	if artistPart == "" {
		artistPart = "unknown_artist"
	}

	trackNamePart := sanitizePathPart(selectedMetadata["track_name"])
	fileBase := artistPart
	if trackNamePart != "" {
		fileBase = artistPart + " - " + trackNamePart
	}
	if fileBase == "" {
		fileBase = sanitizePathPart(fallbackName)
	}
	if fileBase == "" {
		fileBase = "unknown_track"
	}

	return filepath.Join(rootDir, userPart, artistPart, fileBase+filepath.Ext(sourcePath))
}

func artworkPathForAudio(audioPath string, imageExt string) string {
	baseName := strings.TrimSuffix(filepath.Base(audioPath), filepath.Ext(audioPath))
	return filepath.Join(filepath.Dir(audioPath), baseName+imageExt)
}

func lyricsPathForAudio(audioPath string) string {
	baseName := strings.TrimSuffix(filepath.Base(audioPath), filepath.Ext(audioPath))
	return filepath.Join(filepath.Dir(audioPath), baseName+".lyrics.txt")
}

func downloadArtwork(url string, destinationPath string) error {
	response, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("download artwork: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("download artwork: unexpected status %s", response.Status)
	}

	outputFile, err := os.Create(destinationPath)
	if err != nil {
		return fmt.Errorf("create artwork file: %w", err)
	}
	defer outputFile.Close()

	if _, err := io.Copy(outputFile, response.Body); err != nil {
		os.Remove(destinationPath)
		return fmt.Errorf("save artwork file: %w", err)
	}

	return nil
}

func detectArtworkExtension(url string, contentType string) string {
	trimmedExt := strings.ToLower(filepath.Ext(url))
	switch trimmedExt {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif":
		return normalizeArtworkExtension(trimmedExt)
	}

	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ".jpg"
	}
}

func normalizeArtworkExtension(extension string) string {
	if extension == ".jpeg" {
		return ".jpg"
	}

	return extension
}

func sanitizePathPart(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	replacer := strings.NewReplacer(
		"/", "-",
		"\\", "-",
		":", "-",
		"*", "",
		"?", "",
		"\"", "",
		"<", "",
		">", "",
		"|", "-",
	)

	value = replacer.Replace(value)
	value = strings.Join(strings.Fields(value), " ")
	value = strings.Trim(value, ". ")
	return value
}
