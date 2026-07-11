#!/bin/bash
set -e

file="$1"

codec=$(ffprobe -v error \
    -select_streams a:0 \
    -show_entries stream=codec_name \
    -of default=noprint_wrappers=1:nokey=1 \
    "$file")

if [ "$codec" = "mp3" ]; then
    echo "'$file' already contains MP3 audio."
    exit 0
fi

echo "'$file' contains '$codec' audio. Converting to MP3..."

tmp="${file}.tmp.mp3"

ffmpeg -y -i "$file" \
    -map 0:a:0 \
    -c:a libmp3lame \
    -q:a 0 \
    "$tmp"

mv "$tmp" "$file"

echo "Converted '$file' to a real MP3."