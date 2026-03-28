# SonDrop

SonDrop is a small Go web application for dropping an audio file into the browser, uploading it to the server, and eventually inspecting it with `eyeD3`.

## Prerequisites

- Go 1.22 or newer

## Run Locally

From the project root:

```bash
mkdir -p upload_tmp upload
go run ./backend/sondrop -t ./upload_tmp -u ./upload
```

The server starts on `http://localhost:8080`.

## Build

To build a local binary into the `build/` folder:

```bash
mkdir -p build
go build -o build/sondrop ./backend/sondrop
```

Then run it with:

```bash
mkdir -p upload_tmp upload
./build/sondrop -t ./upload_tmp -u ./upload
```

## Make Targets

If you want a shorter build command, use:

```bash
make build
```

This also writes the binary to `build/sondrop`.

Short flags:
- `-t`: temporary upload directory
- `-u`: final upload directory

## Minimal Auth Step

The current auth setup only adds a SQLite `users` table and a simple user-creation command.
Passwords are stored as plain text for now so we can take auth in small steps.

Create a user:

```bash
go run ./backend/sondrop create-user -username admin -password secret
```

The auth database defaults to `./auth.db`, or you can override it:

```bash
go run ./backend/sondrop create-user -auth-db ./my-auth.db -username admin -password secret
```

After creating a user, the site now starts on a login screen.
Only a correct username and password can access the upload UI.

## Project Layout

- `backend/sondrop/`: Go application source
- `backend/sondrop/main.go`: startup entry point
- `backend/sondrop/config.go`: command-line flags and directory setup
- `backend/sondrop/server.go`: server construction and route registration
- `backend/sondrop/handlers.go`: HTTP handlers
- `backend/sondrop/auth.go`: SQLite auth and in-memory session logic
- `backend/sondrop/eyed3.go`: `eyeD3` execution
- `backend/sondrop/files.go`: upload file helpers and path validation
- `backend/sondrop/responses.go`: request/response types and JSON helper
- `static/`: frontend files served by the Go server
- `static/app.js`: frontend bootstrapping and event wiring
- `static/dom.js`: shared DOM element references
- `static/ui.js`: screen and result rendering helpers
- `static/auth-client.js`: login and logout requests
- `static/upload-client.js`: upload and upload-action requests
- `static/api.js`: shared frontend request helpers

## Current Status

The current version uploads the file into a temporary upload directory, runs `eyeD3`, shows the output in the browser, and moves the file into the final upload directory when the `OK` button is pressed.
