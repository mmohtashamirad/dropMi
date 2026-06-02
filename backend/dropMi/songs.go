package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type songStore struct {
	db        *sql.DB
	uploadDir string
}

type songRecord struct {
	Path            string
	FileName        string
	Fingerprint     string
	FingerprintHash string
	Duration        float64
	Artist          string
	TrackName       string
	Album           string
	Genre           string
	Comment         string
	Language        string
	FileSize        int64
	ModTime         string
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
			fingerprint_hash TEXT NOT NULL DEFAULT '',
			duration REAL NOT NULL DEFAULT 0,
			artist TEXT NOT NULL DEFAULT '',
			track_name TEXT NOT NULL DEFAULT '',
			album TEXT NOT NULL DEFAULT '',
			genre TEXT NOT NULL DEFAULT '',
			comment TEXT NOT NULL DEFAULT '',
			language TEXT NOT NULL DEFAULT '',
			file_size INTEGER NOT NULL DEFAULT 0,
			mod_time TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`

	if _, err := s.db.Exec(songsQuery); err != nil {
		return fmt.Errorf("ensure songs schema: %w", err)
	}

	columns := map[string]string{
		"fingerprint_hash": "TEXT NOT NULL DEFAULT ''",
		"artist":           "TEXT NOT NULL DEFAULT ''",
		"track_name":       "TEXT NOT NULL DEFAULT ''",
		"album":            "TEXT NOT NULL DEFAULT ''",
		"genre":            "TEXT NOT NULL DEFAULT ''",
		"comment":          "TEXT NOT NULL DEFAULT ''",
		"language":         "TEXT NOT NULL DEFAULT ''",
	}
	for column, definition := range columns {
		if err := s.ensureColumn(column, definition); err != nil {
			return err
		}
	}

	if _, err := s.db.Exec(`UPDATE songs SET fingerprint_hash = '' WHERE fingerprint_hash IS NULL`); err != nil {
		return fmt.Errorf("normalize song fingerprint hashes: %w", err)
	}
	if _, err := s.db.Exec(`UPDATE songs SET fingerprint_hash = lower(hex(sha3(fingerprint, 256))) WHERE fingerprint_hash = '' AND fingerprint != ''`); err != nil {
		// modernc sqlite may not expose sha3 in every build; upsert refresh will fill hashes.
		Debugf("skip SQL fingerprint hash backfill: %v", err)
	}

	indexes := []string{
		`CREATE INDEX IF NOT EXISTS songs_fingerprint_idx ON songs (fingerprint);`,
		`CREATE INDEX IF NOT EXISTS songs_fingerprint_hash_idx ON songs (fingerprint_hash);`,
		`CREATE INDEX IF NOT EXISTS songs_artist_track_idx ON songs (artist, track_name);`,
	}
	for _, query := range indexes {
		if _, err := s.db.Exec(query); err != nil {
			return fmt.Errorf("ensure songs index: %w", err)
		}
	}

	return nil
}

func (s *songStore) ensureColumn(column string, definition string) error {
	rows, err := s.db.Query(`PRAGMA table_info(songs)`)
	if err != nil {
		return fmt.Errorf("inspect songs schema: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return fmt.Errorf("scan songs schema: %w", err)
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate songs schema: %w", err)
	}

	if _, err := s.db.Exec(fmt.Sprintf("ALTER TABLE songs ADD COLUMN %s %s", column, definition)); err != nil {
		return fmt.Errorf("add songs.%s column: %w", column, err)
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
		if ok && existing.FileSize == info.Size() && existing.ModTime == formatSongModTime(info.ModTime()) && existing.FingerprintHash != "" {
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

	indexData, _, err := runSongDupRecord(ctx, path)
	if err != nil {
		return fmt.Errorf("index song: %w", err)
	}
	if indexData.FingerprintHash == "" {
		indexData.FingerprintHash = fingerprintHash(indexData.Fingerprint)
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
				fingerprint_hash,
				duration,
				artist,
				track_name,
				album,
				genre,
				comment,
				language,
				file_size,
				mod_time,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(path) DO UPDATE SET
				file_name = excluded.file_name,
				fingerprint = excluded.fingerprint,
				fingerprint_hash = excluded.fingerprint_hash,
				duration = excluded.duration,
				artist = excluded.artist,
				track_name = excluded.track_name,
				album = excluded.album,
				genre = excluded.genre,
				comment = excluded.comment,
				language = excluded.language,
				file_size = excluded.file_size,
				mod_time = excluded.mod_time,
				updated_at = CURRENT_TIMESTAMP
		`,
		absolutePath,
		filepath.Base(absolutePath),
		indexData.Fingerprint,
		indexData.FingerprintHash,
		indexData.Duration,
		strings.TrimSpace(indexData.Artist),
		strings.TrimSpace(indexData.TrackName),
		strings.TrimSpace(indexData.Album),
		strings.TrimSpace(indexData.Genre),
		strings.TrimSpace(indexData.Comment),
		strings.TrimSpace(indexData.Language),
		info.Size(),
		formatSongModTime(info.ModTime()),
	); err != nil {
		return fmt.Errorf("upsert song: %w", err)
	}

	return nil
}

func (s *songStore) listSongsPage(offset, limit int, filter string) ([]librarySong, int, error) {
	if offset < 0 {
		offset = 0
	}
	if limit < 0 {
		limit = 0
	}

	where, whereArgs := buildSongFilter(filter)

	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM songs `+where, whereArgs...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count library songs: %w", err)
	}

	songs := make([]librarySong, 0)
	if limit == 0 {
		return songs, total, nil
	}

	query := `
		SELECT path, file_name, duration, artist, track_name, album, genre, comment, language, file_size, updated_at
		FROM songs
		` + where + `
		ORDER BY lower(artist), lower(album), lower(track_name), lower(file_name)
		LIMIT ? OFFSET ?
	`
	args := append([]any{}, whereArgs...)
	args = append(args, limit, offset)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list library songs: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var song librarySong
		if err := rows.Scan(
			&song.Path,
			&song.FileName,
			&song.Duration,
			&song.Artist,
			&song.TrackName,
			&song.Album,
			&song.Genre,
			&song.Comment,
			&song.Language,
			&song.FileSize,
			&song.UpdatedTime,
		); err != nil {
			return nil, 0, fmt.Errorf("scan library song: %w", err)
		}
		songs = append(songs, song)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate library songs: %w", err)
	}

	return songs, total, nil
}

func (s *songStore) findByPath(path string) (songRecord, bool, error) {
	var record songRecord
	err := s.db.QueryRow(
		`
			SELECT path, file_name, fingerprint, fingerprint_hash, duration, artist, track_name, album, genre, comment, language, file_size, mod_time
			FROM songs
			WHERE path = ?
		`,
		path,
	).Scan(
		&record.Path,
		&record.FileName,
		&record.Fingerprint,
		&record.FingerprintHash,
		&record.Duration,
		&record.Artist,
		&record.TrackName,
		&record.Album,
		&record.Genre,
		&record.Comment,
		&record.Language,
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

func fingerprintHash(fingerprint string) string {
	sum := sha256.Sum256([]byte(fingerprint))
	return hex.EncodeToString(sum[:])
}

func buildSongFilter(filter string) (string, []any) {
	filter = strings.TrimSpace(filter)
	if filter == "" {
		return "", nil
	}

	escaped := escapeSQLLike(filter)
	pattern := "%" + strings.ToLower(escaped) + "%"
	clause := `WHERE
		lower(artist)     LIKE ? ESCAPE '\' OR
		lower(track_name) LIKE ? ESCAPE '\' OR
		lower(genre)      LIKE ? ESCAPE '\' OR
		lower(language)   LIKE ? ESCAPE '\'`
	return clause, []any{pattern, pattern, pattern, pattern}
}

func escapeSQLLike(value string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		`%`, `\%`,
		`_`, `\_`,
	)
	return replacer.Replace(value)
}

func formatSongModTime(modTime time.Time) string {
	return modTime.UTC().Format(time.RFC3339Nano)
}
