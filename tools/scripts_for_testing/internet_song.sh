
case "$1" in
    search)
        cat << 'EOF'
{
  "items": [
    {
      "number": 1,
      "title": "Shadmehr - Dahati",
      "time": "06:18",
      "size": "5.9MB",
      "quality": null,
      "download_command": "/dl_Bl8knaP"
    },
    {
      "number": 2,
      "title": "Shadmehr - Dahati",
      "time": "06:20",
      "size": "1.5MB",
      "quality": null,
      "download_command": "/dl_Bzr0MgV"
    },
    {
      "number": 3,
      "title": "Shadmehr Aghili - Dahati",
      "time": "04:44",
      "size": "872KB",
      "quality": null,
      "download_command": "/dl_BpvRql"
    },
    {
      "number": 4,
      "title": "Shadmehr Aghili - Dehati",
      "time": "06:20",
      "size": "12.8MB",
      "quality": "250",
      "download_command": "/dl_B2k1LKv"
    },
    {
      "number": 5,
      "title": "Shadmehr Aghili - Dehati",
      "time": "06:20",
      "size": "5.9MB",
      "quality": null,
      "download_command": "/dl_B2kP93L"
    },
    {
      "number": 6,
      "title": "Shadmehr - Shadmer - Gomet Kardam",
      "time": "04:01",
      "size": "3.8MB",
      "quality": null,
      "download_command": "/dl_B2klYkL"
    },
    {
      "number": 7,
      "title": "Shadmehr Barati - Baraye To Va Man",
      "time": "04:40",
      "size": "4.3MB",
      "quality": null,
      "download_command": "/dl_Bqo1DVE"
    },
    {
      "number": 8,
      "title": "Shadmehr Aghili - Shadmehr Aghili-Dehati...",
      "time": "06:09",
      "size": "7.1MB",
      "quality": null,
      "download_command": "/dl_B2on6D"
    },
    {
      "number": 9,
      "title": "Shadmehr Aghili - Saz Dahani",
      "time": "02:48",
      "size": "2.6MB",
      "quality": null,
      "download_command": "/dl_B1lxN3e"
    }
  ]
}
EOF
        ;;
    download)
        cat << 'EOF'
{"filename":"dl_Bl8knaP.mp3"}
EOF
    ;;
    *)
        echo "Usage: $0 {search|download} <query>" >&2
        exit 1
        ;;
esac