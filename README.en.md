<div align="center">

# ServerDeck

**Manage your servers from the browser: files, terminal, automation, Docker, storage, and an AI agent, without handing your data to anyone.**

One container. An optional database, on your own server. No agent on the target servers. Just SSH.

[Bahasa Indonesia](README.md) · **English**

</div>

---

## Why ServerDeck?

Server panels usually come at a price: a database that stores your credentials, an agent installed on every server, or a cloud account that holds your whole configuration. ServerDeck takes the opposite approach.

- **Your data stays yours, and you choose where it lives.**
  - **Browser** mode: everything is stored in each user's own browser, with no database and no volume.
  - **Database** mode: pipelines and connections are stored in a single SQLite file **on your own server**, with passwords encrypted using AES-256.
  - In both modes, nothing is sent to any third party, including the makers of ServerDeck.
- **Many servers at once.** One tab, one server: tab 1 connects to server A, tab 2 to server B, and so on, without ever mixing them up.
- **No agent.** The target server only needs SSH. Nothing to install there.
- **An AI agent on your server.** Install [Hermes Agent](https://hermes-agent.nousresearch.com) and give it instructions through chat, right from ServerDeck.
- **Ready in one command.** `docker compose up -d`, open your browser, done.
- **Linux and Windows.** Works with OpenSSH on Linux, and with OpenSSH Server on Windows using cmd.exe or PowerShell.

---

## Features

### 📁 File Manager
Browse folders, search, upload by drag & drop, download, rename, move, delete, and change permissions (`chmod`) visually. A built-in text editor with `Ctrl+S`, plus ready-made templates (Bash, Nginx, Docker Compose, Node.js, HTML).

### 💻 Terminal
A real interactive shell, the same as `ssh user@host`. It is a login shell with a PTY, so the PATH from `~/.bashrc` (npm global, nvm, and the like), aliases, `Tab` completion, `Ctrl+C`, colors, and `cd` all work as usual. Interactive programs work too: setup wizards, `vim`, `top`, and even `sudo` password prompts.

- Opens directly in the folder you have open in the File Manager, with a **cd ke folder ini** button.
- Quick-command shortcuts (`df -h`, `free -m`, `docker ps`) are typed straight into the shell.
- Non-interactive commands (pipelines) use the same PATH as your login shell, so programs such as `node`, `pm2`, or `openclaw` are still found.

### ⚡ Pipelines: n8n-style automation
Chain steps together and run them with one click:

| Step | What it does |
|---|---|
| **Command** | Runs a shell command, with a working directory and timeout |
| **Condition (IF)** | Continues or stops based on the exit code or the output |
| **Write file** | Creates or overwrites a file, including in `/etc` using `sudo` |
| **HTTP check** | Makes sure a service responds with the expected status |
| **Wait** | Pauses before the next step |

- **Variables** `{{DOMAIN}}` and `{{PREV_OUTPUT}}` let one pipeline be reused across many servers or domains.
- **Live status** on every step, expandable output, and a history of the last 10 runs.
- **Safe sudo.** The sudo password is asked for at run time, kept only in memory, sent over stdin (never visible in the process list), and never stored.
- **Ready-made templates:**
  - Add a domain + SSL (Nginx + Certbot)
  - Renew SSL certificates
  - Deploy from Git
  - Clean up disk space
  - Server health check
  - Update Hermes Agent
- **JSON import/export** for backups or sharing with your team.

### 🐳 Docker: Portainer-style, without an agent
Manage Docker on your server over SSH, without installing anything on it:

- **Containers**: a full list with status, Compose stack, image, and ports (click to open them). Start, stop, restart, kill, pause, and remove.
- **Recreate**: Compose containers are recreated from their original compose file. Plain containers are rebuilt from their current configuration, optionally pulling the latest image first.
- **Edit & duplicate**: change the image, ports, volumes, environment, networks, restart policy, resources, and advanced flags, with a live preview of the equivalent `docker run` command. **Safe**: if the new container fails to start or crashes right away, the old container is restored automatically.
- **Details**: overview (status, networking, mounts, masked environment), **live logs**, CPU/memory **stats** with charts, an **interactive console** (`docker exec -it`, bash/sh), and **inspect** JSON.
- **Images & volumes**: pull, remove, and prune unused ones.
- Works with a user in the `docker` group, or through passwordless `sudo`.

### 🤖 Hermes Agent: an AI agent on your server
Manage [Hermes Agent](https://hermes-agent.nousresearch.com) (Nous Research) on the target server, and give it instructions through chat:

- **Chat**: describe what you want in plain language, and Hermes does it on the server using its own tools. Replies stream in live, together with the tools it used. Conversations continue automatically; if a session can no longer be resumed, the chat moves to a new session without you having to retype anything.
- **Safe by default**: approval requests for dangerous commands (deleting files, restarting services) are automatically **denied**. No-approval mode (`--yolo`) is only on when you turn it on yourself. To approve actions one by one, use **Terminal mode**.
- **Install**: the official installer runs in the interactive terminal, so you can answer its questions, including the offer to migrate from OpenClaw.
- **Overview**: `hermes status`, `hermes doctor` with automatic fixes, plus update checks and updates with a backup.
- **Setup**: Nous Portal, model/provider selection, and tools, through wizards in the terminal.
- **Gateway**: start, stop, restart, status, install as a systemd service, and platform setup (Telegram, Discord, Slack, WhatsApp, and more).
- **Live logs** (`gateway.log`, `agent.log`, and others), **configuration** (`config.yaml` in the built-in editor; API keys in `.env` shown masked), and **cron & sessions**.

Hermes is installed and runs **on the target server**, not inside the ServerDeck container. Its config, API keys, and sessions stay in `~/.hermes` on that server.

### 📊 Storage
Capacity for every disk with a *Normal / Almost full / Critical* status, a per-folder usage breakdown you can drill into down to the source, and a search for the largest files. You see right away what is filling up your disk.

### 🗂️ Multi-server
Every browser tab has its own SSH session. Open a new tab for another server; the tab title shows `user@host` so you never mix them up. Disconnecting in one tab does not affect the others.

### 🗄️ Data (database mode)
The **Data** page shows what is in your database: saved connections (passwords are never shown), pipelines, file size, and the status of the encryption key. Remove saved passwords or connections, and download a backup in one click.

---

## Privacy & data security

You choose where data is stored with `STORAGE_MODE`. **In both modes, your data never leaves machines you own.**

| Data | `STORAGE_MODE=browser` (default) | `STORAGE_MODE=database` |
|---|---|---|
| Pipelines, variables, run history | Browser `localStorage` | SQLite on the ServerDeck server. Variables are **encrypted with AES-256-GCM**. |
| Saved connections | `localStorage`: host, port, and username only | SQLite: host, port, username + **encrypted password/private key** (only when web login is enabled) |
| Saved SSH passwords | Not stored | Decrypted only by the server when connecting. **Never sent back to the browser.** |
| sudo password | Browser memory during a run | Browser memory during a run (never stored) |
| Active SSH sessions | ServerDeck process memory, per tab | ServerDeck process memory, per tab |
| Web login | Signed cookie (HMAC) | Signed cookie (HMAC) |
| Hermes chat history | Browser `localStorage`, per server | Browser `localStorage`, per server |
| Hermes config & API keys | `~/.hermes` on the target server | `~/.hermes` on the target server |

**Why encrypted and not hashed?** A hash is one-way, which is right for *checking* a password. An SSH password has to be *reused* to log in to your server, so it is stored encrypted with the `SECURITY_SECRET` key. Without that key, the database contents (including backup files) cannot be read.

Additional safeguards:
- **Optional web login** in front of the SSH login (`SECURITY_ENABLELOGIN`). After 5 failed attempts, login is locked for 5 minutes.
- Cookies are `HttpOnly`, `SameSite=Lax`, and automatically `Secure` when served over HTTPS.
- **Fail-closed.** If login is enabled but no password is set, all access is denied rather than left open.
- SSH passwords can only be saved while web login is enabled, so someone who merely knows your ServerDeck address cannot use saved connections.
- The container runs as a non-root user with `no-new-privileges`.

> **Worth knowing:** while you are connected, the ServerDeck process holds the SSH connection to the target server, and credentials travel from the browser to ServerDeck when you log in. So run ServerDeck on a machine you trust, and **serve it over HTTPS** when it is reachable outside your local network (for example with Nginx + Certbot as a reverse proxy in front of it).

---

## Installation

The official image is on Docker Hub: **[`yuuto999/serverdeck`](https://hub.docker.com/r/yuuto999/serverdeck)** (amd64 & arm64). No need to clone the repository.

### Docker Compose (recommended)

Save this as `docker-compose.yml`:

```yaml
services:
  serverdeck:
    image: yuuto999/serverdeck:latest
    container_name: serverdeck
    ports:
      - '3000:3000'                          # host:container, keep the right number equal to APP_PORT
    volumes:
      - ./serverdeck-data:/data              # Database (pipelines, saved connections)
    environment:
      - APP_PORT=3000                        # App port inside the container
      - SECURITY_ENABLELOGIN=true            # false = no web login (straight to the SSH login)
      - SECURITY_USERNAME=admin              # Web login username
      - SECURITY_PASSWORD=change-this-password # Required when login is enabled
      - SECURITY_SECRET=change-to-a-long-random-string  # openssl rand -hex 32, never change it once in use
      - STORAGE_MODE=database                # or: browser (no volume)
    restart: unless-stopped
```

```bash
docker compose up -d
```

Open `http://localhost:3000`. The database is created automatically at `./serverdeck-data/serverdeck.db` on first start.

**Don't want any data files at all?** Use `STORAGE_MODE=browser` and remove the `volumes:` section. Everything is then kept in each user's browser.

**Change the port**, for example to 8080: set `APP_PORT=8080` and `ports: - '8080:8080'`. Or keep the container on 3000 and change only the left number (`'8080:3000'`).

**Update to the latest version:**

```bash
docker compose pull && docker compose up -d
```

Your data in `./serverdeck-data` is kept across updates. Database schema changes are applied automatically on start.

### Docker run

```bash
docker run -d --name serverdeck \
  -p 3000:3000 \
  -e SECURITY_ENABLELOGIN=true \
  -e SECURITY_USERNAME=admin \
  -e SECURITY_PASSWORD='change-this-password' \
  --restart unless-stopped \
  yuuto999/serverdeck:latest
```

### Build from source

```bash
cp .env.example .env    # fill in SECURITY_PASSWORD
docker compose -f docker-compose.build.yml up -d --build
```

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `APP_PORT` | `3000` | App port inside the container. With Compose, also the port published on the host. |
| `SECURITY_ENABLELOGIN` | `true` | `true`: web login is required before the SSH login. `false`: go straight to the SSH login. |
| `SECURITY_USERNAME` | `admin` | Web login username. |
| `SECURITY_PASSWORD` | *(empty)* | Web login password. **Required** when login is enabled. If empty, all access is denied. |
| `SECURITY_SECRET` | *(random)* | Cookie signing key **and** database encryption key. Use a long random string and **never change it** after saving passwords: saved passwords cannot be decrypted with a different key. If empty, cookies use a random key on every start, and the database uses a key generated automatically at `/data/.secret-key`. |
| `SECURITY_SESSION_HOURS` | `12` | Web login lifetime, in hours. |
| `STORAGE_MODE` | `browser` | `browser`: data in localStorage, no volume. `database`: data in SQLite, requires a volume at `/data`. |
| `DATA_DIR` | `/data` | Database folder for database mode. |

### Accessing the database

The database is a single SQLite file: `./serverdeck-data/serverdeck.db` on the host.

```bash
# Interactive, from the ServerDeck terminal or a regular SSH session (sqlite3 is included in the image)
docker exec -it serverdeck sqlite3 -readonly /data/serverdeck.db

sqlite> .tables
sqlite> SELECT host, port, username, datetime(last_used_at/1000, 'unixepoch') FROM connections;
sqlite> SELECT name, updated_at FROM pipelines;
sqlite> .quit
```

For a single query without entering the prompt (for example in a script or a pipeline step), run it **without `-it`**:

```bash
docker exec serverdeck sqlite3 -readonly -header -column /data/serverdeck.db "SELECT host, username FROM connections;"
```

Or open **Docker → serverdeck container → Console** and run `sqlite3 -readonly /data/serverdeck.db` for an interactive session.

- **Desktop apps:** download a backup from **Data → Download backup** (or copy the file from the `serverdeck-data` folder), then open it with *DB Browser for SQLite*, DBeaver, or TablePlus.
- **Regular backups:** copy the `serverdeck-data` folder together with its `SECURITY_SECRET` value. Without the same key, saved passwords cannot be used on another machine.
- **Encrypted columns:** `secret_enc`, `passphrase_enc`, and `variables_enc` hold AES-256-GCM data and cannot be read without the key.

> Disabling login (`SECURITY_ENABLELOGIN=false`) means anyone who can reach your ServerDeck address can attempt an SSH login. Only do this on a local network or behind another layer of authentication.
