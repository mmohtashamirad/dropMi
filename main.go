package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const maxUploadSize = 100 << 20

type analyzeResponse struct {
	UploadID string `json:"uploadId,omitempty"`
	FileName string `json:"fileName"`
	Output   string `json:"output,omitempty"`
	Error    string `json:"error,omitempty"`
}

type confirmRequest struct {
	UploadID string `json:"uploadId"`
}

type confirmResponse struct {
	FileName string `json:"fileName,omitempty"`
	Message  string `json:"message,omitempty"`
	Error    string `json:"error,omitempty"`
}

type server struct {
	uploadTmpDir string
	uploadDir    string
}

func main() {
	var uploadTmpDir string
	var uploadDir string
	var addr string

	flag.StringVar(&uploadTmpDir, "upload-tmp-dir", "", "directory for uploaded files pending confirmation")
	flag.StringVar(&uploadTmpDir, "t", "", "directory for uploaded files pending confirmation")
	flag.StringVar(&uploadDir, "upload-dir", "", "directory for confirmed uploaded files")
	flag.StringVar(&uploadDir, "u", "", "directory for confirmed uploaded files")
	flag.StringVar(&addr, "addr", ":8080", "HTTP listen address")
	flag.Parse()

	if uploadTmpDir == "" || uploadDir == "" {
		log.Fatal("both -upload-tmp-dir/-t and -upload-dir/-u must be supplied")
	}

	if err := os.MkdirAll(uploadTmpDir, 0o755); err != nil {
		log.Fatalf("create upload tmp dir: %v", err)
	}

	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		log.Fatalf("create upload dir: %v", err)
	}

	app := &server{
		uploadTmpDir: uploadTmpDir,
		uploadDir:    uploadDir,
	}

	mux := http.NewServeMux()

	fileServer := http.FileServer(http.Dir("./static"))
	mux.Handle("/static/", http.StripPrefix("/static/", fileServer))
	mux.HandleFunc("/upload", app.handleUpload)
	mux.HandleFunc("/confirm", app.handleConfirm)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}

		http.ServeFile(w, r, "./static/index.html")
	})

	log.Printf("listening on http://localhost%s", addr)
	log.Printf("upload temp dir: %s", uploadTmpDir)
	log.Printf("upload dir: %s", uploadDir)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

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

	tempFile, err := os.CreateTemp(s.uploadTmpDir, "sondrop-*"+fileExtension(header.Filename))
	if err != nil {
		log.Printf("create temp file: %v", err)
		writeJSON(w, http.StatusInternalServerError, analyzeResponse{
			Error: "Unable to prepare the upload for analysis.",
		})
		return
	}
	tempPath := tempFile.Name()

	if _, err := io.Copy(tempFile, file); err != nil {
		log.Printf("save upload: %v", err)
		tempFile.Close()
		os.Remove(tempPath)
		writeJSON(w, http.StatusInternalServerError, analyzeResponse{
			Error: "Unable to save the uploaded file.",
		})
		return
	}

	if err := tempFile.Close(); err != nil {
		log.Printf("close temp file: %v", err)
		os.Remove(tempPath)
		writeJSON(w, http.StatusInternalServerError, analyzeResponse{
			Error: "Unable to finish writing the uploaded file.",
		})
		return
	}

	output, runErr := runEyeD3(r.Context(), tempPath)
	if runErr != nil {
		status := http.StatusInternalServerError
		message := "eyeD3 could not analyze the file."
		if errors.Is(runErr, context.DeadlineExceeded) {
			message = "eyeD3 took too long to analyze the file."
		}

		writeJSON(w, status, analyzeResponse{
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

	if req.UploadID == "" || filepath.Base(req.UploadID) != req.UploadID {
		writeJSON(w, http.StatusBadRequest, confirmResponse{
			Error: "Invalid upload ID.",
		})
		return
	}

	sourcePath := filepath.Join(s.uploadTmpDir, req.UploadID)
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

	destinationPath := filepath.Join(s.uploadDir, req.UploadID)
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

func runEyeD3(parent context.Context, filePath string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "eyeD3", "--no-color", "--no-config", filePath)
	output, err := cmd.CombinedOutput()
	return string(output), err
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func fileExtension(name string) string {
	return filepath.Ext(name)
}
