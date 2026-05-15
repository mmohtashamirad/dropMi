# SonDrop

SonDrop is a small Go web application for dropping an audio file into the browser, uploading it to the server, and analyzing it using eyeD3, shazam, ... and then fixing the tags and lyric, ...

'music-tools' is a docker container that you need to start both for dev or docker run. Instructions later in this doc.

## Prerequisites

- Go 1.22 or newer
- Docker


## Run Locally

From the project root:

```bash
mkdir -p tmp/data/tmp_upload tmp/data/upload tmp/data/config
make && ./build/sondrop -p $(pwd)/tmp/data/ -m /data -t tmp_upload/ -u upload/ -auth-db config/auth.db  -log-level debug
```

The server starts on `http://serverIP:8080`.



## Minimal Auth Step

The current auth setup only adds a SQLite `users` table and a simple user-creation command.
Passwords are stored as plain text for now so we can take auth in small steps.

Create a user:

```bash
./build/sondrop create-user -username admin -password secret
```

The auth database defaults to `./auth.db`, or you can override it:

```bash
./build/sondrop create-user -auth-db ./my-auth.db -username admin -password secret
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
- `backend/sondrop/run_command.go`: command execution on the server.
- `backend/sondrop/files.go`: upload file helpers and path validation
- `backend/sondrop/responses.go`: request/response types and JSON helper
- `static/`: frontend files served by the Go server
- `static/app.js`: frontend bootstrapping and event wiring
- `static/dom.js`: shared DOM element references
- `static/ui.js`: screen and result rendering helpers
- `static/auth-client.js`: login and logout requests
- `static/upload-client.js`: upload and upload-action requests
- `static/api.js`: shared frontend request helpers


## Docker
a dockerfile is added to create an image that you can run songrec and eyeD3 easily.
do this once on your computer from where you have the dockerfile:
`docker build -t music-tools .`

and to run the music-tools container manually:
`docker run -d --name music-tools -v "$(pwd)/tmp/data:/data" music-tools sleep infinity`

Then run the command below to get the shazam result:
`docker exec music-tools songrec audio-file-to-recognized-song /data/sondrop-214817309.mp3`

or for eyeD3:
`docker exec music-tools eyeD3 /data/sondrop-214817309.mp3`

or to generate an acoustic fingerprint with Chromaprint/fpcalc:
`docker exec music-tools fpcalc /data/sondrop-214817309.mp3`

For easier parsing, ask fpcalc for JSON:
`docker exec music-tools fpcalc -json /data/sondrop-214817309.mp3`


If your metadata contains non-Latin characters, use `--encoding utf16` to ensure the tags are written correctly:
`docker exec music-tools eyeD3 --encoding utf16 /data/sondrop-214817309.mp3`

The backend expects a running container named `music-tools` and uses it when it
analyzes uploads with eyeD3, fpcalc, and songrec.
Pass `-docker_mount_point` with the path where the same data root is mounted
inside that container.

## Docker Compose Deployment

For a Linux server deployment, use `Dockerfile.app` and `docker-compose.yml`.
The app container needs access to the host Docker socket because the backend
execs commands inside the long-running `music-tools` container for `eyeD3`,
`fpcalc`, and `songrec`.

Recommended server layout:

```text
sondrop/
  sondrop_repo/
  data/
    tmp_upload/
    upload/
    config/
      auth.db
```


Create persistent data folders:

```bash
mkdir -p \
  PATH_TO_SONDROP_DATA/data/tmp_upload \
  PATH_TO_SONDROP_DATA/data/upload \
  PATH_TO_SONDROP_DATA/data/config
```

Build both images:

```bash
docker-compose build
```

Create the first user:

```bash
docker-compose run --rm sondrop create-user \
  -auth-db /data/config/auth.db \
  -username admin \
  -password 'change-this'
```

Start the app:

```bash
docker-compose -p sondrop -f /mnt/craid1/docker-containers/sondrop/docker/docker-compose.yml up -d
```

The `music-tools` container stays running so the backend can reuse it with
`docker exec music-tools ...` instead of creating and tearing down a new Docker
network interface for every analysis command.

The `sondrop` container joins the external `cloudflare` network and listens on
port `8080` inside that network. Point your Cloudflare tunnel or reverse proxy
at `http://sondrop:8080`.

And to update the server to the latest changes:

```bash
docker-compose build
docker-compose up -d
```
