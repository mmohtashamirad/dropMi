FROM golang:1.25-bookworm AS build

WORKDIR /src

ENV CGO_ENABLED=0

COPY go.mod go.sum ./
RUN go mod download

COPY Makefile ./
COPY backend ./backend
COPY static ./static
# .git is needed so `make changelog` can export the git history.
COPY .git ./.git

# `make build` generates static/authorized/changelog.txt and builds the binary.
RUN make build

FROM docker:28-cli

WORKDIR /app

COPY --from=build /src/build/dropMi /app/dropMi
COPY --from=build /src/static /app/static

EXPOSE 8080

ENTRYPOINT ["/app/dropMi"]
