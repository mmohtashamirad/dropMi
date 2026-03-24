# SonDrop

SonDrop is a small Go web application for dropping an audio file into the browser, uploading it to the server, and eventually inspecting it with `eyeD3`.

## Prerequisites

- Go 1.22 or newer

## Run Locally

From the project root:

```bash
go run .
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
./build/sondrop
```

## Make Targets

If you want a shorter build command, use:

```bash
make build
```

This also writes the binary to `build/sondrop`.

## Project Layout

- `main.go`: Go HTTP server entry point
- `static/`: frontend files served by the Go server

## Current Status

The current version serves a single page with a file drop area. Upload handling, progress display, and `eyeD3` integration are planned next.
