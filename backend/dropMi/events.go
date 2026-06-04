package main

import (
	"database/sql"
	"fmt"
	"time"
)

// Event types recorded in the events table. Use these constants instead of
// raw strings so the stored values stay consistent.
// systemUser is the username recorded for events not triggered by a logged-in
// user (server lifecycle, background cleanup, etc.).
const systemUser = "SYSTEM"

const (
	eventServerStart = "server_start"
	eventServerStop  = "server_stop"
	eventLogin       = "login"
	eventLoginFailed = "login_failed"
	eventLogout      = "logout"
	eventUpload      = "upload"
	eventConfirm     = "confirm"
	eventCancel      = "cancel"
	eventCleanup     = "cleanup"
	eventError       = "error"
)

type eventStore struct {
	db *sql.DB
}

func newEventStore(db *sql.DB) (*eventStore, error) {
	store := &eventStore{db: db}
	if err := store.ensureSchema(); err != nil {
		return nil, err
	}

	return store, nil
}

func (s *eventStore) ensureSchema() error {
	const eventsQuery = `
		CREATE TABLE IF NOT EXISTS events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			created_at TEXT NOT NULL,
			type TEXT NOT NULL,
			username TEXT NOT NULL DEFAULT '',
			info TEXT NOT NULL DEFAULT ''
		);
	`

	if _, err := s.db.Exec(eventsQuery); err != nil {
		return fmt.Errorf("ensure events schema: %w", err)
	}

	indexes := []string{
		`CREATE INDEX IF NOT EXISTS events_created_at_idx ON events (created_at);`,
		`CREATE INDEX IF NOT EXISTS events_type_idx ON events (type);`,
		`CREATE INDEX IF NOT EXISTS events_username_idx ON events (username);`,
	}
	for _, query := range indexes {
		if _, err := s.db.Exec(query); err != nil {
			return fmt.Errorf("ensure events index: %w", err)
		}
	}

	return nil
}

// record appends one event to the log. It is best-effort: a failure is logged
// but never propagated, so event tracking can't break the request it describes.
func (s *eventStore) record(eventType string, username string, info string) {
	if s == nil {
		return
	}

	if _, err := s.db.Exec(
		`INSERT INTO events (created_at, type, username, info) VALUES (?, ?, ?, ?)`,
		formatEventTime(time.Now()),
		eventType,
		username,
		info,
	); err != nil {
		Warnf("record %s event: %v", eventType, err)
	}
}

func formatEventTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}
