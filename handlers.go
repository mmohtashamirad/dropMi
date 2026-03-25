package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

const maxUploadSize = 100 << 20

func (s *server) handleUpload(w http.ResponseWriter, r *http.Request) {
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

	tempFile, tempPath, err := createTempUploadFile(s.uploadTmpDir, header.Filename)
	if err != nil {
		log.Printf("create temp file: %v", err)
		writeJSON(w, http.StatusInternalServerError, analyzeResponse{
			Error: "Unable to prepare the upload for analysis.",
		})
		return
	}

	if err := saveUploadedFile(tempFile, file, tempPath); err != nil {
		log.Printf("save upload: %v", err)
		writeJSON(w, http.StatusInternalServerError, analyzeResponse{
			Error: "Unable to save the uploaded file.",
		})
		return
	}

	output, runErr := runEyeD3(r.Context(), tempPath)
	if runErr != nil {
		message := "eyeD3 could not analyze the file."
		if errors.Is(runErr, context.DeadlineExceeded) {
			message = "eyeD3 took too long to analyze the file."
		}

		writeJSON(w, http.StatusInternalServerError, analyzeResponse{
			UploadID: filepath.Base(tempPath),
			FileName: header.Filename,
			Output:   output,
			Error:    message,
		})
		return
	}

	writeJSON(w, http.StatusOK, analyzeResponse{
		UploadID: filepath.Base(tempPath),
		FileName: header.Filename,
		Output:   output,
	})
}

func (s *server) handleConfirm(w http.ResponseWriter, r *http.Request) {
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

	sourcePath := tempUploadPath(s.uploadTmpDir, uploadID)
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

	destinationPath := finalUploadPath(s.uploadDir, uploadID)
	if err := os.Rename(sourcePath, destinationPath); err != nil {
		log.Printf("move upload: %v", err)
		writeJSON(w, http.StatusInternalServerError, confirmResponse{
			Error: "Unable to move the uploaded file into the final upload directory.",
		})
		return
	}

	writeJSON(w, http.StatusOK, confirmResponse{
		FileName: filepath.Base(destinationPath),
		Message:  "File moved to upload directory.",
	})
}

func (s *server) handleCancel(w http.ResponseWriter, r *http.Request) {
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

	sourcePath := tempUploadPath(s.uploadTmpDir, uploadID)
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

	writeJSON(w, http.StatusOK, confirmResponse{
		Message: "Uploaded file deleted.",
	})
}
