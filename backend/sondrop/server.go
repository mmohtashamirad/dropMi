package main

import (
	"database/sql"
	"net/http"
)

type server struct {
	uploadTmpDir string
	uploadDir    string
	authDB       *sql.DB
	songs        *songStore
	sessions     *sessionStore
}

func newServer(cfg config, authDB *sql.DB, songs *songStore) *server {
	return &server{
		uploadTmpDir: cfg.uploadTmpDir,
		uploadDir:    cfg.uploadDir,
		authDB:       authDB,
		songs:        songs,
		sessions:     newSessionStore(authDB),
	}
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()

	publicFileServer := http.FileServer(http.Dir("./static/public"))
	authorizedFileServer := http.FileServer(http.Dir("./static/authorized"))

	mux.Handle("/public/", http.StripPrefix("/public/", publicFileServer))
	mux.Handle("/authorized/", s.requireAuthorizedPage(http.StripPrefix("/authorized/", authorizedFileServer)))
	mux.HandleFunc("/login", s.handleLogin)
	mux.HandleFunc("/session", s.handleSession)
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

	if _, ok := s.authenticatedUsername(r); ok {
		http.ServeFile(w, r, "./static/authorized/index.html")
		return
	}

	http.ServeFile(w, r, "./static/public/index.html")
}

func (s *server) requireAuthorizedPage(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := s.authenticatedUsername(r); !ok {
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}

		next.ServeHTTP(w, r)
	})
}
