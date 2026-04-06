package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

const sessionCookieName = "sondrop_session"

type sessionStore struct {
	db *sql.DB
}

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
	const usersQuery = `
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password TEXT NOT NULL
		);
	`

	if _, err := db.Exec(usersQuery); err != nil {
		return fmt.Errorf("ensure auth schema: %w", err)
	}

	const sessionsQuery = `
		CREATE TABLE IF NOT EXISTS sessions (
			token TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`

	if _, err := db.Exec(sessionsQuery); err != nil {
		return fmt.Errorf("ensure session schema: %w", err)
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

func authenticateUser(db *sql.DB, username string, password string) (bool, error) {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return false, nil
	}

	var storedPassword string
	err := db.QueryRow(`SELECT password FROM users WHERE username = ?`, username).Scan(&storedPassword)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("authenticate user: %w", err)
	}

	return storedPassword == password, nil
}

func newSessionStore(db *sql.DB) *sessionStore {
	return &sessionStore{
		db: db,
	}
}

func (s *sessionStore) create(username string) (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", fmt.Errorf("create session token: %w", err)
	}

	token := hex.EncodeToString(tokenBytes)

	if _, err := s.db.Exec(
		`INSERT INTO sessions (token, username) VALUES (?, ?)`,
		token,
		username,
	); err != nil {
		return "", fmt.Errorf("store session: %w", err)
	}

	return token, nil
}

func (s *sessionStore) username(token string) (string, bool) {
	var username string
	err := s.db.QueryRow(`SELECT username FROM sessions WHERE token = ?`, token).Scan(&username)
	if err == sql.ErrNoRows {
		return "", false
	}
	if err != nil {
		Errorf("lookup session %q: %v", token, err)
		return "", false
	}

	return username, true
}

func (s *sessionStore) delete(token string) {
	if _, err := s.db.Exec(`DELETE FROM sessions WHERE token = ?`, token); err != nil {
		Errorf("delete session %q: %v", token, err)
	}
}
