<div align="center">

# ServerDeck

**Kelola server lewat browser: file, terminal, otomasi, Docker, dan storage, tanpa menyerahkan data kamu ke siapa pun.**

Satu container. Database opsional, di servermu sendiri. Tanpa agent di server tujuan. Cukup SSH.

**Bahasa Indonesia** · [English](README.en.md)

</div>

---

## Kenapa ServerDeck?

Panel server biasanya meminta imbalan: database untuk menyimpan kredensial, agent yang harus dipasang di setiap server, atau akun cloud yang menyimpan semua konfigurasi kamu. ServerDeck memilih jalan sebaliknya.

- **Data tetap milikmu, kamu yang pilih tempatnya.**
  - Mode **browser**: semua tersimpan di browser masing-masing, tanpa database dan tanpa volume.
  - Mode **database**: pipeline dan koneksi tersimpan di satu file SQLite **di server milikmu sendiri**, dengan password terenkripsi AES-256.
  - Di kedua mode, tidak ada yang dikirim ke pihak ketiga, termasuk ke pembuat ServerDeck.
- **Banyak server sekaligus.** Satu tab satu server: tab 1 ke server A, tab 2 ke server B, dan seterusnya, tanpa saling tertukar.
- **Tanpa agent.** Server tujuan cukup punya SSH. Tidak ada yang perlu di-install di sana.
- **Siap dalam satu perintah.** `docker compose up -d`, buka browser, selesai.
- **Linux dan Windows.** Mendukung OpenSSH di Linux, dan OpenSSH Server Windows dengan shell cmd.exe atau PowerShell.

---

## Fitur

### 📁 File Manager
Jelajahi folder, cari, upload dengan drag & drop, download, rename, pindahkan, hapus, dan ubah izin akses (`chmod`) secara visual. Editor teks bawaan dengan `Ctrl+S`, lengkap dengan template siap pakai (Bash, Nginx, Docker Compose, Node.js, HTML).

### 💻 Terminal
Jalankan perintah langsung di folder yang sedang dibuka, dengan riwayat perintah (↑/↓) dan shortcut cepat. Perintah yang menunggu input tidak akan menggantung: ada batas waktu dan penanganan `sudo` yang jelas.

### ⚡ Pipelines: otomasi ala n8n
Susun rangkaian langkah lalu jalankan dengan satu klik:

| Langkah | Fungsi |
|---|---|
| **Command** | Jalankan perintah shell, dengan folder kerja dan timeout |
| **Kondisi (IF)** | Lanjut atau berhenti berdasarkan exit code atau isi output |
| **Tulis file** | Buat atau timpa file, termasuk ke `/etc` dengan `sudo` |
| **HTTP check** | Pastikan layanan merespons dengan status yang benar |
| **Tunggu** | Jeda sebelum langkah berikutnya |

- **Variabel** `{{DOMAIN}}` dan `{{PREV_OUTPUT}}` supaya satu pipeline bisa dipakai ulang untuk banyak server atau domain.
- **Status langsung** di setiap langkah, output yang bisa dibuka, dan riwayat 10 run terakhir.
- **sudo yang aman.** Password sudo diminta saat run, hanya ada di memori, dikirim lewat stdin (tidak terlihat di daftar proses), dan tidak pernah disimpan.
- **Template siap pakai:**
  - Tambah domain + SSL (Nginx + Certbot)
  - Perpanjang sertifikat SSL
  - Deploy dari Git
  - Bersihkan disk
  - Cek kesehatan server
- **Import/Export JSON** untuk backup atau berbagi dengan tim.

### 🐳 Docker: ala Portainer, tanpa agent
Kelola Docker di server lewat SSH, tanpa memasang apa pun di server:

- **Container**: daftar lengkap dengan status, stack Compose, image, dan port (klik untuk membuka). Aksi start, stop, restart, kill, pause, hapus.
- **Recreate**: container Compose di-recreate lewat file compose aslinya. Container biasa dibuat ulang dari konfigurasinya, opsional dengan pull image terbaru.
- **Edit & duplikat**: ubah image, port, volume, environment, network, restart policy, resource, dan flag lanjutan, lengkap dengan pratinjau perintah `docker run`. **Aman**: bila container baru gagal dibuat atau langsung crash, container lama dikembalikan otomatis.
- **Detail**: ringkasan (status, jaringan, mount, environment tersamar), **logs live**, **stats** CPU/memori dengan grafik, **console interaktif** (`docker exec -it`, bash/sh), dan **inspect** JSON.
- **Image & volume**: pull, hapus, dan bersihkan yang tidak terpakai.
- Bekerja dengan user di grup `docker`, atau lewat `sudo` tanpa password.

### 📊 Storage
Kapasitas setiap disk dengan status *Normal / Hampir penuh / Kritis*, pembagian pemakaian per folder yang bisa ditelusuri sampai ke sumbernya, dan pencarian file terbesar. Kamu langsung tahu apa yang memenuhi disk.

### 🗂️ Multi-server
Setiap tab browser punya sesi SSH sendiri. Buka tab baru untuk server lain; judul tab menunjukkan `user@host` supaya tidak tertukar. Disconnect di satu tab tidak memengaruhi tab lain.

### 🗄️ Data (mode database)
Halaman **Data** menampilkan isi database: koneksi tersimpan (tanpa pernah menampilkan password), pipeline, ukuran file, dan status kunci enkripsi. Hapus password tersimpan atau koneksi, dan unduh backup dengan satu klik.

---

## Privasi & keamanan data

Kamu memilih di mana data disimpan lewat `STORAGE_MODE`. **Di kedua mode, data tidak pernah meninggalkan mesin milikmu.**

| Data | `STORAGE_MODE=browser` (bawaan) | `STORAGE_MODE=database` |
|---|---|---|
| Pipeline, variabel, riwayat run | `localStorage` browser | SQLite di server ServerDeck. Variabel **terenkripsi AES-256-GCM**. |
| Koneksi tersimpan | `localStorage`: host, port, username saja | SQLite: host, port, username + **password/private key terenkripsi** (hanya bila login web aktif) |
| Password SSH yang tersimpan | Tidak disimpan | Dibuka hanya oleh server saat konek. **Tidak pernah dikirim balik ke browser.** |
| Password sudo | Memori browser selama run | Memori browser selama run (tidak pernah disimpan) |
| Sesi SSH aktif | Memori proses ServerDeck, per tab | Memori proses ServerDeck, per tab |
| Login web | Cookie bertanda tangan (HMAC) | Cookie bertanda tangan (HMAC) |

**Kenapa dienkripsi, bukan di-hash?** Hash itu satu arah dan cocok untuk *mengecek* password. Password SSH perlu *dipakai ulang* untuk login ke server, jadi disimpan terenkripsi dengan kunci `SECURITY_SECRET`. Tanpa kunci itu, isi database (termasuk file backup) tidak bisa dibaca.

Lapisan pengaman lainnya:
- **Login web opsional** sebelum login SSH (`SECURITY_ENABLELOGIN`). Setelah 5 percobaan gagal, login dikunci 5 menit.
- Cookie `HttpOnly`, `SameSite=Lax`, dan otomatis `Secure` bila diakses lewat HTTPS.
- **Fail-closed.** Bila login diaktifkan tetapi password belum diatur, semua akses ditolak, bukan dibuka.
- Password SSH hanya boleh disimpan bila login web aktif, sehingga orang yang sekadar tahu alamat ServerDeck tidak bisa memakai koneksi tersimpan.
- Container berjalan sebagai user non-root dengan `no-new-privileges`.

> **Yang perlu dipahami:** selama kamu terhubung, proses ServerDeck memegang koneksi SSH ke server tujuan, dan kredensial dikirim dari browser ke ServerDeck saat login. Jadi jalankan ServerDeck di mesin yang kamu percaya, dan **akses lewat HTTPS** bila dibuka di luar jaringan lokal (misalnya dengan Nginx + Certbot sebagai reverse proxy di depannya).

---

## Instalasi

Image resmi tersedia di Docker Hub: **[`yuuto999/serverdeck`](https://hub.docker.com/r/yuuto999/serverdeck)** (amd64 & arm64). Tidak perlu clone repository.

### Docker Compose (disarankan)

Simpan sebagai `docker-compose.yml`:

```yaml
services:
  serverdeck:
    image: yuuto999/serverdeck:latest
    container_name: serverdeck
    ports:
      - '3000:3000'                          # host:container, samakan angka kanan dengan APP_PORT
    volumes:
      - ./serverdeck-data:/data              # Database (pipeline, koneksi tersimpan)
    environment:
      - APP_PORT=3000                        # Port aplikasi di dalam container
      - SECURITY_ENABLELOGIN=true            # false = tanpa login web (langsung ke login SSH)
      - SECURITY_USERNAME=admin              # Username login web
      - SECURITY_PASSWORD=ganti-password-ini # Wajib diisi bila login aktif
      - SECURITY_SECRET=ganti-string-acak-panjang  # openssl rand -hex 32, jangan diubah setelah dipakai
      - STORAGE_MODE=database                # atau: browser (tanpa volume)
    restart: unless-stopped
```

```bash
docker compose up -d
```

Buka `http://localhost:3000`. Database dibuat otomatis di `./serverdeck-data/serverdeck.db` saat pertama kali jalan.

**Tidak mau ada file data sama sekali?** Pakai `STORAGE_MODE=browser` dan hapus bagian `volumes:`. Semua tersimpan di browser masing-masing.

**Ganti port**, misalnya ke 8080: ubah `APP_PORT=8080` dan `ports: - '8080:8080'`. Atau biarkan container di 3000 dan ubah angka kiri saja (`'8080:3000'`).

**Update ke versi terbaru:**

```bash
docker compose pull && docker compose up -d
```

### Docker run

```bash
docker run -d --name serverdeck \
  -p 3000:3000 \
  -e SECURITY_ENABLELOGIN=true \
  -e SECURITY_USERNAME=admin \
  -e SECURITY_PASSWORD='ganti-password-ini' \
  --restart unless-stopped \
  yuuto999/serverdeck:latest
```

### Build dari source

```bash
cp .env.example .env    # isi SECURITY_PASSWORD
docker compose -f docker-compose.build.yml up -d --build
```

### Konfigurasi

| Variabel | Bawaan | Fungsi |
|---|---|---|
| `APP_PORT` | `3000` | Port aplikasi di dalam container. Di Compose, juga port yang dibuka di host. |
| `SECURITY_ENABLELOGIN` | `true` | `true`: wajib login web sebelum login SSH. `false`: langsung ke login SSH. |
| `SECURITY_USERNAME` | `admin` | Username login web. |
| `SECURITY_PASSWORD` | *(kosong)* | Password login web. **Wajib** bila login aktif. Kosong berarti semua akses ditolak. |
| `SECURITY_SECRET` | *(acak)* | Kunci tanda tangan cookie **dan** kunci enkripsi database. Isi string acak panjang dan **jangan diubah** setelah menyimpan password: password tersimpan tidak bisa dibuka dengan kunci lain. Bila kosong, cookie memakai kunci acak tiap start, dan database memakai kunci yang dibuat otomatis di `/data/.secret-key`. |
| `SECURITY_SESSION_HOURS` | `12` | Masa berlaku login web, dalam jam. |
| `STORAGE_MODE` | `browser` | `browser`: data di localStorage, tanpa volume. `database`: data di SQLite, butuh volume di `/data`. |
| `DATA_DIR` | `/data` | Folder database untuk mode database. |

### Mengakses database

Database adalah satu file SQLite: `./serverdeck-data/serverdeck.db` di host.

```bash
# Interaktif lewat SSH biasa (sqlite3 sudah ada di image)
docker exec -it serverdeck sqlite3 -readonly /data/serverdeck.db

sqlite> .tables
sqlite> SELECT host, port, username, datetime(last_used_at/1000, 'unixepoch') FROM connections;
sqlite> SELECT name, updated_at FROM pipelines;
sqlite> .quit
```

Dari terminal bawah ServerDeck (tidak interaktif, tanpa TTY), jalankan satu query per perintah **tanpa `-it`**:

```bash
docker exec serverdeck sqlite3 -readonly -header -column /data/serverdeck.db "SELECT host, username FROM connections;"
```

Atau pakai **Docker → container serverdeck → Console**, lalu jalankan `sqlite3 -readonly /data/serverdeck.db` untuk mode interaktif.

- **Aplikasi desktop:** unduh backup dari halaman **Data → Unduh backup** (atau salin file dari folder `serverdeck-data`), lalu buka dengan *DB Browser for SQLite*, DBeaver, atau TablePlus.
- **Backup rutin:** salin folder `serverdeck-data` beserta nilai `SECURITY_SECRET`-nya. Tanpa kunci yang sama, password tersimpan tidak bisa dipakai di mesin lain.
- **Kolom terenkripsi:** `secret_enc`, `passphrase_enc`, dan `variables_enc` berisi data AES-256-GCM, jadi tidak terbaca tanpa kunci.

> Menonaktifkan login (`SECURITY_ENABLELOGIN=false`) berarti siapa pun yang bisa membuka alamat ServerDeck dapat mencoba login SSH. Lakukan ini hanya di jaringan lokal atau di balik autentikasi lain.
