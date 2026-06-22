# SAFAR — Smart Assisted Field & Adventure Registry

> **TravelTogether × Garuda Safety** — a unified platform for travel group management and tourist safety monitoring.

> 🏆 **Built for Hackathon 4.0** at **SRMS College of Engineering & Technology, Bareilly**

---

## Overview

**SAFAR** is a full-stack web application built with Python Flask that brings together two integrated sub-systems:

| Sub-system | Purpose |
|---|---|
| 🧭 **TravelTogether** | Create and join travel groups, plan destinations, and chat in real time |
| 🛡️ **Garuda Safety** | Register tourists, track GPS locations, enforce geo-fences, detect anomalies, and trigger emergency alerts |

Optional add-ons include IoT device tracking (Arduino + Blynk), SMS notifications (Twilio), and a blockchain audit layer.

---

## Tech Stack

### Backend
| Technology | Version | Role |
|---|---|---|
| **Python** | 3.11 | Runtime |
| **Flask** | 3.0.3 | Web framework |
| **Flask-SocketIO** | 5.4.1 | Real-time WebSocket events |
| **Flask-SQLAlchemy** | 3.1.1 | ORM / database abstraction |
| **python-socketio** | 5.11.2 | Socket.IO protocol layer |
| **python-engineio** | 4.9.1 | Engine.IO transport |
| **simple-websocket** | 1.0.0 | WebSocket transport (threading mode) |
| **Gunicorn** | 23.0.0 | Production WSGI server (gthread worker) |
| **python-dotenv** | 1.0.1 | Environment variable management |

### Database
| Technology | Role |
|---|---|
| **PostgreSQL** (via Supabase) | Primary production database |
| **pg8000** ≥ 1.31.2 | Pure-Python PostgreSQL adapter |
| **SQLite** | Local fallback (optional, `ALLOW_SQLITE_FALLBACK=1`) |

### Frontend
| Technology | Role |
|---|---|
| **HTML5 / Jinja2 Templates** | Server-rendered pages |
| **Vanilla CSS / JS** | Styling and client-side logic |
| **WebSockets (Socket.IO)** | Real-time group chat |
| **i18n / Translator modules** | Multi-language support |

### External Services
| Service | Purpose |
|---|---|
| **Supabase** | Managed PostgreSQL database + connection pooling |
| **Twilio** | SMS-based OTP verification and emergency alerts *(optional)* |
| **Blynk** | IoT device communication for GPS trackers *(optional)* |
| **Cloudflare Tunnel** | Secure HTTPS tunneling for local/edge deployments |

### IoT / Hardware
| Component | Role |
|---|---|
| **Arduino** | GPS tracker firmware (`iot_device/safar_tracker.ino`) |
| **pyserial** 3.5 | USB serial bridge between Arduino and server |

### DevOps & Deployment
| Tool | Role |
|---|---|
| **Docker** | Containerisation (multi-stage build, Python 3.11-slim) |
| **Render** | PaaS deployment target (`render.yaml`, `Procfile`) |
| **Coolify** | Self-hosted deployment target (Dockerfile) |
| **Gunicorn** | Production WSGI server with gthread workers |

---

## Features

- 🔐 **Authentication** — Registration, login, and OTP verification (Twilio SMS or console fallback)
- 🗺️ **Travel Groups** — Create / join groups, manage destinations, invite members
- 💬 **Real-time Chat** — In-group messaging powered by WebSockets
- 📍 **Safety Tracking** — Tourist registration, live GPS tracking, safety zone monitoring
- 🚨 **Anomaly Detection** — Automatic alerts on suspicious movement patterns
- 🛠️ **Admin Dashboard** — Platform-wide controls and monitoring
- ⛓️ **Blockchain Layer** — Optional data integrity audit trail
- 📡 **IoT Integration** — Blynk-connected Arduino GPS tracker
- 🌐 **Multi-language** — Built-in i18n with per-page translator modules

---

## Project Structure

```text
SAFAR-1/
├── app.py                    # Main Flask application & all route handlers
├── database.py               # DB initialisation, connection logic, fallback
├── requirements.txt          # Python dependencies
├── Dockerfile                # Multi-stage Docker build (Coolify)
├── Procfile                  # Render process file
├── render.yaml               # Render deployment config
├── render_build.sh           # Render build script
├── cloudflared_config.yml    # Cloudflare Tunnel config
│
├── templates/                # Jinja2 HTML templates
│   ├── index.html
│   ├── auth.html
│   ├── groups.html
│   ├── group_chat.html
│   ├── travel.html
│   ├── user_dashboard.html
│   ├── admin_dashboard.html
│   ├── profile.html
│   └── blockchain.html
│
├── static/                   # CSS, JS, images, i18n modules
│   ├── images/
│   ├── translators/          # Per-page i18n translation modules
│   └── *.css / *.js
│
├── iot_device/
│   └── safar_tracker.ino     # Arduino GPS tracker firmware
│
└── tools/
    └── dictionary_agent.py   # AI-powered dictionary agent
```

---

## Quick Start

### Prerequisites

- Python 3.11+
- A [Supabase](https://supabase.com) project (or local PostgreSQL)
- *(Optional)* Twilio account for SMS OTP
- *(Optional)* Blynk account for IoT tracking

### 1. Clone & Install

```bash
git clone https://github.com/your-org/SAFAR-1.git
cd SAFAR-1
pip install -r requirements.txt
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
# ── Core ──────────────────────────────────────────────────────────────────────
SECRET_KEY=your_flask_secret_key
ALLOW_UNSAFE_WERKZEUG=1
HOST=127.0.0.1
PORT=5050

# ── Database ──────────────────────────────────────────────────────────────────
REQUIRE_REMOTE_DB=1
ALLOW_SQLITE_FALLBACK=0
DATABASE_URL=postgresql+pg8000://postgres.<project-ref>:<password>@aws-<region>.pooler.supabase.com:5432/postgres
DB_CONNECT_TIMEOUT=20

# ── Twilio (optional) ─────────────────────────────────────────────────────────
# If omitted, OTPs are printed to the console instead of being sent via SMS.
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# ── Blynk / IoT (optional) ────────────────────────────────────────────────────
# If omitted, the IoT polling loop is disabled.
BLYNK_AUTH_TOKEN=your_blynk_token
```

### 3. Run Locally

```bash
python app.py
```

Open [http://127.0.0.1:5050](http://127.0.0.1:5050) in your browser.

---

## Deployment

### Render

The repository ships with a `render.yaml` and `Procfile` ready to go.

**Start command:**
```bash
gunicorn --worker-class gthread --threads 100 --bind 0.0.0.0:$PORT app:app
```

**Required environment variables:**
- `SECRET_KEY`
- `DATABASE_URL`

### Docker / Coolify

```bash
# Build
docker build -t safar .

# Run
docker run -p 8000:8000 \
  -e SECRET_KEY=changeme \
  -e DATABASE_URL=postgresql+pg8000://... \
  safar
```

The `Dockerfile` uses a multi-stage build to keep the final image lean (Python 3.11-slim base).

---

## API Reference

| Prefix | Area |
|---|---|
| `/api/auth/...` | Registration, login, logout |
| `/api/otp/...` | OTP generation & verification |
| `/api/tt/...` | TravelTogether — groups & destinations |
| `/api/safety/...` | Garuda Safety — tracking & alerts |
| `/api/admin/...` | Admin controls |

---

## Notes

- Special characters in the database password are fully supported via URL encoding in `DATABASE_URL`.
- SQLite fallback is available for local development only (`ALLOW_SQLITE_FALLBACK=1`). **Do not enable in production.**
- If Twilio is not configured, OTPs are printed to the server console — useful for development.
- The IoT polling loop is only active when `BLYNK_AUTH_TOKEN` is set (either in `.env` or per-user in the database).

---

## License

This project is proprietary. All rights reserved by the SAFAR team.
