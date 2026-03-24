package main

import "log"

func main() {
	cfg := parseConfig()
	app := newServer(cfg)

	log.Printf("listening on http://localhost%s", cfg.addr)
	log.Printf("upload temp dir: %s", cfg.uploadTmpDir)
	log.Printf("upload dir: %s", cfg.uploadDir)

	if err := app.listenAndServe(cfg.addr); err != nil {
		log.Fatal(err)
	}
}
