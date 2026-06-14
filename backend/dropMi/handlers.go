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

// exactDuplicateMarkerSuffix names the sentinel file written next to an upload
// when the library already contains a 100% match, so confirmation can reject it.
const exactDuplicateMarkerSuffix = ".exsist"

func trimMetadataValues(metadata map[string]string) {
	for key, value := range metadata {
		metadata[key] = strings.TrimSpace(value)
	}
}

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

	ok, isAdmin, err := authenticateUser(s.authDB, s.authMethod, s.navidromeURL, req.Username, req.Password)
	if err != nil {
		Errorf("authenticate user: %v", err)
		writeJSON(w, http.StatusInternalServerError, loginResponse{
			Error: "Unable to check your login right now.",
		})
		return
	}

	if !ok {
		Warnf("failed login for username %q", req.Username)
		s.events.record(eventLoginFailed, req.Username, "")
		writeJSON(w, http.StatusUnauthorized, loginResponse{
			Error: "Incorrect username or password.",
		})
		return
	}

	// Issue a signed JWT as the session token. JWT signing key and expiry
	// are configured on the server. This keeps authentication stateless.
	jwtToken, err := signJWT(s.jwtSigningKey, req.Username, s.jwtExpirySecs, isAdmin)
	if err != nil {
		Errorf("sign jwt: %v", err)
		writeJSON(w, http.StatusInternalServerError, loginResponse{
			Error: "Unable to start your session.",
		})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    jwtToken,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	// Create a refresh token and set it as an HttpOnly cookie.
	if s.sessions != nil {
		refreshToken, err := s.sessions.createWithExpiry(req.Username, isAdmin, s.jwtRefreshExpirySecs)
		if err != nil {
			Errorf("create refresh token: %v", err)
			writeJSON(w, http.StatusInternalServerError, loginResponse{
				Error: "Unable to start your session.",
			})
			return
		}

		http.SetCookie(w, &http.Cookie{
			Name:     refreshCookieName,
			Value:    refreshToken,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
		})
	}

	Infof("login successful for username %q", req.Username)
	s.events.record(eventLogin, req.Username, "")
	writeJSON(w, http.StatusOK, loginResponse{
		OK:       true,
		Username: req.Username,
		IsAdmin:  isAdmin,
	})
}

func (s *server) handleSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	username, isAdmin, ok := s.authenticatedUser(r)
	if !ok {
		writeJSON(w, http.StatusOK, sessionResponse{
			Authenticated: false,
		})
		return
	}

	writeJSON(w, http.StatusOK, sessionResponse{
		Authenticated: true,
		Username:      username,
		IsAdmin:       isAdmin,
	})
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	username, _, _ := s.authenticatedUser(r)

	// Revoke refresh token if present
	if cookie, err := r.Cookie(refreshCookieName); err == nil {
		if s.sessions != nil {
			s.sessions.delete(cookie.Value)
		}
	}

	// Clear both cookies
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	Infof("logout completed")
	s.events.record(eventLogout, username, "")
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

	duplicates, err := s.findDuplicateUpload(r.Context(), tempPath)
	if err != nil {
		Errorf("fingerprint upload: %v", err)
		writeJSON(w, http.StatusInternalServerError, analyzeResponse{
			UploadID: filepath.Base(tempPath),
			FileName: header.Filename,
			Error:    "Unable to fingerprint the uploaded file for duplicate checking.",
		})
		return
	}

	if hasExactDuplicate(duplicates) {
		if err := os.WriteFile(tempPath+exactDuplicateMarkerSuffix, nil, 0o600); err != nil {
			Warnf("write exact-duplicate marker for %q: %v", tempPath, err)
		}
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
			Duplicates:  duplicates,
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
			Duplicates:    duplicates,
			EyeD3Output:   eyeD3Output,
			SongrecOutput: songrecOutput,
			Error:         message,
		})
		return
	}

	Infof("songrec analysis completed for %q", header.Filename)

	s.events.record(eventUpload, username, header.Filename)

	writeJSON(w, http.StatusOK, analyzeResponse{
		UploadID:      filepath.Base(tempPath),
		FileName:      header.Filename,
		Duplicates:    duplicates,
		EyeD3Output:   eyeD3Output,
		SongrecOutput: songrecOutput,
	})
}

func (s *server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	username, isAdmin, ok := s.authenticatedUser(r)
	if ok {
		// Access token still valid; nothing to do
		writeJSON(w, http.StatusOK, loginResponse{OK: true, Username: username, IsAdmin: isAdmin})
		return
	}

	// Check refresh token
	cookie, err := r.Cookie(refreshCookieName)
	if err != nil || s.sessions == nil {
		writeJSON(w, http.StatusUnauthorized, loginResponse{Error: "No refresh token"})
		return
	}

	username, isAdmin, ok = s.sessions.username(cookie.Value)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, loginResponse{Error: "Invalid refresh token"})
		return
	}

	// Rotate refresh token: delete old, create new
	s.sessions.delete(cookie.Value)
	newRefresh, err := s.sessions.createWithExpiry(username, isAdmin, s.jwtRefreshExpirySecs)
	if err != nil {
		Errorf("create refresh token: %v", err)
		writeJSON(w, http.StatusInternalServerError, loginResponse{Error: "Unable to refresh token"})
		return
	}

	// Issue new access token
	jwtToken, err := signJWT(s.jwtSigningKey, username, s.jwtExpirySecs, isAdmin)
	if err != nil {
		Errorf("sign jwt: %v", err)
		writeJSON(w, http.StatusInternalServerError, loginResponse{Error: "Unable to issue access token"})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    jwtToken,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    newRefresh,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})

	writeJSON(w, http.StatusOK, loginResponse{OK: true, Username: username, IsAdmin: isAdmin})
}

func (s *server) handleReshazam(w http.ResponseWriter, r *http.Request) {
	username, ok := s.requireAuth(w, r)
	if !ok {
		return
	}

	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req reshazamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, analyzeResponse{
			Error: "Unable to read request.",
		})
		return
	}

	uploadID, err := validateUploadID(req.UploadID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, analyzeResponse{
			Error: err.Error(),
		})
		return
	}

	sourcePath := tempUploadPath(s.uploadTmpDir, username, uploadID)
	if _, err := os.Stat(sourcePath); err != nil {
		status := http.StatusInternalServerError
		message := "Unable to find the uploaded file."
		if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
			message = "Uploaded file not found."
		}

		writeJSON(w, status, analyzeResponse{
			UploadID: uploadID,
			FileName: filepath.Base(sourcePath),
			Error:    message,
		})
		return
	}

	songrecOutput, songrecErr := runSongRec(r.Context(), sourcePath)
	if songrecErr != nil {
		message := "songrec could not analyze the file."
		if errors.Is(songrecErr, context.DeadlineExceeded) {
			message = "songrec took too long to analyze the file."
		}

		failedPath := failedUploadPath(s.failedUploadDir, username, filepath.Base(sourcePath))
		if copyErr := copyFile(sourcePath, failedPath); copyErr != nil {
			Errorf("reshazam failed for %q: could not copy to failed upload dir: %v", uploadID, copyErr)
		} else {
			Errorf("reshazam failed for %q: copied file to %s", uploadID, failedPath)
		}

		writeJSON(w, http.StatusInternalServerError, analyzeResponse{
			UploadID:      uploadID,
			FileName:      filepath.Base(sourcePath),
			SongrecOutput: songrecOutput,
			Error:         message,
		})
		return
	}

	writeJSON(w, http.StatusOK, analyzeResponse{
		UploadID:      uploadID,
		FileName:      filepath.Base(sourcePath),
		SongrecOutput: songrecOutput,
	})
}

const (
	duplicateMatchLimit         = 5
	duplicateMinSimilarityScore = 0.5
)

func hasExactDuplicate(duplicates []duplicateSong) bool {
	for _, duplicate := range duplicates {
		if duplicate.Similarity >= 0.9999 {
			return true
		}
	}
	return false
}

func (s *server) findDuplicateUpload(ctx context.Context, path string) ([]duplicateSong, error) {
	matches, _, err := runSongDupSimilarity(ctx, path, duplicateMatchLimit, duplicateMinSimilarityScore)
	if err != nil {
		return nil, err
	}
	if len(matches) == 0 {
		return nil, nil
	}

	duplicates := make([]duplicateSong, 0, len(matches))
	for _, match := range matches {
		duplicate, err := s.duplicateSongFromMatch(match)
		if err != nil {
			return nil, err
		}
		duplicates = append(duplicates, duplicate)
	}

	return duplicates, nil
}

func (s *server) duplicateSongFromMatch(match similarityMatch) (duplicateSong, error) {
	absoluteUploadDir, err := filepath.Abs(s.uploadDir)
	if err != nil {
		return duplicateSong{}, err
	}
	absoluteRecordPath, err := filepath.Abs(match.Path)
	if err != nil {
		return duplicateSong{}, err
	}

	relativePath, err := filepath.Rel(absoluteUploadDir, absoluteRecordPath)
	if err != nil || relativePath == "." || relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
		relativePath = ""
	}

	return duplicateSong{
		FileName:     match.FileName,
		RelativePath: filepath.ToSlash(relativePath),
		Similarity:   match.Similarity,
		Duration:     match.Duration,
	}, nil
}

func (s *server) handleConfirm(w http.ResponseWriter, r *http.Request) {
	username, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	_, isAdmin, _ := s.authenticatedUser(r)

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

	// Admins may force the upload through even when a duplicate or a same-named
	// file already exists. Non-admins can never force.
	force := req.ForceUpload && isAdmin

	uploadID, err := validateUploadID(req.UploadID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, confirmResponse{
			Error: err.Error(),
		})
		return
	}

	if len(req.SelectedMetadata) > 0 {
		trimMetadataValues(req.SelectedMetadata)
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

	if !force {
		if _, err := os.Stat(sourcePath + exactDuplicateMarkerSuffix); err == nil {
			writeJSON(w, http.StatusConflict, confirmResponse{
				Error: "Can't add this file to the library because a song exactly like it already exists.",
			})
			return
		}
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

	existingPath, err := findFileByName(s.uploadDir, filepath.Base(destinationPath))
	if err != nil {
		Errorf("check existing file name: %v", err)
		writeJSON(w, http.StatusInternalServerError, confirmResponse{
			Error: "Unable to check the library for an existing file.",
		})
		return
	}
	if existingPath != "" {
		if !force {
			writeJSON(w, http.StatusConflict, confirmResponse{
				Error: "A file with the same name already exists in the library.",
			})
			return
		}
		if err := os.Remove(existingPath); err != nil {
			Errorf("remove existing file: %v", err)
			writeJSON(w, http.StatusInternalServerError, confirmResponse{
				Error: "Unable to remove the existing file.",
			})
			return
		}
	}

	if err := os.Rename(sourcePath, destinationPath); err != nil {
		Errorf("move upload: %v", err)
		writeJSON(w, http.StatusInternalServerError, confirmResponse{
			Error: "Unable to move the uploaded file into the final upload directory.",
		})
		return
	}

	// The temp file is gone; drop any duplicate marker that sat next to it.
	os.Remove(sourcePath + exactDuplicateMarkerSuffix)

	if err := s.songs.upsertFromFile(r.Context(), destinationPath); err != nil {
		Warnf("index confirmed upload %s: %v", destinationPath, err)
	}

	Infof("moved upload %q to %s (force=%t)", uploadID, destinationPath, force)
	confirmInfo, _ := json.Marshal(map[string]any{
		"tmpPath":         sourcePath,
		"destinationPath": destinationPath,
		"metadata":        req.SelectedMetadata,
		"force":           force,
	})
	s.events.record(eventConfirm, username, string(confirmInfo))
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

	os.Remove(sourcePath + exactDuplicateMarkerSuffix)

	Infof("deleted upload %q from temp storage", uploadID)
	s.events.record(eventCancel, username, uploadID)
	writeJSON(w, http.StatusOK, confirmResponse{
		Message: "Uploaded file deleted.",
	})
}

func (s *server) handleUploadAudio(w http.ResponseWriter, r *http.Request) {
	username, ok := s.requireAuth(w, r)
	if !ok {
		return
	}

	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	uploadID, err := validateUploadID(r.URL.Query().Get("uploadId"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	sourcePath := tempUploadPath(s.uploadTmpDir, username, uploadID)
	if info, err := os.Stat(sourcePath); err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}

	http.ServeFile(w, r, sourcePath)
}

func (s *server) handleSong(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAuth(w, r); !ok {
		return
	}

	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	songPath, err := safeUploadSongPath(s.uploadDir, r.URL.Query().Get("path"))
	if err != nil {
		http.NotFound(w, r)
		return
	}

	http.ServeFile(w, r, songPath)
}

func safeUploadSongPath(uploadDir string, relativePath string) (string, error) {
	relativePath = strings.TrimSpace(relativePath)
	if relativePath == "" || filepath.IsAbs(relativePath) {
		return "", errors.New("invalid song path")
	}

	cleanPath := filepath.Clean(filepath.FromSlash(relativePath))
	if cleanPath == "." || cleanPath == ".." || strings.HasPrefix(cleanPath, ".."+string(filepath.Separator)) {
		return "", errors.New("invalid song path")
	}

	absoluteUploadDir, err := filepath.Abs(uploadDir)
	if err != nil {
		return "", err
	}

	absoluteSongPath, err := filepath.Abs(filepath.Join(absoluteUploadDir, cleanPath))
	if err != nil {
		return "", err
	}

	relativeToUploadDir, err := filepath.Rel(absoluteUploadDir, absoluteSongPath)
	if err != nil || relativeToUploadDir == ".." || strings.HasPrefix(relativeToUploadDir, ".."+string(filepath.Separator)) {
		return "", errors.New("invalid song path")
	}

	return absoluteSongPath, nil
}

func (s *server) requireAuth(w http.ResponseWriter, r *http.Request) (string, bool) {
	username, _, ok := s.authenticatedUser(r)
	if ok {
		return username, true
	}

	writeJSON(w, http.StatusUnauthorized, loginResponse{
		Error: "Please log in first.",
	})
	return "", false
}

func (s *server) authenticatedUser(r *http.Request) (string, bool, bool) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return "", false, false
	}
	if s.jwtSigningKey == "" {
		return "", false, false
	}

	username, isAdmin, ok := parseJWT(s.jwtSigningKey, cookie.Value)
	if !ok {
		return "", false, false
	}
	return username, isAdmin, true
}
