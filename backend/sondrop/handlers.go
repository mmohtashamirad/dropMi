package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxUploadSize = 100 << 20

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, loginResponse{
			Error: "Unable to read login request.",
		})
		return
	}

	ok, err := authenticateUser(s.authDB, req.Username, req.Password)
	if err != nil {
		Errorf("authenticate user: %v", err)
		writeJSON(w, http.StatusInternalServerError, loginResponse{
			Error: "Unable to check your login right now.",
		})
		return
	}

	if !ok {
		Warnf("failed login for username %q", req.Username)
		writeJSON(w, http.StatusUnauthorized, loginResponse{
			Error: "Incorrect username or password.",
		})
		return
	}

	token, err := s.sessions.create(req.Username)
	if err != nil {
		Errorf("create session: %v", err)
		writeJSON(w, http.StatusInternalServerError, loginResponse{
			Error: "Unable to start your session.",
		})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	Infof("login successful for username %q", req.Username)
	writeJSON(w, http.StatusOK, loginResponse{
		OK:       true,
		Username: req.Username,
	})
}

func (s *server) handleSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	username, ok := s.authenticatedUsername(r)
	if !ok {
		writeJSON(w, http.StatusOK, sessionResponse{
			Authenticated: false,
		})
		return
	}

	writeJSON(w, http.StatusOK, sessionResponse{
		Authenticated: true,
		Username:      username,
	})
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if cookie, err := r.Cookie(sessionCookieName); err == nil {
		s.sessions.delete(cookie.Value)
	}

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	Infof("logout completed")
	writeJSON(w, http.StatusOK, loginResponse{
		OK: true,
	})
}

func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
	username, ok := s.requireAuth(w, r)
	if !ok {
		return
	}

	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeJSON(w, http.StatusBadRequest, analyzeResponse{
			Error: "Unable to read upload. Make sure the file is smaller than 100 MB.",
		})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, analyzeResponse{
			Error: "No file was uploaded.",
		})
		return
	}
	defer file.Close()
	Debugf("received upload request for %q", header.Filename)

	tempFile, tempPath, err := createTempUploadFile(tempUserDir(s.uploadTmpDir, username), header.Filename)
	if err != nil {
		Errorf("create temp file: %v", err)
		writeJSON(w, http.StatusInternalServerError, analyzeResponse{
			Error: "Unable to prepare the upload for analysis.",
		})
		return
	}

	if err := saveUploadedFile(tempFile, file, tempPath); err != nil {
		Errorf("save upload: %v", err)
		writeJSON(w, http.StatusInternalServerError, analyzeResponse{
			Error: "Unable to save the uploaded file.",
		})
		return
	}
	Debugf("saved upload to %s", tempPath)

	duplicate, err := s.findDuplicateUpload(r.Context(), tempPath)
	if err != nil {
		Errorf("fingerprint upload: %v", err)
		writeJSON(w, http.StatusInternalServerError, analyzeResponse{
			UploadID: filepath.Base(tempPath),
			FileName: header.Filename,
			Error:    "Unable to fingerprint the uploaded file for duplicate checking.",
		})
		return
	}

	eyeD3Output, eyeD3Err := runEyeD3(r.Context(), tempPath)
	if eyeD3Err != nil {
		message := "eyeD3 could not analyze the file."
		if errors.Is(eyeD3Err, context.DeadlineExceeded) {
			message = "eyeD3 took too long to analyze the file."
		}

		writeJSON(w, http.StatusInternalServerError, analyzeResponse{
			UploadID:    filepath.Base(tempPath),
			FileName:    header.Filename,
			Duplicate:   duplicate,
			EyeD3Output: eyeD3Output,
			Error:       message,
		})
		return
	}

	Infof("eyeD3 analysis completed for %q", header.Filename)

	songrecOutput, songrecErr := runSongRec(r.Context(), tempPath)
	if songrecErr != nil {
		message := "songrec could not analyze the file."
		if errors.Is(songrecErr, context.DeadlineExceeded) {
			message = "songrec took too long to analyze the file."
		}

		writeJSON(w, http.StatusInternalServerError, analyzeResponse{
			UploadID:      filepath.Base(tempPath),
			FileName:      header.Filename,
			Duplicate:     duplicate,
			EyeD3Output:   eyeD3Output,
			SongrecOutput: songrecOutput,
			Error:         message,
		})
		return
	}

	Infof("songrec analysis completed for %q", header.Filename)

	writeJSON(w, http.StatusOK, analyzeResponse{
		UploadID:      filepath.Base(tempPath),
		FileName:      header.Filename,
		Duplicate:     duplicate,
		EyeD3Output:   eyeD3Output,
		SongrecOutput: songrecOutput,
	})
}

func (s *server) findDuplicateUpload(ctx context.Context, path string) (*duplicateSong, error) {
	fingerprint, _, err := runFPCalc(ctx, path)
	if err != nil {
		return nil, err
	}

	record, similarity, err := s.songs.findDuplicate(fingerprint.Fingerprint)
	if err != nil {
		return nil, err
	}
	if record == nil || similarity <= 0 {
		return nil, nil
	}

	relativePath, err := filepath.Rel(s.uploadDir, record.Path)
	if err != nil || strings.HasPrefix(relativePath, "..") {
		relativePath = ""
	}

	return &duplicateSong{
		FileName:     record.FileName,
		RelativePath: filepath.ToSlash(relativePath),
		Similarity:   similarity,
		Duration:     record.Duration,
	}, nil
}

func (s *server) handleConfirm(w http.ResponseWriter, r *http.Request) {
	username, ok := s.requireAuth(w, r)
	if !ok {
		return
	}

	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req confirmRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, confirmResponse{
			Error: "Unable to read confirmation request.",
		})
		return
	}

	uploadID, err := validateUploadID(req.UploadID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, confirmResponse{
			Error: err.Error(),
		})
		return
	}

	if len(req.SelectedMetadata) > 0 {
		Debugf("selected metadata for %q: %#v", uploadID, req.SelectedMetadata)
	}

	sourcePath := tempUploadPath(s.uploadTmpDir, username, uploadID)
	if _, err := os.Stat(sourcePath); err != nil {
		status := http.StatusInternalServerError
		message := "Unable to find the uploaded file."
		if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
			message = "Uploaded file not found."
		}

		writeJSON(w, status, confirmResponse{
			Error: message,
		})
		return
	}

	var tempArtworkPath string
	if artworkURL := req.SelectedMetadata["album_art"]; artworkURL != "" {
		response, err := http.Head(artworkURL)
		contentType := ""
		if err == nil {
			contentType = response.Header.Get("Content-Type")
			response.Body.Close()
		}

		tempArtworkPath = artworkPathForAudio(sourcePath, detectArtworkExtension(artworkURL, contentType))
		if err := downloadArtwork(artworkURL, tempArtworkPath); err != nil {
			Errorf("download artwork: %v", err)
			writeJSON(w, http.StatusInternalServerError, confirmResponse{
				Error: "Unable to download the selected album art.",
			})
			return
		}
		defer os.Remove(tempArtworkPath)
		Debugf("downloaded album art to %s", tempArtworkPath)
	}

	var tempLyricsPath string
	if req.SelectedLyrics != nil {
		lyricsBody := strings.TrimSpace(firstNonEmpty(req.SelectedLyrics.SyncedLyrics, req.SelectedLyrics.PlainLyrics))
		if lyricsBody != "" {
			tempLyricsPath = lyricsPathForAudio(sourcePath)
			if err := os.WriteFile(tempLyricsPath, []byte(lyricsBody), 0o600); err != nil {
				Errorf("write lyrics file: %v", err)
				writeJSON(w, http.StatusInternalServerError, confirmResponse{
					Error: "Unable to prepare the selected lyrics for tagging.",
				})
				return
			}
			defer os.Remove(tempLyricsPath)
			Debugf("prepared lyrics file at %s", tempLyricsPath)
		}
	}

	if len(req.SelectedMetadata) > 0 || tempArtworkPath != "" || tempLyricsPath != "" {
		if _, err := applySelectedMetadataWithLyrics(r.Context(), sourcePath, req.SelectedMetadata, tempArtworkPath, tempLyricsPath); err != nil {
			Errorf("apply selected metadata: %v", err)
			writeJSON(w, http.StatusInternalServerError, confirmResponse{
				Error: "Unable to write the selected metadata to the uploaded file.",
			})
			return
		}

		Infof("applied selected metadata to %q", uploadID)
	}

	destinationPath := metadataDrivenUploadPath(s.uploadDir, username, req.SelectedMetadata, sourcePath, uploadID)
	if err := os.MkdirAll(filepath.Dir(destinationPath), 0o755); err != nil {
		Errorf("create final upload directory: %v", err)
		writeJSON(w, http.StatusInternalServerError, confirmResponse{
			Error: "Unable to prepare the final upload directory.",
		})
		return
	}

	if err := os.Rename(sourcePath, destinationPath); err != nil {
		Errorf("move upload: %v", err)
		writeJSON(w, http.StatusInternalServerError, confirmResponse{
			Error: "Unable to move the uploaded file into the final upload directory.",
		})
		return
	}

	if err := s.songs.upsertFromFile(r.Context(), destinationPath); err != nil {
		Warnf("index confirmed upload %s: %v", destinationPath, err)
	}

	Infof("moved upload %q to %s", uploadID, destinationPath)
	writeJSON(w, http.StatusOK, confirmResponse{
		FileName: filepath.Base(destinationPath),
		Message:  "File moved to upload directory.",
	})
}

func (s *server) handleCancel(w http.ResponseWriter, r *http.Request) {
	username, ok := s.requireAuth(w, r)
	if !ok {
		return
	}

	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req confirmRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, confirmResponse{
			Error: "Unable to read cancel request.",
		})
		return
	}

	uploadID, err := validateUploadID(req.UploadID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, confirmResponse{
			Error: err.Error(),
		})
		return
	}

	sourcePath := tempUploadPath(s.uploadTmpDir, username, uploadID)
	if err := os.Remove(sourcePath); err != nil {
		status := http.StatusInternalServerError
		message := "Unable to delete the uploaded file."
		if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
			message = "Uploaded file not found."
		}

		writeJSON(w, status, confirmResponse{
			Error: message,
		})
		return
	}

	Infof("deleted upload %q from temp storage", uploadID)
	writeJSON(w, http.StatusOK, confirmResponse{
		Message: "Uploaded file deleted.",
	})
}

func (s *server) requireAuth(w http.ResponseWriter, r *http.Request) (string, bool) {
	username, ok := s.authenticatedUsername(r)
	if ok {
		return username, true
	}

	writeJSON(w, http.StatusUnauthorized, loginResponse{
		Error: "Please log in first.",
	})
	return "", false
}

func (s *server) authenticatedUsername(r *http.Request) (string, bool) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return "", false
	}

	username, ok := s.sessions.username(cookie.Value)
	return username, ok
}
