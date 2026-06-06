APP_NAME := dropMi
BUILD_DIR := build
APP_DIR := ./backend/dropMi
CHANGELOG := static/authorized/changelog.txt

.PHONY: build clean changelog

build: changelog
	mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/$(APP_NAME) $(APP_DIR)

# Export the git history (newest first) as "date time , author , subject" lines
# for the "What's Changed" tab. Best-effort: produces an empty file outside a repo.
changelog:
	git log --pretty=format:"%ad , %an , %s" --date=format:"%Y-%m-%d %H:%M:%S" > $(CHANGELOG) 2>/dev/null || : > $(CHANGELOG)

clean:
	rm -rf $(BUILD_DIR)
