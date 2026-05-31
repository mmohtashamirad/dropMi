package main

import (
	"fmt"
	"log"
	"strings"
)

type logLevel int

const (
	levelDebug logLevel = iota
	levelInfo
	levelWarning
	levelError
)

type leveledLogger struct {
	level logLevel
}

var logger = leveledLogger{level: levelInfo}

func parseLogLevel(value string) (logLevel, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug":
		return levelDebug, nil
	case "info":
		return levelInfo, nil
	case "warning":
		return levelWarning, nil
	case "error":
		return levelError, nil
	default:
		return levelInfo, fmt.Errorf("invalid log level %q; expected debug, info, warning, or error", value)
	}
}

func setLogLevel(value string) error {
	level, err := parseLogLevel(value)
	if err != nil {
		return err
	}

	logger.level = level
	return nil
}

func (l leveledLogger) logf(level logLevel, label string, format string, args ...any) {
	if level < l.level {
		return
	}

	log.Printf("[%s] %s", label, fmt.Sprintf(format, args...))
}

func Debugf(format string, args ...any) {
	logger.logf(levelDebug, "DEBUG", format, args...)
}

func Infof(format string, args ...any) {
	logger.logf(levelInfo, "INFO", format, args...)
}

func Warnf(format string, args ...any) {
	logger.logf(levelWarning, "WARNING", format, args...)
}

func Errorf(format string, args ...any) {
	logger.logf(levelError, "ERROR", format, args...)
}
