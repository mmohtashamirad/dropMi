#!/bin/bash
case "$1" in
    search)
        docker exec internet-song \
            python3 internet_song.py \
            search "$2"
        ;;
    download)
        docker exec internet-song  \
            python3 internet_song.py \
            download "$2"
        ;;
    *)
        echo "Usage: $0 {search|download} <query>" >&2
        exit 1
        ;;
esac