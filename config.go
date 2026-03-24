package main

import (
	"flag"
	"log"
	"os"
)

type config struct {
	uploadTmpDir string
	uploadDir    string
	addr         string
}

func parseConfig() config {
	var cfg config

	flag.StringVar(&cfg.uploadTmpDir, "upload-tmp-dir", "", "directory for uploaded files pending confirmation")
	flag.StringVar(&cfg.uploadTmpDir, "t", "", "directory for uploaded files pending confirmation")
	flag.StringVar(&cfg.uploadDir, "upload-dir", "", "directory for confirmed uploaded files")
	flag.StringVar(&cfg.uploadDir, "u", "", "directory for confirmed uploaded files")
	flag.StringVar(&cfg.addr, "addr", ":8080", "HTTP listen address")
	flag.Parse()

	if cfg.uploadTmpDir == "" || cfg.uploadDir == "" {
		log.Fatal("both -upload-tmp-dir/-t and -upload-dir/-u must be supplied")
	}

	ensureDir(cfg.uploadTmpDir, "upload tmp dir")
	ensureDir(cfg.uploadDir, "upload dir")

	return cfg
}

func ensureDir(path string, label string) {
	if err := os.MkdirAll(path, 0o755); err != nil {
		log.Fatalf("create %s: %v", label, err)
	}
}
