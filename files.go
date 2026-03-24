package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
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
