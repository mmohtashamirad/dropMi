package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"

	_ "modernc.org/sqlite"
)

const sessionCookieName = "sondrop_session"

type sessionStore struct {
	mu       sync.RWMutex
	sessions map[string]string
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

func newSessionStore() *sessionStore {
	return &sessionStore{
		sessions: make(map[string]string),
	}
}

func (s *sessionStore) create(username string) (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", fmt.Errorf("create session token: %w", err)
	}

	token := hex.EncodeToString(tokenBytes)

	s.mu.Lock()
	s.sessions[token] = username
	s.mu.Unlock()

	return token, nil
}

func (s *sessionStore) username(token string) (string, bool) {
	s.mu.RLock()
	username, ok := s.sessions[token]
	s.mu.RUnlock()
	return username, ok
}
