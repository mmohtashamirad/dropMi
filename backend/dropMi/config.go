package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

type config struct {
	UploadTmpDir            string
	UploadDir               string
	Addr                    string
	AuthDBPath              string
	AuthMethod              string
	NavidromeURL            string
	JwtSigningKey           string
	JwtExpirySeconds        int
	JwtRefreshExpirySeconds int
	LogLevel                string
	RootPath                string
	DockerMountPoint        string
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
	var configPath string

	flag.StringVar(&configPath, "config", "", "path to the JSON config file")
	flag.StringVar(&configPath, "c", "", "path to the JSON config file")
	flag.Parse()

	if configPath == "" {
		log.Fatal("must supply -config path to the JSON config file")
	}

	if err := readConfigFile(configPath, &cfg); err != nil {
		log.Fatal(err)
	}

	if cfg.Addr == "" {
		cfg.Addr = ":8080"
	}
	if cfg.AuthDBPath == "" {
		cfg.AuthDBPath = "./auth.db"
	}
	if cfg.AuthMethod == "" {
		cfg.AuthMethod = "local"
	}
	cfg.AuthMethod = strings.ToLower(cfg.AuthMethod)
	if cfg.AuthMethod != "local" && cfg.AuthMethod != "navidrome" {
		log.Fatal("auth_method must be either local or navidrome")
	}
	if cfg.AuthMethod == "navidrome" && cfg.NavidromeURL == "" {
		log.Fatal("navidrome_url must be set when auth_method=navidrome")
	}
	if cfg.JwtSigningKey == "" {
		log.Fatal("jwt_signing_key must be set in the config file")
	}
	if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}

	if cfg.JwtExpirySeconds == 0 {
		// Default to 24 hours
		cfg.JwtExpirySeconds = 24 * 60 * 60
	}
	if cfg.JwtRefreshExpirySeconds == 0 {
		// Default refresh token expiry: 7 days
		cfg.JwtRefreshExpirySeconds = 7 * 24 * 60 * 60
	}

	if cfg.UploadTmpDir == "" || cfg.UploadDir == "" {
		log.Fatal("upload_tmp_dir and upload_dir must be set in the config file")
	}
	if cfg.DockerMountPoint == "" {
		log.Fatal("docker_mount_point must be set in the config file")
	}

	cfg.RootPath = cleanPath(cfg.RootPath)
	cfg.DockerMountPoint = cleanPath(cfg.DockerMountPoint)
	cfg.UploadTmpDir = resolveDataPath(cfg.RootPath, cfg.UploadTmpDir)
	cfg.UploadDir = resolveDataPath(cfg.RootPath, cfg.UploadDir)

	ensureDir(cfg.UploadTmpDir, "upload tmp dir")
	ensureDir(cfg.UploadDir, "upload dir")

	return nil, cfg
}

func parseCreateUserCommand() (*commandConfig, config) {
	var cmd commandConfig
	var cfg config
	var configPath string

	createUserFlags := flag.NewFlagSet("create-user", flag.ExitOnError)
	createUserFlags.StringVar(&cmd.username, "username", "", "username to create")
	createUserFlags.StringVar(&cmd.password, "password", "", "password to store for the user")
	createUserFlags.StringVar(&configPath, "config", "", "path to the config file")
	createUserFlags.StringVar(&configPath, "c", "", "path to the config file")
	createUserFlags.StringVar(&cfg.AuthDBPath, "auth-db", "./auth.db", "SQLite auth database path")
	createUserFlags.StringVar(&cfg.AuthMethod, "auth-method", "local", "authentication method to use: local or navidrome")
	createUserFlags.StringVar(&cfg.LogLevel, "log-level", "info", "backend log level: debug, info, warning, or error")
	createUserFlags.Parse(os.Args[2:])

	if configPath != "" {
		if err := readConfigFile(configPath, &cfg); err != nil {
			log.Fatal(err)
		}
	}

	if cfg.AuthMethod == "" {
		cfg.AuthMethod = "local"
	}
	cfg.AuthMethod = strings.ToLower(cfg.AuthMethod)
	if cfg.AuthMethod != "local" {
		log.Fatal("create-user is only supported with auth_method=local")
	}

	if cfg.AuthDBPath == "" {
		cfg.AuthDBPath = "./auth.db"
	}

	if cmd.username == "" || cmd.password == "" {
		log.Fatal("create-user requires both -username and -password")
	}

	return &cmd, cfg
}

func readConfigFile(path string, cfg *config) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("open config file: %w", err)
	}

	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)

		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			return fmt.Errorf("invalid config line (expected key=value): %s", line)
		}

		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])

		switch key {
		case "upload_tmp_dir":
			cfg.UploadTmpDir = value
		case "upload_dir":
			cfg.UploadDir = value
		case "addr":
			cfg.Addr = value
		case "auth_db":
			cfg.AuthDBPath = value
		case "auth_method":
			cfg.AuthMethod = value
		case "navidrome_url":
			cfg.NavidromeURL = value
		case "jwt_signing_key":
			cfg.JwtSigningKey = value
		case "jwt_expiry_seconds":
			// ignore parse error; zero means default
			fmt.Sscanf(value, "%d", &cfg.JwtExpirySeconds)
		case "jwt_refresh_expiry_seconds":
			fmt.Sscanf(value, "%d", &cfg.JwtRefreshExpirySeconds)
		case "log_level":
			cfg.LogLevel = value
		case "root_path":
			cfg.RootPath = value
		case "docker_mount_point":
			cfg.DockerMountPoint = value
		default:
			return fmt.Errorf("unknown config key: %s", key)
		}
	}

	return nil
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
