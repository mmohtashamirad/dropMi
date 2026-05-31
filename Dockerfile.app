FROM golang:1.25-bookworm AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY backend ./backend
RUN CGO_ENABLED=0 go build -o /out/dropMi ./backend/dropMi

FROM docker:28-cli

WORKDIR /app

COPY --from=build /out/dropMi /app/dropMi
COPY static /app/static

EXPOSE 8080

ENTRYPOINT ["/app/dropMi"]
