package main

import (
	"encoding/json"
	"log"
	"net/http"
)

type analyzeResponse struct {
	UploadID     string `json:"uploadId,omitempty"`
	FileName     string `json:"fileName"`
	EyeD3Output  string `json:"eyeD3Output,omitempty"`
	SongrecOutput string `json:"songrecOutput,omitempty"`
	Error        string `json:"error,omitempty"`
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	OK    bool   `json:"ok,omitempty"`
	Error string `json:"error,omitempty"`
}

type confirmRequest struct {
	UploadID         string            `json:"uploadId"`
	SelectedMetadata map[string]string `json:"selectedMetadata,omitempty"`
}

type confirmResponse struct {
	FileName string `json:"fileName,omitempty"`
	Message  string `json:"message,omitempty"`
	Error    string `json:"error,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("encode response: %v", err)
	}
}
