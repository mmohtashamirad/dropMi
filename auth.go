package main

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

func openAuthDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open auth db: %w", err)
	}

	if err := ensureAuthSchema(db); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func ensureAuthSchema(db *sql.DB) error {
	const query = `
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password TEXT NOT NULL
		);
	`

	if _, err := db.Exec(query); err != nil {
		return fmt.Errorf("ensure auth schema: %w", err)
	}

	return nil
}

func createUser(db *sql.DB, username string, password string) error {
	username = strings.TrimSpace(username)
	if username == "" {
		return fmt.Errorf("username cannot be empty")
	}

	if _, err := db.Exec(
		`INSERT INTO users (username, password) VALUES (?, ?)`,
		username,
		password,
	); err != nil {
		return fmt.Errorf("create user: %w", err)
	}

	return nil
}
