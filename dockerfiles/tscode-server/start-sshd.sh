#!/bin/bash
set -e

mkdir -p /run/sshd

SSH_USER="${SSH_USER:-root}"
PUBKEY="${TSCode_SSH_PUBKEY:-}"

if [[ -n "$PUBKEY" ]]; then
    HOME_DIR="$(eval echo "~${SSH_USER}")"
    mkdir -p "${HOME_DIR}/.ssh"
    chmod 700 "${HOME_DIR}/.ssh"
    touch "${HOME_DIR}/.ssh/authorized_keys"
    chmod 600 "${HOME_DIR}/.ssh/authorized_keys"
    grep -qF "$PUBKEY" "${HOME_DIR}/.ssh/authorized_keys" || echo "$PUBKEY" >> "${HOME_DIR}/.ssh/authorized_keys"
    chown -R "${SSH_USER}:${SSH_USER}" "${HOME_DIR}/.ssh"
fi

if [[ ! -f /etc/ssh/ssh_host_rsa_key ]]; then
    ssh-keygen -A
fi

# Cloud mode marker for the TestAgent plugin: environment variable is picked up
# by the SSH session (Ubuntu pam_env reads /etc/environment), and the marker
# file is a 100% reliable fallback when env propagation fails.
echo 'TESTAGENT_CLOUD_MODE=1' >> /etc/environment
touch /etc/tscode-cloud-mode

exec /usr/sbin/sshd -D -e
