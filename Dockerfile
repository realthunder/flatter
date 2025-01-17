# SPDX-License-Identifier: CC0-1.0
# SPDX-FileCopyrightText: No rights reserved

FROM registry.fedoraproject.org/fedora:latest

# Notes:
#   - docker:          docker/setup-qemu-action
#   - flatpak-builder: Backport fix for flatpak/flatpak-builder#495
#   - python3-*:       flatpak/flatpak-external-data-checker
#   - rsync:           JamesIves/github-pages-deploy-action
#   - zstd:            actions/cache
RUN dnf install -y 'dnf-command(copr)' && \
    dnf copr -y enable andyholmes/main && \
    dnf install -y ccache \
                   dbus-daemon \
                   docker \
                   flatpak \
                   flatpak-builder \
                   git \
                   git-lfs \
                   python3-{aiohttp,apt,editorconfig,github,gobject,jsonschema,lxml,packaging,pyelftools,ruamel-yaml,semver,toml} \
                   rsync \
                   xorg-x11-server-Xvfb \
                   zstd && \
    dnf clean all && rm -rf /var/cache/dnf

RUN git clone https://github.com/flathub/flatpak-external-data-checker.git \
              --branch master \
              --single-branch && \
    ln -sf $(pwd)/flatpak-external-data-checker/flatpak-external-data-checker \
           /usr/bin/flatpak-external-data-checker

RUN flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo && \
    flatpak remote-add --if-not-exists gnome-nightly https://nightly.gnome.org/gnome-nightly.flatpakrepo
