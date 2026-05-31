package main

import (
	"context"
	"log"
)

func main() {
	command, cfg := parseConfig()
	if err := setLogLevel(cfg.LogLevel); err != nil {
		log.Fatal(err)
	}
	configureMusicTools(cfg.RootPath, cfg.DockerMountPoint)

	authDB, err := openAuthDB(cfg.RootPath + "/" + cfg.AuthDBPath)
	if err != nil {
		log.Fatal(err)
	}
	defer authDB.Close()

	if command != nil {
		if cfg.AuthMethod != "local" {
			log.Fatal("create-user is only supported with auth_method=local")
		}
		if err := createUser(authDB, command.username, command.password); err != nil {
			log.Fatal(err)
		}

		Infof("created user %q in %s", command.username, cfg.AuthDBPath)
		return
	}

	if err := cleanUploadTmpFiles(cfg.UploadTmpDir); err != nil {
		log.Fatal(err)
	}
	startUploadTmpCleaner(cfg.UploadTmpDir)

	songs, err := newSongStore(authDB, cfg.UploadDir)
	if err != nil {
		log.Fatal(err)
	}
	if err := songs.refresh(context.Background()); err != nil {
		log.Fatal(err)
	}

	app := newServer(cfg, authDB, songs)

	Infof("listening on http://localhost%s", cfg.Addr)
	Infof("upload temp dir: %s", cfg.UploadTmpDir)
	Infof("upload dir: %s", cfg.UploadDir)
	Infof("auth db: %s", cfg.AuthDBPath)
	Infof("auth method: %s", cfg.AuthMethod)
	if cfg.AuthMethod == "navidrome" {
		Infof("navidrome url: %s", cfg.NavidromeURL)
	}
	Infof("log level: %s", cfg.LogLevel)
	Infof("docker mount point: %s", cfg.DockerMountPoint)
	if cfg.RootPath != "" {
		Infof("root path: %s", cfg.RootPath)
	}

	if err := app.listenAndServe(cfg.Addr); err != nil {
		log.Fatal(err)
	}
}
