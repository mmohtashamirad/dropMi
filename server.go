package main

import "net/http"

type server struct {
	uploadTmpDir string
	uploadDir    string
}

func newServer(cfg config) *server {
	return &server{
		uploadTmpDir: cfg.uploadTmpDir,
		uploadDir:    cfg.uploadDir,
	}
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()

	fileServer := http.FileServer(http.Dir("./static"))
	mux.Handle("/static/", http.StripPrefix("/static/", fileServer))
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
