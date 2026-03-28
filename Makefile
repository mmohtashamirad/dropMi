APP_NAME := sondrop
BUILD_DIR := build
APP_DIR := ./backend/sondrop

.PHONY: build clean

build:
	mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/$(APP_NAME) $(APP_DIR)

clean:
	rm -rf $(BUILD_DIR)
