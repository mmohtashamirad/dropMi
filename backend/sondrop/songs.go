package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

type songStore struct {
	db        *sql.DB
	uploadDir string
}

type songRecord struct {
	Path        string
	FileName    string
	Fingerprint string
	Duration    float64
	FileSize    int64
	ModTime     string
}

func newSongStore(db *sql.DB, uploadDir string) (*songStore, error) {
	store := &songStore{
		db:        db,
		uploadDir: uploadDir,
	}
	if err := store.ensureSchema(); err != nil {
		return nil, err
	}

	return store, nil
}

func (s *songStore) ensureSchema() error {
	const songsQuery = `
		CREATE TABLE IF NOT EXISTS songs (
			path TEXT PRIMARY KEY,
			file_name TEXT NOT NULL,
			fingerprint TEXT NOT NULL,
			duration REAL NOT NULL DEFAULT 0,
			file_size INTEGER NOT NULL DEFAULT 0,
			mod_time TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`

	if _, err := s.db.Exec(songsQuery); err != nil {
		return fmt.Errorf("ensure songs schema: %w", err)
	}

	const fingerprintIndexQuery = `
		CREATE INDEX IF NOT EXISTS songs_fingerprint_idx
		ON songs (fingerprint);
	`

	if _, err := s.db.Exec(fingerprintIndexQuery); err != nil {
		return fmt.Errorf("ensure songs fingerprint index: %w", err)
	}

	return nil
}

func (s *songStore) refresh(ctx context.Context) error {
	seen := make(map[string]bool)

	if err := filepath.WalkDir(s.uploadDir, func(path string, entry fs.DirEntry, err error) error {
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
		if !info.Mode().IsRegular() {
			return nil
		}

		absolutePath, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		seen[absolutePath] = true

		existing, ok, err := s.findByPath(absolutePath)
		if err != nil {
			return err
		}
		if ok && existing.FileSize == info.Size() && existing.ModTime == formatSongModTime(info.ModTime()) {
			return nil
		}

		if err := s.upsertFromFile(ctx, absolutePath); err != nil {
			Warnf("skip song index for %s: %v", absolutePath, err)
			return nil
		}

		return nil
	}); err != nil {
		return fmt.Errorf("refresh songs: %w", err)
	}

	return s.deleteMissing(seen)
}

func (s *songStore) upsertFromFile(ctx context.Context, path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat song: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil
	}

	fingerprint, _, err := runFPCalc(ctx, path)
	if err != nil {
		return fmt.Errorf("fingerprint song: %w", err)
	}

	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve song path: %w", err)
	}

	if _, err := s.db.Exec(
		`
			INSERT INTO songs (
				path,
				file_name,
				fingerprint,
				duration,
				file_size,
				mod_time,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(path) DO UPDATE SET
				file_name = excluded.file_name,
				fingerprint = excluded.fingerprint,
				duration = excluded.duration,
				file_size = excluded.file_size,
				mod_time = excluded.mod_time,
				updated_at = CURRENT_TIMESTAMP
		`,
		absolutePath,
		filepath.Base(absolutePath),
		fingerprint.Fingerprint,
		fingerprint.Duration,
		info.Size(),
		formatSongModTime(info.ModTime()),
	); err != nil {
		return fmt.Errorf("upsert song: %w", err)
	}

	return nil
}

func (s *songStore) findDuplicate(fingerprint string) (*songRecord, float64, error) {
	if fingerprint == "" {
		return nil, 0, nil
	}

	var record songRecord
	err := s.db.QueryRow(
		`
			SELECT path, file_name, fingerprint, duration, file_size, mod_time
			FROM songs
			WHERE fingerprint = ?
			ORDER BY updated_at DESC
			LIMIT 1
		`,
		fingerprint,
	).Scan(
		&record.Path,
		&record.FileName,
		&record.Fingerprint,
		&record.Duration,
		&record.FileSize,
		&record.ModTime,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, 0, nil
	}
	if err != nil {
		return nil, 0, fmt.Errorf("find duplicate song: %w", err)
	}

	return &record, 1, nil
}

func (s *songStore) findByPath(path string) (songRecord, bool, error) {
	var record songRecord
	err := s.db.QueryRow(
		`
			SELECT path, file_name, fingerprint, duration, file_size, mod_time
			FROM songs
			WHERE path = ?
		`,
		path,
	).Scan(
		&record.Path,
		&record.FileName,
		&record.Fingerprint,
		&record.Duration,
		&record.FileSize,
		&record.ModTime,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return songRecord{}, false, nil
	}
	if err != nil {
		return songRecord{}, false, fmt.Errorf("find song by path: %w", err)
	}

	return record, true, nil
}

func (s *songStore) deleteMissing(seen map[string]bool) error {
	rows, err := s.db.Query(`SELECT path FROM songs`)
	if err != nil {
		return fmt.Errorf("list songs: %w", err)
	}
	defer rows.Close()

	var missing []string
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			return fmt.Errorf("scan song path: %w", err)
		}
		if !seen[path] {
			missing = append(missing, path)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate song paths: %w", err)
	}

	for _, path := range missing {
		if _, err := s.db.Exec(`DELETE FROM songs WHERE path = ?`, path); err != nil {
			return fmt.Errorf("delete missing song %s: %w", path, err)
		}
	}

	return nil
}

func formatSongModTime(modTime time.Time) string {
	return modTime.UTC().Format(time.RFC3339Nano)
}
