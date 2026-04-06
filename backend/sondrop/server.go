package main

import (
	"database/sql"
	"net/http"
)

type server struct {
	uploadTmpDir string
	uploadDir    string
	authDB       *sql.DB
	sessions     *sessionStore
}

func newServer(cfg config, authDB *sql.DB) *server {
	return &server{
		uploadTmpDir: cfg.uploadTmpDir,
		uploadDir:    cfg.uploadDir,
		authDB:       authDB,
		sessions:     newSessionStore(authDB),
	}
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()

	fileServer := http.FileServer(http.Dir("./static"))
	mux.Handle("/static/", http.StripPrefix("/static/", fileServer))
	mux.HandleFunc("/login", s.handleLogin)
	mux.HandleFunc("/logout", s.handleLogout)
	mux.HandleFunc("/upload", s.handleUpload)
	mux.HandleFunc("/confirm", s.handleConfirm)
	mux.HandleFunc("/cancel", s.handleCancel)
	mux.HandleFunc("/", s.handleIndex)

	return mux
}

func (s *server) listenAndServe(addr string) error {
	return http.ListenAndServe(addr, s.routes())
}

func (s *server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	http.ServeFile(w, r, "./static/index.html")
}
