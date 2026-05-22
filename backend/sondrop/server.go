package main

import (
	"database/sql"
	"net/http"
)

type server struct {
	uploadTmpDir         string
	uploadDir            string
	authDB               *sql.DB
	songs                *songStore
	sessions             *sessionStore
	authMethod           string
	navidromeURL         string
	jwtSigningKey        string
	jwtExpirySecs        int
	jwtRefreshExpirySecs int
}

func newServer(cfg config, authDB *sql.DB, songs *songStore) *server {
	return &server{
		uploadTmpDir:         cfg.UploadTmpDir,
		uploadDir:            cfg.UploadDir,
		authDB:               authDB,
		songs:                songs,
		sessions:             newSessionStore(authDB),
		authMethod:           cfg.AuthMethod,
		navidromeURL:         cfg.NavidromeURL,
		jwtSigningKey:        cfg.JwtSigningKey,
		jwtExpirySecs:        cfg.JwtExpirySeconds,
		jwtRefreshExpirySecs: cfg.JwtRefreshExpirySeconds,
	}
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()

	publicFileServer := http.FileServer(http.Dir("./static/public"))
	authorizedFileServer := http.FileServer(http.Dir("./static/authorized"))

	mux.Handle("/public/", http.StripPrefix("/public/", s.noCacheMiddleware(publicFileServer)))
	mux.Handle("/authorized/", s.requireAuthorizedPage(http.StripPrefix("/authorized/", s.noCacheMiddleware(authorizedFileServer))))
	mux.HandleFunc("/login", s.handleLogin)
	mux.HandleFunc("/session", s.handleSession)
	mux.HandleFunc("/user-tabs", s.handleUserTabs)
	mux.HandleFunc("/refresh", s.handleRefresh)
	mux.HandleFunc("/logout", s.handleLogout)
	mux.HandleFunc("/upload", s.handleUpload)
	mux.HandleFunc("/confirm", s.handleConfirm)
	mux.HandleFunc("/cancel", s.handleCancel)
	mux.HandleFunc("/reshazam", s.handleReshazam)
	mux.HandleFunc("/song", s.handleSong)
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

	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	if _, _, ok := s.authenticatedUser(r); ok {
		http.ServeFile(w, r, "./static/authorized/index.html")
		return
	}

	http.ServeFile(w, r, "./static/public/index.html")
}

func (s *server) handleUserTabs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	_, isAdmin, ok := s.authenticatedUser(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	availableTabs := []tabItem{
		{Key: "drop", Title: "Drop", AdminOnly: false},
		{Key: "tab2", Title: "Tab2", AdminOnly: false},
		{Key: "tab3", Title: "Tab3", AdminOnly: false},
		{Key: "tab4", Title: "Tab4", AdminOnly: false},
		{Key: "tab5", Title: "Tab5", AdminOnly: false},
		{Key: "tab6", Title: "Tab6", AdminOnly: true},
		{Key: "tab7", Title: "Tab7", AdminOnly: false},
		{Key: "tab8", Title: "Tab8", AdminOnly: true},
	}

	tabs := make([]tabItem, 0, len(availableTabs))
	for _, tab := range availableTabs {
		if tab.AdminOnly && !isAdmin {
			continue
		}
		tabs = append(tabs, tab)
	}

	writeJSON(w, http.StatusOK, userTabsResponse{Tabs: tabs})
}

func (s *server) requireAuthorizedPage(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, _, ok := s.authenticatedUser(r); !ok {
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *server) noCacheMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
		next.ServeHTTP(w, r)
	})
}
