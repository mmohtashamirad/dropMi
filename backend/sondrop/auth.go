package main

import (
	"bytes"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	_ "modernc.org/sqlite"
)

const sessionCookieName = "sondrop_session"
const refreshCookieName = "sondrop_refresh"

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

	const refreshTokensQuery = `
		CREATE TABLE IF NOT EXISTS refresh_tokens (
			token TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		);
	`

	if _, err := db.Exec(refreshTokensQuery); err != nil {
		return fmt.Errorf("ensure refresh token schema: %w", err)
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

func authenticateUser(db *sql.DB, authMethod string, navidromeURL string, username string, password string) (bool, error) {
	username = strings.TrimSpace(username)
	password = strings.TrimSpace(password)
	if username == "" || password == "" {
		return false, nil
	}

	switch strings.ToLower(authMethod) {
	case "", "local":
		return authenticateUserLocal(db, username, password)
	case "navidrome":
		return authenticateUserNavidrome(navidromeURL, username, password)
	default:
		return false, fmt.Errorf("unsupported auth method: %s", authMethod)
	}
}

func authenticateUserLocal(db *sql.DB, username, password string) (bool, error) {
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

func authenticateUserNavidrome(apiURL, username, password string) (bool, error) {
	apiURL = strings.TrimSpace(apiURL)
	if apiURL == "" {
		return false, fmt.Errorf("navidrome URL not configured")
	}

	apiURL = strings.TrimRight(apiURL, "/")

	tryEndpoint := func(path string) (bool, error) {
		endpoint := apiURL + path
		payload, err := json.Marshal(map[string]string{
			"username": username,
			"password": password,
		})
		if err != nil {
			return false, fmt.Errorf("encode navidrome auth request: %w", err)
		}

		req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(payload))
		if err != nil {
			return false, fmt.Errorf("build navidrome auth request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return false, fmt.Errorf("navidrome auth request: %w", err)
		}
		defer resp.Body.Close()

		switch resp.StatusCode {
		case http.StatusOK:
			return true, nil
		case http.StatusUnauthorized:
			return false, nil
		case http.StatusNotFound, http.StatusMethodNotAllowed:
			return false, fmt.Errorf("not found")
		default:
			return false, fmt.Errorf("navidrome auth returned status %d", resp.StatusCode)
		}
	}

	// Try the actual login endpoint used by your Navidrome deployment first.
	if ok, err := tryEndpoint("/auth/login"); err == nil || ok {
		return ok, err
	}

	// Fall back to the standard Navidrome API path if needed.
	if ok, err := tryEndpoint("/api/v1/auth/login"); err == nil || ok {
		return ok, err
	}

	return authenticateUserNavidromeBasic(apiURL, username, password)
}

func authenticateUserNavidromeBasic(apiURL, username, password string) (bool, error) {
	endpoint := strings.TrimRight(apiURL, "/") + "/api/v1/me"
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return false, fmt.Errorf("build navidrome status request: %w", err)
	}
	req.SetBasicAuth(username, password)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("navidrome auth request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		return true, nil
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return false, nil
	}

	return false, fmt.Errorf("navidrome auth returned status %d", resp.StatusCode)
}

func newSessionStore(db *sql.DB) *sessionStore {
	return &sessionStore{db: db}
}

func (s *sessionStore) create(username string) (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", fmt.Errorf("create session token: %w", err)
	}

	token := hex.EncodeToString(tokenBytes)

	// Default expires_at; caller should insert with expiry using createWithExpiry.
	// For backward compatibility, insert with a long expiry (30 days) if used directly.
	expires := time.Now().Add(30 * 24 * time.Hour).Unix()
	created := time.Now().Unix()
	if _, err := s.db.Exec(
		`INSERT INTO refresh_tokens (token, username, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		token,
		username,
		expires,
		created,
	); err != nil {
		return "", fmt.Errorf("store refresh token: %w", err)
	}

	return token, nil
}
func (s *sessionStore) username(token string) (string, bool) {
	var username string
	var expiresAt int64
	err := s.db.QueryRow(`SELECT username, expires_at FROM refresh_tokens WHERE token = ?`, token).Scan(&username, &expiresAt)
	if err == sql.ErrNoRows {
		return "", false
	}
	if err != nil {
		Errorf("lookup refresh token %q: %v", token, err)
		return "", false
	}

	if time.Now().Unix() > expiresAt {
		// Token expired; remove it
		s.delete(token)
		return "", false
	}

	return username, true
}

func (s *sessionStore) delete(token string) {
	if _, err := s.db.Exec(`DELETE FROM refresh_tokens WHERE token = ?`, token); err != nil {
		Errorf("delete refresh token %q: %v", token, err)
	}
}

// createWithExpiry creates a refresh token for username with given expiry seconds.
func (s *sessionStore) createWithExpiry(username string, expirySeconds int) (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", fmt.Errorf("create refresh token: %w", err)
	}

	token := hex.EncodeToString(tokenBytes)
	expires := time.Now().Add(time.Duration(expirySeconds) * time.Second).Unix()
	created := time.Now().Unix()

	if _, err := s.db.Exec(
		`INSERT INTO refresh_tokens (token, username, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		token,
		username,
		expires,
		created,
	); err != nil {
		return "", fmt.Errorf("store refresh token: %w", err)
	}

	return token, nil
}

// signJWT creates a signed JWT using the provided signing key and expiry seconds.
func signJWT(signingKey string, username string, expirySeconds int) (string, error) {
	if signingKey == "" {
		return "", fmt.Errorf("jwt signing key not configured")
	}

	claims := jwt.RegisteredClaims{
		Subject:   username,
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(expirySeconds) * time.Second)),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(signingKey))
	if err != nil {
		return "", fmt.Errorf("sign jwt: %w", err)
	}
	return signed, nil
}

// parseJWT validates and parses the token, returning the username on success.
func parseJWT(signingKey string, tokenStr string) (string, bool) {
	if signingKey == "" || tokenStr == "" {
		return "", false
	}

	token, err := jwt.ParseWithClaims(tokenStr, &jwt.RegisteredClaims{}, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(signingKey), nil
	})
	if err != nil {
		return "", false
	}

	if claims, ok := token.Claims.(*jwt.RegisteredClaims); ok && token.Valid {
		return claims.Subject, true
	}
	return "", false
}
