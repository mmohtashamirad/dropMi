
case "$1" in
    search)
        docker exec ahangify \
            python3 ahangify_downloader.py \
            -s /data/milad.session \
            search "$2"
        ;;
    download)
        docker exec ahangify \
            python3 ahangify_downloader.py \
            -s /data/milad.session \
            -d /data/downloads/ \
            download "$2"
        ;;
    *)
        echo "Usage: $0 {search|download} <query>" >&2
        exit 1
        ;;
esac