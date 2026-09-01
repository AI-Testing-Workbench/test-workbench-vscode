FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive

ARG TSCODE_COMMIT
ARG SERVER_USER=root

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server \
    ca-certificates \
    curl \
    wget \
    sudo \
    git \
    software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# Node.js 24
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Python 3.12
RUN add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y python3.12 python3.12-dev python3.12-venv python3-pip \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.12 1 \
    && rm -rf /var/lib/apt/lists/*

# Root user (highest privileges), no sandbox user needed
RUN mkdir -p /run/sshd

# Pre-install tscode-server at $HOME/.tscode-server/bin/{commit}
# Note: COPY sources are relative to the build context.
RUN mkdir -p /root/.tscode-server/bin/${TSCODE_COMMIT}
COPY vscode-server-linux-x64/ /root/.tscode-server/bin/${TSCODE_COMMIT}/
RUN chmod +x /root/.tscode-server/bin/${TSCODE_COMMIT}/bin/tscode-server \
    && chmod +x /root/.tscode-server/bin/${TSCODE_COMMIT}/node \
    && find /root/.tscode-server/bin/${TSCODE_COMMIT}/extensions -path '*/bin/*' -type f -exec chmod +x {} +

# sshd: listen on 22 and 8080, allow pubkey auth
RUN sed -i 's/^#Port 22/Port 22\nPort 8080/' /etc/ssh/sshd_config \
    && sed -i 's/^#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/^#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

COPY start-sshd.sh /usr/local/bin/start-sshd.sh
RUN chmod +x /usr/local/bin/start-sshd.sh

EXPOSE 22 8080
CMD ["/usr/local/bin/start-sshd.sh"]
