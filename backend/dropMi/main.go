package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

const serverShutdownTimeout = 10 * time.Second

func main() {
	command, cfg := parseConfig()
	if err := setLogLevel(cfg.LogLevel); err != nil {
		log.Fatal(err)
	}
	configureMusicTools(cfg.RootPath, cfg.DockerMountPoint, cfg.RootPath+"/"+cfg.AuthDBPath)

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

	events, err := newEventStore(authDB)
	if err != nil {
		log.Fatal(err)
	}
	setErrorEventRecorder(func(message string) {
		events.record(eventError, systemUser, message)
	})

	if err := cleanUploadTmpFiles(cfg.UploadTmpDir, events); err != nil {
		log.Fatal(err)
	}
	startUploadTmpCleaner(cfg.UploadTmpDir, events)

	songs, err := newSongStore(authDB, cfg.UploadDir)
	if err != nil {
		log.Fatal(err)
	}
	if err := songs.refresh(context.Background()); err != nil {
		log.Fatal(err)
	}

	app := newServer(cfg, authDB, songs, events)

	Infof("listening on http://localhost%s", cfg.Addr)
	Infof("upload temp dir: %s", cfg.UploadTmpDir)
	Infof("upload dir: %s", cfg.UploadDir)
	Infof("failed upload dir: %s", cfg.FailedUploadDir)
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

	httpServer := app.newHTTPServer(cfg.Addr)

	serverErr := make(chan error, 1)
	go func() {
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()
	events.record(eventServerStart, systemUser, cfg.Addr)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		events.record(eventServerStop, systemUser, err.Error())
		log.Fatal(err)
	case sig := <-stop:
		Infof("received signal %s, shutting down", sig)
	}

	events.record(eventServerStop, systemUser, "")

	ctx, cancel := context.WithTimeout(context.Background(), serverShutdownTimeout)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		Errorf("server shutdown: %v", err)
	}
}
