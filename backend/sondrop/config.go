package main

import (
	"flag"
	"log"
	"os"
	"path/filepath"
)

type config struct {
	uploadTmpDir     string
	uploadDir        string
	addr             string
	authDBPath       string
	logLevel         string
	rootPath         string
	dockerMountPoint string
}

type commandConfig struct {
	username string
	password string
}

func parseConfig() (*commandConfig, config) {
	if len(os.Args) > 1 && os.Args[1] == "create-user" {
		return parseCreateUserCommand()
	}

	var cfg config

	flag.StringVar(&cfg.uploadTmpDir, "upload-tmp-dir", "", "directory for uploaded files pending confirmation")
	flag.StringVar(&cfg.uploadTmpDir, "t", "", "directory for uploaded files pending confirmation")
	flag.StringVar(&cfg.uploadDir, "upload-dir", "", "directory for confirmed uploaded files")
	flag.StringVar(&cfg.uploadDir, "u", "", "directory for confirmed uploaded files")
	flag.StringVar(&cfg.addr, "addr", ":8080", "HTTP listen address")
	flag.StringVar(&cfg.authDBPath, "auth-db", "./auth.db", "SQLite auth database path")
	flag.StringVar(&cfg.logLevel, "log-level", "info", "backend log level: debug, info, warning, or error")
	flag.StringVar(&cfg.rootPath, "p", "", "shared root path for SonDrop data")
	flag.StringVar(&cfg.rootPath, "root-path", "", "shared root path for SonDrop data")
	flag.StringVar(&cfg.dockerMountPoint, "m", "", "path where root_path is mounted inside Docker containers")
	flag.StringVar(&cfg.dockerMountPoint, "docker-mount-point", "", "path where root_path is mounted inside Docker containers")
	flag.Parse()

	if cfg.uploadTmpDir == "" || cfg.uploadDir == "" {
		log.Fatal("both -upload-tmp-dir/-t and -upload-dir/-u must be supplied")
	}
	if cfg.dockerMountPoint == "" {
		log.Fatal("-docker-mount-point must be supplied")
	}

	cfg.rootPath = cleanPath(cfg.rootPath)
	cfg.dockerMountPoint = cleanPath(cfg.dockerMountPoint)
	cfg.uploadTmpDir = resolveDataPath(cfg.rootPath, cfg.uploadTmpDir)
	cfg.uploadDir = resolveDataPath(cfg.rootPath, cfg.uploadDir)

	ensureDir(cfg.uploadTmpDir, "upload tmp dir")
	ensureDir(cfg.uploadDir, "upload dir")

	return nil, cfg
}

func parseCreateUserCommand() (*commandConfig, config) {
	var cmd commandConfig
	var cfg config

	createUserFlags := flag.NewFlagSet("create-user", flag.ExitOnError)
	createUserFlags.StringVar(&cmd.username, "username", "", "username to create")
	createUserFlags.StringVar(&cmd.password, "password", "", "password to store for the user")
	createUserFlags.StringVar(&cfg.authDBPath, "auth-db", "./auth.db", "SQLite auth database path")
	createUserFlags.StringVar(&cfg.logLevel, "log-level", "info", "backend log level: debug, info, warning, or error")
	createUserFlags.Parse(os.Args[2:])

	if cmd.username == "" || cmd.password == "" {
		log.Fatal("create-user requires both -username and -password")
	}

	return &cmd, cfg
}

func ensureDir(path string, label string) {
	if err := os.MkdirAll(path, 0o755); err != nil {
		log.Fatalf("create %s: %v", label, err)
	}
}

func resolveDataPath(rootPath string, path string) string {
	path = cleanPath(path)
	if rootPath == "" || filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(rootPath, path)
}

func cleanPath(path string) string {
	if path == "" {
		return ""
	}
	return filepath.Clean(path)
}
