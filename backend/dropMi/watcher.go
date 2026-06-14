package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/fsnotify/fsnotify"
)

func startUploadDirWatcher(uploadDir string, songs *songStore) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		Errorf("create file watcher: %v", err)
		return
	}

	go func() {
		defer watcher.Close()
		if err := watchDir(watcher, uploadDir); err != nil {
			Errorf("watch upload dir: %v", err)
			return
		}

		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}

				switch {
				case event.Has(fsnotify.Write):
					handleFileModified(event.Name, songs)
				case event.Has(fsnotify.Remove):
					handleFileDeleted(event.Name, songs)
				}

			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				Errorf("watcher error: %v", err)
			}
		}
	}()

	Infof("started upload dir watcher on %s", uploadDir)
}

// watchDir recursively adds the directory and all subdirectories to the watcher.
func watchDir(watcher *fsnotify.Watcher, dir string) error {
	return filepath.Walk(dir, func(path string, _ os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		return watcher.Add(path)
	})
}

func handleFileModified(filePath string, songs *songStore) {
	// Skip hidden files and temporary files
	baseName := filepath.Base(filePath)
	if strings.HasPrefix(baseName, ".") || strings.HasSuffix(baseName, ".tmp") {
		return
	}

	Debugf("file modified: %s, reindexing", filePath)
	if err := songs.upsertFromFile(context.Background(), filePath); err != nil {
		Errorf("reindex modified file %s: %v", filePath, err)
	}
}

func handleFileDeleted(filePath string, songs *songStore) {
	// Skip hidden files
	baseName := filepath.Base(filePath)
	if strings.HasPrefix(baseName, ".") {
		return
	}

	Debugf("file deleted: %s, removing from library", filePath)
	if err := songs.deleteByPath(filePath); err != nil {
		Errorf("delete file from library %s: %v", filePath, err)
	}
}
