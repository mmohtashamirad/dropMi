FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt update && apt install -y \
    software-properties-common \
    wget \
    ca-certificates \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN wget -qO- 'http://keyserver.ubuntu.com/pks/lookup?op=get&search=0x6888550b2fc77d09' \
    > /etc/apt/trusted.gpg.d/songrec.asc \
    && apt-add-repository ppa:marin-m/songrec -y -u \
    && apt update \
    && apt install -y songrec \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /songs

ENTRYPOINT ["songrec"]