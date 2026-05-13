FROM golang:1.25-bookworm AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY backend ./backend
RUN CGO_ENABLED=0 go build -o /out/sondrop ./backend/sondrop

FROM docker:28-cli

WORKDIR /app

COPY --from=build /out/sondrop /app/sondrop
COPY static /app/static

EXPOSE 8080

ENTRYPOINT ["/app/sondrop"]
