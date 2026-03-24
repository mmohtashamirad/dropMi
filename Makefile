APP_NAME := sondrop
BUILD_DIR := build

.PHONY: build clean

build:
	mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/$(APP_NAME) .

clean:
	rm -rf $(BUILD_DIR)
