package main

import (
	"encoding/json"
	"log"
	"net/http"
)

type analyzeResponse struct {
	UploadID      string         `json:"uploadId,omitempty"`
	FileName      string         `json:"fileName"`
	Duplicate     *duplicateSong `json:"duplicate,omitempty"`
	EyeD3Output   string         `json:"eyeD3Output,omitempty"`
	SongrecOutput string         `json:"songrecOutput,omitempty"`
	LyricsOptions []lyricsOption `json:"lyricsOptions,omitempty"`
	Error         string         `json:"error,omitempty"`
}

type duplicateSong struct {
	FileName     string  `json:"fileName"`
	RelativePath string  `json:"relativePath,omitempty"`
	Similarity   float64 `json:"similarity"`
	Duration     float64 `json:"duration,omitempty"`
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	OK       bool   `json:"ok,omitempty"`
	Username string `json:"username,omitempty"`
	IsAdmin  bool   `json:"isAdmin,omitempty"`
	Error    string `json:"error,omitempty"`
}

type sessionResponse struct {
	Authenticated bool   `json:"authenticated"`
	Username      string `json:"username,omitempty"`
	IsAdmin       bool   `json:"isAdmin,omitempty"`
}

type tabItem struct {
	Key       string `json:"key"`
	Title     string `json:"title"`
	AdminOnly bool   `json:"adminOnly,omitempty"`
}

type userTabsResponse struct {
	Tabs []tabItem `json:"tabs"`
}

type librarySong struct {
	Path        string  `json:"path"`
	FileName    string  `json:"fileName"`
	Duration    float64 `json:"duration"`
	Artist      string  `json:"artist"`
	TrackName   string  `json:"trackName"`
	Album       string  `json:"album"`
	Genre       string  `json:"genre"`
	Comment     string  `json:"comment"`
	Language    string  `json:"language"`
	FileSize    int64   `json:"fileSize"`
	UpdatedTime string  `json:"updatedTime"`
}

type librarySongsResponse struct {
	Songs []librarySong `json:"songs"`
}

type confirmRequest struct {
	UploadID         string            `json:"uploadId"`
	SelectedMetadata map[string]string `json:"selectedMetadata,omitempty"`
	SelectedLyrics   *lyricsOption     `json:"selectedLyrics,omitempty"`
}

type reshazamRequest struct {
	UploadID string `json:"uploadId"`
}

type confirmResponse struct {
	FileName string `json:"fileName,omitempty"`
	Message  string `json:"message,omitempty"`
	Error    string `json:"error,omitempty"`
}

type lyricsOption struct {
	Title        string `json:"title"`
	Artist       string `json:"artist,omitempty"`
	Album        string `json:"album,omitempty"`
	SyncedLyrics string `json:"syncedLyrics,omitempty"`
	PlainLyrics  string `json:"plainLyrics,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("encode response: %v", err)
	}
}
