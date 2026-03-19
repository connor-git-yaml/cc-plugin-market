FROM ubuntu:22.04

RUN apt-get update && \
    apt-get install -y \
    curl \
    git \
    build-essential && \
    rm -rf /var/lib/apt/lists/*

ENV APP_HOME=/opt/app \
    APP_PORT=3000

COPY . .

CMD ["./start.sh"]
