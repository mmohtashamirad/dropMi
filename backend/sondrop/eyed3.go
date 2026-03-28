package main

import (
	"context"
	"os/exec"
	"time"
)

func runEyeD3(parent context.Context, filePath string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "eyeD3", "--no-color", "--no-config", filePath)
	output, err := cmd.CombinedOutput()
	return string(output), err
}
