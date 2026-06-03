package main

import (
	"os"
	"path/filepath"
	"time"
)

const (
	uploadTmpCleanupInterval = 2 * time.Hour
	uploadTmpMaxAge          = 24 * time.Hour
)

func startUploadTmpCleaner(path string, events *eventStore) {
	go func() {
		ticker := time.NewTicker(uploadTmpCleanupInterval)
		defer ticker.Stop()

		for range ticker.C {
			if err := cleanUploadTmpFiles(path, events); err != nil {
				Errorf("clean upload temp dir: %v", err)
			}
		}
	}()
}

func cleanUploadTmpFiles(path string, events *eventStore) error {
	return cleanOldUploadTmpFiles(path, time.Now().Add(-uploadTmpMaxAge), events)
}

func cleanOldUploadTmpFiles(rootPath string, cutoff time.Time, events *eventStore) error {
	return filepath.WalkDir(rootPath, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}

		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || !info.ModTime().Before(cutoff) {
			return nil
		}

		if err := os.Remove(path); err != nil {
			return err
		}
		Infof("deleted old upload temp file: %s", path)
		events.record(eventCleanup, systemUser, path)
		return nil
	})
}
