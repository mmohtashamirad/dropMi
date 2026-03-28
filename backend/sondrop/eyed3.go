package main

import (
	"context"
	"fmt"
	"path/filepath"
	"os/exec"
	"time"
)

const musicToolsImage = "music-tools"

func runEyeD3(parent context.Context, filePath string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	absolutePath, err := filepath.Abs(filePath)
	if err != nil {
		return "", fmt.Errorf("resolve upload path: %w", err)
	}

	songsDir := filepath.Dir(absolutePath)
	songPath := "/songs/" + filepath.Base(absolutePath)

	cmd := exec.CommandContext(
		ctx,
		"docker",
		"run",
		"--rm",
		"-v",
		fmt.Sprintf("%s:/songs", songsDir),
		musicToolsImage,
		"eyeD3",
		"--no-color",
		"--no-config",
		songPath,
	)
	Debugf("running command: %q", cmd.Args)
	output, err := cmd.CombinedOutput()
	return string(output), err
}
