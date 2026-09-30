#!/bin/sh
# Mulai sebagai root hanya untuk menyiapkan folder data, lalu jalankan aplikasi
# sebagai user "node" (tanpa hak root).
set -e

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  if [ "${STORAGE_MODE:-browser}" = "database" ]; then
    mkdir -p "$DATA_DIR"
    # Folder bind mount (./serverdeck-data) dibuat Docker sebagai root: serahkan ke user node.
    chown -R node:node "$DATA_DIR" 2>/dev/null || echo "Peringatan: tidak bisa mengubah pemilik $DATA_DIR" >&2
  fi
  exec su-exec node "$0" "$@"
fi

export PORT="${APP_PORT:-3000}"
exec "$@"
