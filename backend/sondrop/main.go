package main

import (
	"context"
	"log"
)

func main() {
	command, cfg := parseConfig()
	if err := setLogLevel(cfg.logLevel); err != nil {
		log.Fatal(err)
	}
	configureMusicTools(cfg.rootPath, cfg.dockerMountPoint)

	authDB, err := openAuthDB(cfg.rootPath + "/" + cfg.authDBPath)
	if err != nil {
		log.Fatal(err)
	}
	defer authDB.Close()

	if command != nil {
		if err := createUser(authDB, command.username, command.password); err != nil {
			log.Fatal(err)
		}

		Infof("created user %q in %s", command.username, cfg.authDBPath)
		return
	}

	if err := cleanUploadTmpFiles(cfg.uploadTmpDir); err != nil {
		log.Fatal(err)
	}
	startUploadTmpCleaner(cfg.uploadTmpDir)

	songs, err := newSongStore(authDB, cfg.uploadDir)
	if err != nil {
		log.Fatal(err)
	}
	if err := songs.refresh(context.Background()); err != nil {
		log.Fatal(err)
	}

	app := newServer(cfg, authDB, songs)

	Infof("listening on http://localhost%s", cfg.addr)
	Infof("upload temp dir: %s", cfg.uploadTmpDir)
	Infof("upload dir: %s", cfg.uploadDir)
	Infof("auth db: %s", cfg.authDBPath)
	Infof("log level: %s", cfg.logLevel)
	Infof("docker mount point: %s", cfg.dockerMountPoint)
	if cfg.rootPath != "" {
		Infof("root path: %s", cfg.rootPath)
	}

	if err := app.listenAndServe(cfg.addr); err != nil {
		log.Fatal(err)
	}
}
