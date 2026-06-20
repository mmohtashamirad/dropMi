package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func createTempUploadFile(dir string, originalName string) (*os.File, string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, "", err
	}

	tempFile, err := os.CreateTemp(dir, "dropMi-*"+filepath.Ext(originalName))
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

func userPathPart(username string) string {
	userPart := strings.ToLower(sanitizePathPart(username))
	if userPart == "" {
		userPart = "unknown_user"
	}
	return userPart
}

func tempUserDir(rootDir string, username string) string {
	return filepath.Join(rootDir, userPathPart(username))
}

func tempUploadPath(rootDir string, username string, uploadID string) string {
	return filepath.Join(tempUserDir(rootDir, username), uploadID)
}

// findFileByName searches for a file named fileName anywhere beneath rootDir
// (at any depth) and returns its full path. Returns empty string if not found.
// A missing rootDir counts as "not found".
func findFileByName(rootDir string, fileName string) (string, error) {
	var foundPath string
	err := filepath.WalkDir(rootDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if d.Name() == fileName {
			foundPath = path
			return filepath.SkipAll
		}
		return nil
	})
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return foundPath, nil
}

func failedUploadPath(rootDir string, username string, fileName string) string {
	return filepath.Join(rootDir, userPathPart(username), fileName)
}

func copyFile(sourcePath string, destinationPath string) error {
	if err := os.MkdirAll(filepath.Dir(destinationPath), 0o755); err != nil {
		return err
	}

	src, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.Create(destinationPath)
	if err != nil {
		return err
	}

	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		os.Remove(destinationPath)
		return err
	}

	return dst.Close()
}

func metadataDrivenUploadPath(rootDir string, username string, selectedMetadata map[string]string, sourcePath string, fallbackName string) string {
	userPart := userPathPart(username)

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
	cmd := exec.Command("wget", "-O", destinationPath, url)
	if err := cmd.Run(); err != nil {
		os.Remove(destinationPath)
		return fmt.Errorf("download artwork with wget: %w", err)
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
		"'", "-",
	)

	value = replacer.Replace(value)
	value = strings.Join(strings.Fields(value), " ")
	value = strings.Trim(value, ". ")
	return value
}
