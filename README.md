# SonDrop

SonDrop is a small Go web application for dropping an audio file into the browser, uploading it to the server, and eventually inspecting it with `eyeD3`.

## Prerequisites

- Go 1.22 or newer

## Run Locally

From the project root:

```bash
mkdir -p upload_tmp upload
go run . -t ./upload_tmp -u ./upload
```

The server starts on `http://localhost:8080`.

## Build

To build a local binary into the `build/` folder:

```bash
mkdir -p build
go build -o build/sondrop
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

## Project Layout

- `main.go`: startup entry point
- `config.go`: command-line flags and directory setup
- `server.go`: server construction and route registration
- `handlers.go`: upload and confirm HTTP handlers
- `eyed3.go`: `eyeD3` execution
- `files.go`: upload file helpers and path validation
- `responses.go`: request/response types and JSON helper
- `static/`: frontend files served by the Go server
- `static/app.js`: frontend bootstrapping and event wiring
- `static/dom.js`: shared DOM element references
- `static/ui.js`: screen and result rendering helpers
- `static/upload.js`: upload and confirm network calls

## Current Status

The current version uploads the file into a temporary upload directory, runs `eyeD3`, shows the output in the browser, and moves the file into the final upload directory when the `OK` button is pressed.
