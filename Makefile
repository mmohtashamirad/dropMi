APP_NAME := dropMi
BUILD_DIR := build
APP_DIR := ./backend/dropMi

.PHONY: build clean

build:
	mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/$(APP_NAME) $(APP_DIR)

clean:
	rm -rf $(BUILD_DIR)
