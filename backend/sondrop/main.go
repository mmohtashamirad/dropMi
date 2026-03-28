package main

import "log"

func main() {
	command, cfg := parseConfig()

	authDB, err := openAuthDB(cfg.authDBPath)
	if err != nil {
		log.Fatal(err)
	}
	defer authDB.Close()

	if command != nil {
		if err := createUser(authDB, command.username, command.password); err != nil {
			log.Fatal(err)
		}

		log.Printf("created user %q in %s", command.username, cfg.authDBPath)
		return
	}

	app := newServer(cfg, authDB)

	log.Printf("listening on http://localhost%s", cfg.addr)
	log.Printf("upload temp dir: %s", cfg.uploadTmpDir)
	log.Printf("upload dir: %s", cfg.uploadDir)
	log.Printf("auth db: %s", cfg.authDBPath)

	if err := app.listenAndServe(cfg.addr); err != nil {
		log.Fatal(err)
	}
}
