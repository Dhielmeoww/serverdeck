<div align="center">

# ServerDeck

**Kelola server lewat browser: file, terminal, otomasi, dan storage, tanpa menyerahkan data kamu ke siapa pun.**

Satu container. Tanpa database. Tanpa agent di server tujuan. Cukup SSH.

</div>

---

## Kenapa ServerDeck?

Panel server biasanya meminta imbalan: database untuk menyimpan kredensial, agent yang harus dipasang di setiap server, atau akun cloud yang menyimpan semua konfigurasi kamu. ServerDeck memilih jalan sebaliknya.

- **Nol penyimpanan di server.** ServerDeck tidak punya database dan tidak menulis kredensial, pipeline, maupun riwayat ke disk. Container-nya bahkan tidak butuh volume.
- **Data kembali ke browser masing-masing.** Pipeline, variabel, riwayat run, dan daftar server tersimpan di browser pengguna sendiri. Setiap orang memegang datanya sendiri. Tidak ada yang bisa diintip dari server, karena memang tidak ada yang disimpan di sana.
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

### 📊 Storage
Kapasitas setiap disk dengan status *Normal / Hampir penuh / Kritis*, pembagian pemakaian per folder yang bisa ditelusuri sampai ke sumbernya, dan pencarian file terbesar. Kamu langsung tahu apa yang memenuhi disk.

---

## Privasi & keamanan data

ServerDeck dirancang supaya **tidak ada data yang perlu dipercayakan ke server aplikasi**:

| Data | Disimpan di | Keterangan |
|---|---|---|
| Pipeline, variabel, riwayat run | `localStorage` browser kamu | Tidak pernah dikirim untuk disimpan. Backup dengan Ekspor JSON. |
| Daftar server tersimpan | `localStorage` browser kamu | Hanya host, port, dan username. **Password tidak ikut.** |
| Password / private key SSH | **Tidak disimpan** | Dipakai untuk membuka koneksi, tidak ditulis ke disk atau database. |
| Password sudo | Memori browser selama run | Dikirim lewat stdin, dibuang begitu run selesai. |
| Sesi SSH aktif | Memori proses ServerDeck | Hilang saat disconnect, logout, restart, atau setelah 1 jam tidak aktif. |
| Login web | Cookie bertanda tangan (HMAC) | Tanpa tabel sesi. Mengganti password otomatis membatalkan semua login lama. |

Lapisan pengaman lainnya:
- **Login web opsional** sebelum login SSH (`SECURITY_ENABLELOGIN`). Setelah 5 percobaan gagal, login dikunci 5 menit.
- Cookie `HttpOnly`, `SameSite=Lax`, dan otomatis `Secure` bila diakses lewat HTTPS.
- **Fail-closed.** Bila login diaktifkan tetapi password belum diatur, semua akses ditolak, bukan dibuka.
- Container berjalan sebagai user non-root dengan `no-new-privileges`.

> **Yang perlu dipahami:** selama kamu terhubung, proses ServerDeck memegang koneksi SSH ke server tujuan, dan kredensial dikirim dari browser ke ServerDeck saat login. Jadi jalankan ServerDeck di mesin yang kamu percaya, dan **akses lewat HTTPS** bila dibuka di luar jaringan lokal (lihat [Reverse proxy HTTPS](#reverse-proxy-https)).

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
    environment:
      - APP_PORT=3000                        # Port aplikasi di dalam container
      - SECURITY_ENABLELOGIN=true            # false = tanpa login web (langsung ke login SSH)
      - SECURITY_USERNAME=admin              # Username login web
      - SECURITY_PASSWORD=ganti-password-ini # Wajib diisi bila login aktif
      # - SECURITY_SECRET=                   # Opsional: supaya login tetap berlaku setelah restart
    restart: unless-stopped
```

```bash
docker compose up -d
```

Buka `http://localhost:3000`. Perhatikan tidak ada bagian `volumes:`: ServerDeck memang tidak menyimpan apa pun di server.

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
| `SECURITY_SECRET` | *(acak)* | Kunci tanda tangan cookie. Bila kosong, dibuat acak tiap start, sehingga restart membuat semua orang login ulang. |
| `SECURITY_SESSION_HOURS` | `12` | Masa berlaku login web, dalam jam. |

> Menonaktifkan login (`SECURITY_ENABLELOGIN=false`) berarti siapa pun yang bisa membuka alamat ServerDeck dapat mencoba login SSH. Lakukan ini hanya di jaringan lokal atau di balik autentikasi lain.

### Reverse proxy HTTPS

Contoh Nginx di depan ServerDeck, dengan sertifikat dari Certbot:

```nginx
server {
    listen 443 ssl;
    server_name deck.example.com;

    ssl_certificate     /etc/letsencrypt/live/deck.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/deck.example.com/privkey.pem;

    client_max_body_size 200m;   # batas upload file

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;   # pipeline & perintah panjang
    }
}
```

Header `X-Forwarded-Proto` membuat cookie otomatis bertanda `Secure`.

---

## Contoh pipeline: tambah domain + SSL

File [`examples/pipeline-nginx-ssl.json`](examples/pipeline-nginx-ssl.json) siap di-import lewat **Pipelines → Import**:

1. `sudo nginx -t`: pastikan konfigurasi sekarang sehat
2. Berhenti bila konfigurasi domain sudah ada (aman dijalankan ulang)
3. Cek DNS domain
4. Tulis server block reverse proxy dengan sudo
5. Uji konfigurasi, dan batalkan otomatis bila gagal
6. `sudo certbot --nginx -d <domain>`
7. `sudo systemctl restart nginx`, lalu verifikasi HTTPS

Petunjuk lengkap tersedia di aplikasi: tombol **Petunjuk** di halaman Pipelines.

---

## Publish image ke Docker Hub (maintainer)

Sekali saja, login dengan akun Docker Hub `yuuto999`:

```bash
docker login
```

Lalu build untuk amd64 + arm64 dan upload dengan tag versi dari `package.json` plus `latest`:

```bash
npm run docker:publish                       # Windows (PowerShell)
./scripts/publish-docker.sh                  # Linux / macOS / Git Bash
./scripts/publish-docker.sh 1.2.0            # tag versi tertentu
```

Otomatis via GitHub Actions: workflow [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) mem-publish setiap tag `v*` (mis. `git tag v1.2.0 && git push --tags`). Tambahkan secrets repo `DOCKERHUB_USERNAME` dan `DOCKERHUB_TOKEN`.

---

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # build produksi ke ./dist
npm run start      # jalankan hasil build
npx astro check    # type check
```

Untuk mencoba login web saat development, buat `.env` dari `.env.example`.

---

## Tech stack

- [Astro](https://astro.build) (SSR) dengan `@astrojs/node`
- [`ssh2`](https://github.com/mscdex/ssh2) untuk SSH & SFTP
- Tailwind CSS v4
- Tanpa database, tanpa framework frontend berat
