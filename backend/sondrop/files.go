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

func tempUploadPath(dir string, uploadID string) string {
	return filepath.Join(dir, uploadID)
}

func finalUploadPath(dir string, uploadID string) string {
	return filepath.Join(dir, uploadID)
}

func artworkPathForAudio(audioPath string, imageExt string) string {
	baseName := strings.TrimSuffix(filepath.Base(audioPath), filepath.Ext(audioPath))
	return filepath.Join(filepath.Dir(audioPath), baseName+imageExt)
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
