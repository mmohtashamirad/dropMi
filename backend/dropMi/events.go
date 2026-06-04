package main

import (
	"database/sql"
	"fmt"
	"strings"
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

func (s *eventStore) listEventsPage(offset, limit int, filter string) ([]eventItem, int, error) {
	if offset < 0 {
		offset = 0
	}
	if limit < 0 {
		limit = 0
	}

	where, whereArgs := buildEventFilter(filter)

	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM events `+where, whereArgs...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count events: %w", err)
	}

	events := make([]eventItem, 0)
	if limit == 0 {
		return events, total, nil
	}

	query := `
		SELECT id, created_at, type, username, info
		FROM events
		` + where + `
		ORDER BY id DESC
		LIMIT ? OFFSET ?
	`
	args := append([]any{}, whereArgs...)
	args = append(args, limit, offset)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list events: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var event eventItem
		if err := rows.Scan(&event.ID, &event.Timestamp, &event.Type, &event.Username, &event.Info); err != nil {
			return nil, 0, fmt.Errorf("scan event: %w", err)
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate events: %w", err)
	}

	return events, total, nil
}

func buildEventFilter(filter string) (string, []any) {
	filter = strings.TrimSpace(filter)
	if filter == "" {
		return "", nil
	}

	escaped := escapeSQLLike(filter)
	pattern := "%" + strings.ToLower(escaped) + "%"
	clause := `WHERE
		lower(type)     LIKE ? ESCAPE '\' OR
		lower(username) LIKE ? ESCAPE '\' OR
		lower(info)     LIKE ? ESCAPE '\'`
	return clause, []any{pattern, pattern, pattern}
}
