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

// errorEventRecorder, when set, is invoked with every formatted ERROR message so
// server errors can be persisted to the event log. It must not itself call
// Errorf, to avoid recursion.
var errorEventRecorder func(message string)

func setErrorEventRecorder(record func(message string)) {
	errorEventRecorder = record
}

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
	message := fmt.Sprintf(format, args...)
	logger.logf(levelError, "ERROR", "%s", message)
	if errorEventRecorder != nil {
		errorEventRecorder(message)
	}
}
