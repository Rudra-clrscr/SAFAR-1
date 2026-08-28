"""
app.py – Combined Backend
  Project 1 : TravelTogether  (groups, destinations, group chat)
  Project 2 : Astra Safety    (tourist tracking, geo-fencing, anomalies)

Run locally:
    pip install -r requirements.txt
    python app.py
"""

import os, re, sys, uuid, hashlib, threading, time, random, requests
from types import SimpleNamespace
from datetime import datetime, timedelta
from math import radians, sin, cos, sqrt, atan2

# Ensure local modules (for example database.py) resolve even in restricted path mode.
PROJECT_ROOT = os.path.abspath(os.path.dirname(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# Windows terminals in this project path can default to cp1252 and crash on emoji logs.
for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name, None)
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, join_room, leave_room, emit
from werkzeug.utils import secure_filename

try:
    from database import (
        db,
        User, Destination, Group, GroupMember, GroupMessage,
        Tourist, SafetyZone, Alert, Anomaly, BlockchainBlock,
        generate_id
    )
except ModuleNotFoundError as exc:
    if exc.name in {"flask_sqlalchemy", "sqlalchemy"}:
        print("\n[Startup Error] Missing database dependency:", exc.name)
        print("Current Python executable:", sys.executable)
        print("This usually happens when app is launched from a new USB environment.")
        print("Prepare local dependencies and run from project directory:")
        print(r"  1) .\fix_install.bat")
        print(r"  2) .\run_usb.bat")
    raise

# ─────────────────────────────────────────────
# APP SETUP
# ─────────────────────────────────────────────

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'change_me_in_production')

DATABASE_URL = (os.environ.get('DATABASE_URL') or '').strip()

# Fix Render's 'postgres://' prefix and ensure pg8000 driver is used
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+pg8000://", 1)
elif DATABASE_URL.startswith("postgresql://") and "+pg8000" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+pg8000://", 1)

# Handle SSL parameters for pg8000
connect_args = {}
if "pg8000" in DATABASE_URL:
    import ssl
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    connect_args['ssl_context'] = ssl_context
    connect_args['timeout'] = float(os.environ.get("DB_CONNECT_TIMEOUT", "10"))  # seconds

    # Strip sslmode from URL if present (redundant with connect_args)
    if "sslmode=" in DATABASE_URL:
        DATABASE_URL = re.sub(r'[?&]sslmode=[^&]+', '', DATABASE_URL)

from sqlalchemy import create_engine, text, inspect, func
from sqlalchemy.exc import (
    DBAPIError, OperationalError, InterfaceError, IntegrityError, PendingRollbackError,
)
from sqlalchemy.pool import NullPool

# Try primary URL, then auto-fallback 6543 -> 5432 if needed
SQLITE_URL = 'sqlite:///' + os.path.join(
    os.path.abspath(os.path.dirname(__file__)), 'instance', 'safar_local.db'
)
require_remote_db = os.environ.get("REQUIRE_REMOTE_DB", "0") == "1"
allow_sqlite_fallback = os.environ.get("ALLOW_SQLITE_FALLBACK", "1") == "1"

chosen_url = DATABASE_URL
db_connection_ready = True
using_sqlite = False

def _redact_db_url(url: str) -> str:
    """Strip credentials before a connection string ever hits logs."""
    return re.sub(r'://([^:/@]+):[^@]*@', r'://\1:***@', url)


def _try_connect(url: str) -> bool:
    """One-shot connection probe so we can gracefully fall back."""
    opts = {'connect_args': connect_args, 'poolclass': NullPool} if 'pg8000' in url else {}
    engine = create_engine(url, **opts)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except (OperationalError, InterfaceError, TypeError, ValueError) as e:
        print(f"[DB] Connection failed for {_redact_db_url(url)}: {e}")
        return False
    except Exception as e:
        print(f"[DB] Unexpected connection failure for {_redact_db_url(url)}: {e}")
        return False
    finally:
        engine.dispose()

# Only probe when explicitly allowed (skip during certain unit tests)
# USE_SQLITE=1 forces local mode immediately
_user_provided_db = bool(DATABASE_URL)
if os.environ.get("USE_SQLITE", "0") == "1":
    db_connection_ready = False   # will trigger SQLite below
elif not _user_provided_db:
    if require_remote_db:
        raise RuntimeError(
            "DATABASE_URL is missing. Set the full PostgreSQL connection string in .env."
        )
    db_connection_ready = False
elif os.environ.get("DB_PROBE", "1") == "1":
    db_connection_ready = _try_connect(chosen_url)
    if not db_connection_ready and ":6543/" in chosen_url:
        fallback_url = chosen_url.replace(":6543/", ":5432/")
        if _try_connect(fallback_url):
            print("[DB] Falling back to Supabase direct port 5432 with SSL.")
            chosen_url = fallback_url
            db_connection_ready = True
    if (
        not db_connection_ready
        and ".supabase.co" in chosen_url
        and ".pooler.supabase.com" not in chosen_url
    ):
        print(
            "[DB] Supabase on Render should usually use the shared pooler host "
            "(*.pooler.supabase.com) instead of db.<project-ref>.supabase.co."
        )
else:
    # DB_PROBE=0 with a user-provided DATABASE_URL -> trust the configured DB.
    db_connection_ready = True

# ── SQLite fallback when all remote DBs fail ──
if not db_connection_ready:
    if require_remote_db or not allow_sqlite_fallback:
        raise RuntimeError(
            "Database connection failed. Update DATABASE_URL with the current "
            "Supabase pooler connection string and database password."
        )
    print("[DB] Remote DB unavailable; falling back to local SQLite.")
    connect_args = {}
    using_sqlite = True
    db_connection_ready = True
    try:
        os.makedirs(os.path.join(os.path.abspath(os.path.dirname(__file__)), 'instance'), exist_ok=True)
        chosen_url = SQLITE_URL
    except OSError:
        # Deploy filesystem is read-only (e.g. serverless platforms) — use /tmp instead.
        import tempfile
        chosen_url = 'sqlite:///' + os.path.join(tempfile.gettempdir(), 'safar_local.db')

app.config['SQLALCHEMY_DATABASE_URI'] = chosen_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['DB_CONNECTION_READY'] = db_connection_ready

if using_sqlite:
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {}
else:
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'connect_args': connect_args,
        'poolclass': NullPool,
    }

db.init_app(app)
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')

# Supabase Auth (email verification codes)
SUPABASE_URL      = (os.environ.get('SUPABASE_URL') or '').rstrip('/')
SUPABASE_KEY      = os.environ.get('SUPABASE_KEY') or ''
SUPABASE_AUTH_URL = f"{SUPABASE_URL}/auth/v1" if SUPABASE_URL else ''
SUPABASE_AUTH_ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)
# Escape hatch for demos: print verification codes to the log instead of
# emailing them, sidestepping the built-in sender's 2-per-hour ceiling.
EMAIL_CODES_TO_CONSOLE = (os.environ.get('EMAIL_CODES_TO_CONSOLE') or '').strip().lower() in {'1', 'true', 'yes', 'on'}
# When the sender refuses outright, hand the code to the caller on screen
# rather than dead-ending. Turns email verification into a formality, so it
# stays off unless a demo explicitly asks for it.
DEMO_CODE_FALLBACK = (os.environ.get('DEMO_CODE_FALLBACK') or '').strip().lower() in {'1', 'true', 'yes', 'on'}
# How long a server-side "this email is verified" grant survives (minutes).
EMAIL_VERIFICATION_GRANT_MINUTES = 30
translation_cache = {}
TRANSLATION_PROVIDER = "google-gtx-public"
TRANSLATION_URL = "https://translate.googleapis.com/translate_a/single"
SUPPORTED_TRANSLATION_LANGS = {"en", "hi", "sa"}
GROUP_UPLOAD_DIR = os.path.join(PROJECT_ROOT, 'static', 'uploads', 'groups')
GROUP_UPLOAD_PREFIX = '/static/uploads/groups/'
GROUP_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}
GROUP_MESSAGE_UPLOAD_DIR = os.path.join(PROJECT_ROOT, 'static', 'uploads', 'group_messages')
GROUP_MESSAGE_UPLOAD_PREFIX = '/static/uploads/group_messages/'
GROUP_DOCUMENT_EXTENSIONS = {
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.txt', '.csv', '.rtf', '.zip'
}
MAX_GROUP_ATTACHMENT_BYTES = 12 * 1024 * 1024
GROUP_LOCAL_COVERS = {
    'goa': '/static/images/dest_goa.png',
    'jaipur': '/static/images/dest_jaipur.png',
    'kerala': '/static/images/dest_kerala.png',
    'manali': '/static/images/dest_manali.png',
    'varanasi': '/static/images/dest_varanasi.png',
}
GROUP_SCENIC_COVERS = [
    '/static/images/dest_manali.png',
    '/static/images/dest_jaipur.png',
    '/static/images/dest_kerala.png',
    '/static/images/dest_goa.png',
    '/static/images/dest_varanasi.png',
    '/static/images/hero_bg.png',
]
GROUP_DESTINATION_COVERS = {
    'goa': GROUP_LOCAL_COVERS['goa'],
    'beach': GROUP_LOCAL_COVERS['goa'],
    'coast': GROUP_LOCAL_COVERS['goa'],
    'kerala': GROUP_LOCAL_COVERS['kerala'],
    'alappuzha': GROUP_LOCAL_COVERS['kerala'],
    'alleppey': GROUP_LOCAL_COVERS['kerala'],
    'houseboat': GROUP_LOCAL_COVERS['kerala'],
    'backwater': GROUP_LOCAL_COVERS['kerala'],
    'jaipur': GROUP_LOCAL_COVERS['jaipur'],
    'udaipur': GROUP_LOCAL_COVERS['jaipur'],
    'rajasthan': GROUP_LOCAL_COVERS['jaipur'],
    'heritage': GROUP_LOCAL_COVERS['jaipur'],
    'palace': GROUP_LOCAL_COVERS['jaipur'],
    'agra': GROUP_LOCAL_COVERS['jaipur'],
    'manali': GROUP_LOCAL_COVERS['manali'],
    'shimla': GROUP_LOCAL_COVERS['manali'],
    'fort': GROUP_LOCAL_COVERS['manali'],
    'trek': GROUP_LOCAL_COVERS['manali'],
    'adventure': GROUP_LOCAL_COVERS['manali'],
    'hill': GROUP_LOCAL_COVERS['manali'],
    'mountain': GROUP_LOCAL_COVERS['manali'],
    'rishikesh': '/static/images/hero_bg.png',
    'yoga': '/static/images/hero_bg.png',
    'ganges': '/static/images/dest_varanasi.png',
    'hampi': '/static/images/dest_jaipur.png',
    'ruins': '/static/images/dest_jaipur.png',
    'varanasi': GROUP_LOCAL_COVERS['varanasi'],
    'ghat': GROUP_LOCAL_COVERS['varanasi'],
    'spiritual': GROUP_LOCAL_COVERS['varanasi'],
    'temple': GROUP_LOCAL_COVERS['varanasi'],
}
GROUP_PLACEHOLDER_THEMES = ('saffron', 'teal', 'lotus', 'sand', 'indigo')


def database_unavailable_response():
    message = (
        "Database is temporarily unavailable. Check DATABASE_URL. "
        "On Render, use the Supabase shared pooler connection string from the "
        "Supabase dashboard."
    )
    if request.path.startswith('/api/'):
        return jsonify({'error': message}), 503
    return message, 503


# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return hashlib.sha256(plain.encode()).hexdigest()


def validate_password(password: str):
    if len(password) < 6:
        return False, "Password must be at least 6 characters."
    if not re.search(r'[a-zA-Z]', password):
        return False, "Password must contain at least one letter."
    if not re.search(r'\d', password):
        return False, "Password must contain at least one number."
    if not re.search(r'[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>/?]', password):
        return False, "Password must contain at least one special character."
    return True, "OK"


def validate_email(email: str) -> bool:
    return "@" in email and "." in email.split("@")[-1]


def haversine(lat1, lon1, lat2, lon2) -> float:
    """Returns distance in km between two GPS coordinates."""
    R = 6371
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def get_current_user():
    """Returns the logged-in User object or None."""
    uid = session.get('user_id')
    return db.session.get(User, uid) if uid else None


def get_current_tourist():
    """Returns Tourist linked to the current session or None."""
    uid = session.get('user_id')
    if not uid:
        return None
    return Tourist.query.filter_by(user_id=uid).first()


def find_or_create_destination(name: str) -> str | None:
    if not name or not name.strip():
        return None
    clean = name.strip().title()
    dest = Destination.query.filter_by(name=clean).first()
    if dest:
        return dest.id
    dest = Destination(id=generate_id(), name=clean)
    db.session.add(dest)
    db.session.commit()
    return dest.id


def ensure_group_schema():
    """Backfill group and chat UI fields for existing SQLite/Postgres databases."""
    try:
        inspector = inspect(db.engine)
        if 'groups' not in inspector.get_table_names():
            return

        columns = {col['name'] for col in inspector.get_columns('groups')}
        if 'cover_image' not in columns:
            with db.engine.begin() as conn:
                conn.execute(text("ALTER TABLE groups ADD COLUMN cover_image VARCHAR(255)"))

        if 'group_messages' in inspector.get_table_names():
            message_columns = {col['name'] for col in inspector.get_columns('group_messages')}
            missing_columns = {
                'message_type': "ALTER TABLE group_messages ADD COLUMN message_type VARCHAR(20)",
                'attachment_name': "ALTER TABLE group_messages ADD COLUMN attachment_name VARCHAR(255)",
                'attachment_url': "ALTER TABLE group_messages ADD COLUMN attachment_url VARCHAR(255)",
                'attachment_mime': "ALTER TABLE group_messages ADD COLUMN attachment_mime VARCHAR(120)",
                'attachment_size': "ALTER TABLE group_messages ADD COLUMN attachment_size INTEGER",
                'location_snapshot': "ALTER TABLE group_messages ADD COLUMN location_snapshot VARCHAR(255)",
            }
            statements = [sql for name, sql in missing_columns.items() if name not in message_columns]
            if statements:
                with db.engine.begin() as conn:
                    for statement in statements:
                        conn.execute(text(statement))
    except Exception as exc:
        print(f"[DB] Warning: could not verify groups schema extras: {exc}")


def ensure_user_schema():
    """Backfill the email_verified flag for databases created before it existed."""
    try:
        inspector = inspect(db.engine)
        if 'users' not in inspector.get_table_names():
            return

        columns = {col['name'] for col in inspector.get_columns('users')}
        if 'email_verified' not in columns:
            with db.engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE"
                ))
    except Exception as exc:
        print(f"[DB] Warning: could not verify users schema extras: {exc}")


def save_group_cover_upload(file_storage) -> str | None:
    if not file_storage or not getattr(file_storage, 'filename', ''):
        return None

    filename = secure_filename(file_storage.filename)
    ext = os.path.splitext(filename)[1].lower()
    if ext not in GROUP_IMAGE_EXTENSIONS:
        return None

    os.makedirs(GROUP_UPLOAD_DIR, exist_ok=True)
    stored_name = f"group_{uuid.uuid4().hex}{ext}"
    file_storage.save(os.path.join(GROUP_UPLOAD_DIR, stored_name))
    return f"{GROUP_UPLOAD_PREFIX}{stored_name}"


def save_group_document_upload(file_storage) -> dict | None:
    if not file_storage or not getattr(file_storage, 'filename', ''):
        return None

    original_name = secure_filename(file_storage.filename)
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in GROUP_DOCUMENT_EXTENSIONS:
        return None

    try:
        file_storage.stream.seek(0, os.SEEK_END)
        size = file_storage.stream.tell()
        file_storage.stream.seek(0)
    except Exception:
        size = 0

    if size and size > MAX_GROUP_ATTACHMENT_BYTES:
        raise ValueError('File is too large. Please upload a document under 12 MB.')

    os.makedirs(GROUP_MESSAGE_UPLOAD_DIR, exist_ok=True)
    stored_name = f"message_{uuid.uuid4().hex}{ext}"
    file_storage.save(os.path.join(GROUP_MESSAGE_UPLOAD_DIR, stored_name))
    return {
        'name': original_name,
        'url': f"{GROUP_MESSAGE_UPLOAD_PREFIX}{stored_name}",
        'mime': getattr(file_storage, 'mimetype', None),
        'size': size or None,
    }


def _pick_group_cover_theme(seed_text: str) -> str:
    if not seed_text:
        return GROUP_PLACEHOLDER_THEMES[0]
    index = sum(ord(char) for char in seed_text) % len(GROUP_PLACEHOLDER_THEMES)
    return GROUP_PLACEHOLDER_THEMES[index]


def _pick_seeded_cover(options: list[str], seed_text: str) -> str:
    if not options:
        return ''
    index = sum(ord(char) for char in (seed_text or 'safar')) % len(options)
    return options[index]


def resolve_destination_cover_url(*parts: str | None) -> str:
    haystack = " ".join(filter(None, parts)).lower()
    for keyword, cover in GROUP_DESTINATION_COVERS.items():
        if keyword in haystack:
            return cover
    return _pick_seeded_cover(GROUP_SCENIC_COVERS, haystack or 'safar')


def resolve_group_cover(group: Group) -> dict:
    seed_text = group.id or group.name or (group.destination.name if group.destination else '') or 'safar'

    if group.cover_image:
        return {
            'url': group.cover_image,
            'mode': 'uploaded',
            'theme': _pick_group_cover_theme(seed_text),
        }

    haystack = " ".join(filter(None, [
        group.name,
        group.description,
        group.destination.name if group.destination else None,
    ])).lower()

    for keyword, cover in GROUP_DESTINATION_COVERS.items():
        if keyword in haystack:
            return {
                'url': cover,
                'mode': 'destination',
                'theme': _pick_group_cover_theme(seed_text),
            }

    return {
        'url': _pick_seeded_cover(GROUP_SCENIC_COVERS, seed_text),
        'mode': 'scenic',
        'theme': _pick_group_cover_theme(seed_text),
    }


def resolve_group_cover_url(group: Group) -> str:
    cover = resolve_group_cover(group)
    return cover['url'] or ''


def format_file_size(size_bytes: int | None) -> str:
    if not size_bytes:
        return ''
    if size_bytes < 1024:
        return f"{size_bytes} B"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes / (1024 * 1024):.1f} MB"


def parse_location_snapshot(raw_location: str | None) -> dict | None:
    if not raw_location:
        return None

    raw_text = str(raw_location).strip()
    if not raw_text or raw_text.lower() == 'not available':
        return None

    patterns = (
        r'Lat:\s*([-+]?\d+(?:\.\d+)?)\s*,\s*Lon:\s*([-+]?\d+(?:\.\d+)?)',
        r'^\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*$',
    )
    for pattern in patterns:
        match = re.search(pattern, raw_text, flags=re.IGNORECASE)
        if match:
            latitude = float(match.group(1))
            longitude = float(match.group(2))
            return {
                'label': f"{latitude:.5f}, {longitude:.5f}",
                'latitude': latitude,
                'longitude': longitude,
                'maps_url': f"https://www.google.com/maps?q={latitude},{longitude}",
                'raw': raw_text,
            }

    return {
        'label': raw_text,
        'latitude': None,
        'longitude': None,
        'maps_url': None,
        'raw': raw_text,
    }


def parse_coordinate_pair(raw_text: str | None) -> tuple[float, float] | None:
    if not raw_text:
        return None

    match = re.search(
        r'([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)',
        str(raw_text),
    )
    if not match:
        return None

    try:
        return float(match.group(1)), float(match.group(2))
    except ValueError:
        return None


def build_google_maps_directions_url(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    travel_mode: str = 'driving',
) -> str:
    mode = travel_mode if travel_mode in {'driving', 'walking', 'bicycling', 'transit'} else 'driving'
    return (
        "https://www.google.com/maps/dir/?api=1"
        f"&origin={origin_lat},{origin_lon}"
        f"&destination={dest_lat},{dest_lon}"
        f"&travelmode={mode}"
    )


def _nominatim_search(term: str, *, limit: int = 5, near: tuple[float, float] | None = None) -> list[dict]:
    """One Nominatim call. `near` biases results toward the traveller."""
    params = {
        'q': term,
        'format': 'jsonv2',
        'limit': limit,
        'addressdetails': 1,
        'extratags': 1,
    }
    if near:
        # A ~2.2 degree box around the traveller (roughly 240 km) is wide enough
        # for an intercity trip while still demoting a same-named place abroad.
        lat, lon = near
        params['viewbox'] = f'{lon - 1.1},{lat + 1.1},{lon + 1.1},{lat - 1.1}'
        params['bounded'] = 0

    try:
        response = requests.get(
            'https://nominatim.openstreetmap.org/search',
            params=params,
            headers={
                'User-Agent': 'SAFAR-Tourist-Navigation/1.0',
                'Accept-Language': 'en',
            },
            timeout=8,
        )
        if not response.ok:
            return []
        return response.json() or []
    except Exception:
        return []


# Nominatim hands back everything from a country polygon to a single bench.
# Places a traveller actually types get pulled to the front; administrative
# polygons (whose centroid is rarely where anyone wants to be dropped) sink.
_GEOCODE_CLASS_WEIGHT = {
    'place': 1.00,
    'tourism': 0.95,
    'historic': 0.92,
    'amenity': 0.85,
    'leisure': 0.80,
    'natural': 0.78,
    'railway': 0.75,
    'aeroway': 0.75,
    'shop': 0.60,
    'building': 0.55,
    'highway': 0.45,
    'boundary': 0.30,
}
_GEOCODE_TYPE_WEIGHT = {
    'city': 1.00,
    'town': 0.95,
    'village': 0.85,
    'suburb': 0.80,
    'attraction': 0.95,
    'museum': 0.90,
    'administrative': 0.35,
}


def _geocode_score(item: dict, query: str, near: tuple[float, float] | None) -> float:
    """Rank one Nominatim hit: prominence, kind of place, then proximity."""
    try:
        importance = float(item.get('importance') or 0.0)
    except (TypeError, ValueError):
        importance = 0.0

    klass = (item.get('class') or '').lower()
    kind = (item.get('type') or '').lower()
    score = importance * 2.0
    score *= _GEOCODE_CLASS_WEIGHT.get(klass, 0.7)
    score *= _GEOCODE_TYPE_WEIGHT.get(kind, 1.0)

    # An exact name match beats a longer string that merely contains the query.
    name = (item.get('name') or '').strip().lower()
    normalized = re.sub(r'\s+', ' ', (query or '').lower()).strip()
    if name and name == normalized:
        score += 0.8
    elif name and normalized and normalized in name:
        score += 0.25

    if near:
        try:
            distance_km = haversine(near[0], near[1], float(item['lat']), float(item['lon']))
            # Gentle: a place 500 km away is still reachable, one 5000 km away is
            # almost certainly the wrong continent's namesake.
            score += max(0.0, 1.2 - (distance_km / 1200.0))
        except (TypeError, ValueError, KeyError):
            pass

    return score


def _geocode_candidate(item: dict) -> dict | None:
    try:
        latitude = float(item.get('lat'))
        longitude = float(item.get('lon'))
    except (TypeError, ValueError):
        return None

    display = item.get('display_name') or ''
    address = item.get('address') or {}
    # "Jaipur, Rajasthan, India" reads better than the 9-part display_name.
    short_parts = [
        item.get('name') or display.split(',')[0].strip(),
        address.get('state_district') or address.get('county'),
        address.get('state'),
        address.get('country'),
    ]
    seen: set[str] = set()
    label_parts: list[str] = []
    for part in short_parts:
        part = (part or '').strip()
        if part and part.lower() not in seen:
            seen.add(part.lower())
            label_parts.append(part)

    return {
        'label': ', '.join(label_parts) or display,
        'full_label': display,
        'latitude': latitude,
        'longitude': longitude,
        'category': f"{item.get('class') or ''}/{item.get('type') or ''}".strip('/'),
        'source': 'geocoded',
    }


def geocode_candidates(
    query: str,
    near: tuple[float, float] | None = None,
    limit: int = 5,
) -> list[dict]:
    """Ranked geocoding hits for a free-text place, best first."""
    raw_query = (query or '').strip()
    if not raw_query:
        return []

    normalized_query = re.sub(r'\s+', ' ', raw_query.lower()).strip()
    search_terms = [raw_query]
    if 'india' not in normalized_query:
        search_terms.append(f'{raw_query}, India')

    scored: list[tuple[float, dict]] = []
    seen_points: set[tuple[float, float]] = set()
    seen_labels: set[str] = set()
    for term in search_terms:
        for item in _nominatim_search(term, limit=limit, near=near):
            candidate = _geocode_candidate(item)
            if not candidate:
                continue
            key = (round(candidate['latitude'], 4), round(candidate['longitude'], 4))
            label_key = candidate['label'].strip().lower()
            if key in seen_points or label_key in seen_labels:
                continue
            seen_points.add(key)
            seen_labels.add(label_key)
            scored.append((_geocode_score(item, raw_query, near), candidate))
        # The plain query already produced strong hits; skip the ", India" retry.
        if scored:
            break

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [candidate for _, candidate in scored[:limit]]


def photon_suggestions(
    query: str,
    near: tuple[float, float] | None = None,
    limit: int = 6,
) -> list[dict]:
    """
    Type-ahead place suggestions.

    Nominatim only matches whole words — "hawa mah" returns nothing — so the
    search box talks to Photon, which is built for partial input and takes the
    same keyless, no-account terms.
    """
    raw_query = (query or '').strip()
    if len(raw_query) < 3:
        return []

    params = {'q': raw_query, 'limit': max(limit * 2, 10), 'lang': 'en'}
    if near:
        params['lat'] = near[0]
        params['lon'] = near[1]

    try:
        response = requests.get(
            'https://photon.komoot.io/api/',
            params=params,
            headers={'User-Agent': 'SAFAR-Tourist-Navigation/1.0'},
            timeout=6,
        )
        if not response.ok:
            return []
        features = (response.json() or {}).get('features') or []
    except Exception:
        return []

    suggestions: list[dict] = []
    seen: set[str] = set()
    for feature in features:
        props = feature.get('properties') or {}
        coordinates = (feature.get('geometry') or {}).get('coordinates') or []
        if len(coordinates) < 2:
            continue

        name = (props.get('name') or '').strip()
        if not name:
            continue

        # Photon returns raw OSM landuse polygons alongside real places; a
        # residential estate named after a monument is never the search intent.
        if props.get('osm_key') in {'landuse', 'boundary'}:
            continue

        context_parts = [
            props.get('city') or props.get('district') or props.get('county'),
            props.get('state'),
            props.get('country'),
        ]
        label_parts = [name] + [part for part in context_parts if part]
        label = ', '.join(dict.fromkeys(label_parts))

        key = label.lower()
        if key in seen:
            continue
        seen.add(key)

        suggestions.append({
            'label': label,
            'full_label': ', '.join(dict.fromkeys(
                [name] + [p for p in [props.get('street'), props.get('city'), props.get('county'),
                                      props.get('state'), props.get('postcode'), props.get('country')] if p]
            )),
            'latitude': float(coordinates[1]),
            'longitude': float(coordinates[0]),
            'category': f"{props.get('osm_key') or ''}/{props.get('osm_value') or ''}".strip('/'),
            'source': 'photon',
        })
        if len(suggestions) >= limit:
            break

    return suggestions


def resolve_navigation_destination(
    query: str,
    near: tuple[float, float] | None = None,
) -> dict | None:
    raw_query = (query or '').strip()
    if not raw_query:
        return None

    coord_pair = parse_coordinate_pair(raw_query)
    if coord_pair:
        latitude, longitude = coord_pair
        return {
            'label': f"{latitude:.5f}, {longitude:.5f}",
            'latitude': latitude,
            'longitude': longitude,
            'source': 'coordinates',
        }

    normalized_query = re.sub(r'\s+', ' ', raw_query.lower()).strip()
    zones = SafetyZone.query.all()
    for zone in zones:
        zone_name = re.sub(r'\s+', ' ', (zone.name or '').lower()).strip()
        if not zone_name:
            continue
        if zone_name == normalized_query or zone_name in normalized_query or normalized_query in zone_name:
            return {
                'label': zone.name,
                'latitude': zone.latitude,
                'longitude': zone.longitude,
                'source': 'safety_zone',
            }

    destination = Destination.query.filter(func.lower(Destination.name) == normalized_query).first()
    if destination and destination.safety_zones:
        zone = destination.safety_zones[0]
        return {
            'label': zone.name or destination.name,
            'latitude': zone.latitude,
            'longitude': zone.longitude,
            'source': 'destination_zone',
        }

    candidates = geocode_candidates(raw_query, near=near)
    if not candidates:
        return None

    best = dict(candidates[0])
    # Anything else worth offering the traveller as "did you mean".
    best['alternatives'] = candidates[1:]
    return best


# The public OSRM demo server (router.project-osrm.org) only hosts the *car*
# profile: its /walking and /cycling endpoints return the identical car route
# at car speed. FOSSGIS runs one instance per real profile, so each travel mode
# gets a router that actually understands it (one-ways, footpaths, cycleways).
OSRM_PROFILES = {
    'driving': [
        ('https://routing.openstreetmap.de/routed-car', 'driving', 'osrm-car'),
        ('https://router.project-osrm.org', 'driving', 'osrm-demo'),
    ],
    'walking': [
        ('https://routing.openstreetmap.de/routed-foot', 'foot', 'osrm-foot'),
    ],
    'cycling': [
        ('https://routing.openstreetmap.de/routed-bike', 'bike', 'osrm-bike'),
    ],
}


def _osrm_instruction(step: dict) -> str:
    maneuver = step.get('maneuver') or {}
    step_name = step.get('name') or ''
    modifier = maneuver.get('modifier') or ''
    step_type = maneuver.get('type') or ''

    if step_type == 'depart':
        return f"Start on {step_name}" if step_name else 'Start your trip'
    if step_type == 'arrive':
        return 'Arrive at your destination'
    if step_type in {'roundabout', 'rotary', 'roundabout turn'}:
        exit_no = maneuver.get('exit')
        road_name = f"onto {step_name}" if step_name else ''
        # OSRM omits the exit number on small roundabouts; "take exit None" is
        # worse than no number at all.
        if exit_no:
            return f"At the roundabout, take exit {exit_no} {road_name}".strip()
        return f"At the roundabout, continue {road_name}".strip() if road_name else 'Continue through the roundabout'
    if step_type == 'turn':
        direction = f"{modifier} turn".strip()
        return f"Make a {direction} onto {step_name}" if step_name else f"Make a {direction}"
    if step_type == 'merge':
        return f"Merge onto {step_name}" if step_name else 'Merge ahead'
    if step_type in {'continue', 'new name'}:
        return f"Continue on {step_name}" if step_name else 'Continue straight'
    if step_name:
        return f"Follow {step_name}"
    return step_type.replace('_', ' ').title() if step_type else 'Continue'


def _osrm_steps(route: dict) -> list[dict]:
    steps_payload = []
    for leg in route.get('legs') or []:
        for step in leg.get('steps') or []:
            maneuver = step.get('maneuver') or {}
            location = maneuver.get('location') or []
            steps_payload.append({
                'instruction': _osrm_instruction(step),
                'distance_m': step.get('distance'),
                'duration_s': step.get('duration'),
                'mode': step.get('mode'),
                'name': step.get('name') or '',
                'type': maneuver.get('type') or '',
                'modifier': maneuver.get('modifier') or '',
                'latitude': float(location[1]) if len(location) >= 2 else None,
                'longitude': float(location[0]) if len(location) >= 2 else None,
                'geometry': ((step.get('geometry') or {}).get('coordinates')) or [],
            })
    return steps_payload


def fetch_navigation_route(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    travel_mode: str = 'driving',
    include_steps: bool = True,
) -> dict | None:
    mode = travel_mode if travel_mode in OSRM_PROFILES else 'driving'

    for host, profile, provider in OSRM_PROFILES[mode]:
        route_url = f'{host}/route/v1/{profile}/{origin_lon},{origin_lat};{dest_lon},{dest_lat}'
        try:
            response = requests.get(
                route_url,
                params={
                    'overview': 'full',
                    'geometries': 'geojson',
                    'steps': 'true' if include_steps else 'false',
                    # Alternatives cost nothing extra and let the UI say how much
                    # a second option would add.
                    'alternatives': 'true' if mode == 'driving' else 'false',
                },
                timeout=12,
            )
            if not response.ok:
                continue

            payload = response.json() or {}
            routes = payload.get('routes') or []
            if not routes:
                continue

            route = routes[0]
            coordinates = (route.get('geometry') or {}).get('coordinates') or []
            if not coordinates:
                continue

            alternatives = []
            for alternative in routes[1:3]:
                alt_coords = (alternative.get('geometry') or {}).get('coordinates') or []
                if not alt_coords:
                    continue
                alternatives.append({
                    'distance_m': alternative.get('distance'),
                    'duration_s': alternative.get('duration'),
                    'coordinates': alt_coords,
                })

            return {
                'provider': provider,
                'profile': profile,
                'distance_m': route.get('distance'),
                'duration_s': route.get('duration'),
                'coordinates': coordinates,
                'steps': _osrm_steps(route) if include_steps else [],
                'alternatives': alternatives,
            }
        except Exception:
            continue

    return None


def serialize_group_card(group: Group, member_ids: set[str]) -> dict:
    owner = db.session.get(User, group.owner_id)
    cover = resolve_group_cover(group)
    destination_name = group.destination.name if group.destination else None
    group_initial = (group.name[:1] or 'S').upper()
    owner_initial = (owner.username[:1] if owner and owner.username else 'O').upper()
    destination_initial = (destination_name[:1] if destination_name else 'I').upper()

    return {
        'group_id': group.id,
        'group_name': group.name,
        'group_description': group.description,
        'group_type': group.group_type,
        'owner_id': group.owner_id,
        'owner_name': owner.username if owner else 'Unknown',
        'destination_name': destination_name,
        'member_count': group.member_count,
        'max_members': group.max_members,
        'is_member': group.id in member_ids,
        'cover_image': group.cover_image,
        'cover_url': cover['url'],
        'cover_mode': cover['mode'],
        'cover_theme': cover['theme'],
        'created_at': group.created_at,
        'created_at_label': group.created_at.strftime('%d %b %Y') if group.created_at else '',
        'story_initials': [group_initial, owner_initial, destination_initial],
    }


def serialize_group_member_row(
    membership: GroupMember,
    user: User,
    tourist_map: dict[str, Tourist] | None = None,
    include_location: bool = False,
) -> dict:
    tourist = tourist_map.get(user.id) if tourist_map else None
    location = parse_location_snapshot(tourist.last_known_location if tourist else None) if include_location else None
    return {
        'user_id': user.id,
        'username': user.username,
        'email': user.email,
        'role': membership.role,
        'joined_at': membership.joined_at.isoformat() if membership.joined_at else None,
        'location': location,
    }


def serialize_group_message(message: GroupMessage) -> dict:
    location = parse_location_snapshot(message.location_snapshot)
    message_type = (message.message_type or 'text').lower()
    sender_name = message.sender.username if message.sender else 'System / Panic'
    return {
        'id': message.id,
        'sender': sender_name,
        'sender_name': sender_name,
        'sender_id': message.sender_id,
        'message': message.message or '',
        'message_type': message_type,
        'timestamp': (message.timestamp or datetime.now()).isoformat(),
        'timestamp_label': (message.timestamp or datetime.now()).strftime('%H:%M'),
        'attachment_name': message.attachment_name,
        'attachment_url': message.attachment_url,
        'attachment_mime': message.attachment_mime,
        'attachment_size': message.attachment_size,
        'attachment_size_label': format_file_size(message.attachment_size),
        'location_snapshot': message.location_snapshot,
        'location': location,
        'has_attachment': bool(message.attachment_url),
        'is_sos': message_type == 'sos',
    }


def build_group_message(
    *,
    group_id: str,
    sender_id: str,
    text: str = '',
    message_type: str = 'text',
    attachment: dict | None = None,
    location_snapshot: str | None = None,
) -> GroupMessage:
    payload = GroupMessage(
        group_id=group_id,
        sender_id=sender_id,
        message=text or '',
        message_type=message_type,
        location_snapshot=location_snapshot,
    )
    if attachment:
        payload.attachment_name = attachment.get('name')
        payload.attachment_url = attachment.get('url')
        payload.attachment_mime = attachment.get('mime')
        payload.attachment_size = attachment.get('size')
    db.session.add(payload)
    return payload


def emit_group_message(message: GroupMessage):
    socketio.emit('new_message', serialize_group_message(message), room=message.group_id)


def serialize_group_details(group: Group, current_user: User | None) -> dict:
    cover = resolve_group_cover(group)
    approved_rows = (
        db.session.query(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .filter(GroupMember.group_id == group.id, GroupMember.join_status == 'Approved')
        .all()
    )
    tourist_ids = [user.id for _, user in approved_rows]
    tourist_map = {}
    if tourist_ids:
        tourist_map = {
            tourist.user_id: tourist
            for tourist in Tourist.query.filter(Tourist.user_id.in_(tourist_ids)).all()
        }

    is_member = bool(current_user and any(user.id == current_user.id for _, user in approved_rows))
    members = [
        serialize_group_member_row(member, user, tourist_map=tourist_map, include_location=is_member)
        for member, user in approved_rows
    ]
    member_locations = [
        {
            'user_id': item['user_id'],
            'username': item['username'],
            'role': item['role'],
            'location': item['location'],
        }
        for item in members
        if is_member and item['user_id'] != (current_user.id if current_user else None) and item['location']
    ]

    owner = db.session.get(User, group.owner_id)
    return {
        'id': group.id,
        'name': group.name,
        'description': group.description or '',
        'type': group.group_type,
        'owner_id': group.owner_id,
        'owner_name': owner.username if owner else 'Unknown',
        'destination': group.destination.name if group.destination else None,
        'member_count': group.member_count,
        'max_members': group.max_members,
        'cover_image': group.cover_image,
        'cover_url': cover['url'],
        'cover_mode': cover['mode'],
        'cover_theme': cover['theme'],
        'is_member': is_member,
        'members': members,
        'member_locations': member_locations,
    }


def create_group_sos_messages(user: User, tourist: Tourist, alert_label: str) -> list[GroupMessage]:
    memberships = GroupMember.query.filter_by(user_id=user.id, join_status='Approved').all()
    if not memberships:
        return []

    recent_cutoff = datetime.now() - timedelta(seconds=8)
    created_messages: list[GroupMessage] = []
    for membership in memberships:
        recent_existing = (
            GroupMessage.query
            .filter(
                GroupMessage.group_id == membership.group_id,
                GroupMessage.sender_id == user.id,
                GroupMessage.message_type == 'sos',
                GroupMessage.timestamp >= recent_cutoff,
            )
            .first()
        )
        if recent_existing:
            continue

        created_messages.append(build_group_message(
            group_id=membership.group_id,
            sender_id=user.id,
            text=f"SOS triggered by {user.username} via {alert_label}. Immediate attention required.",
            message_type='sos',
            location_snapshot=tourist.last_known_location,
        ))

    return created_messages


def trigger_hardware_sos(tourist, source_label='HARDWARE Panic', map_url=None):
    """
    Unified handler for physical and website SOS alerts.
    Increases reliability by ensuring all channels (SocketIO, Database, Group Chat) are signaled.
    """
    # 1. Real-time UI notification (Admin Dashboard flashy alert)
    socketio.emit('hardware_sos_triggered', {
        'tourist_id': tourist.id,
        'tourist_name': tourist.name,
        'source': source_label
    }, namespace='/')
    
    # 2. Database records
    location_text = tourist.last_known_location
    if map_url:
        # If the device sends a custom Google Maps Link, prioritize it or append it
        if "Map:" not in (location_text or ""):
            location_text = f"{location_text or 'Unknown'} | Visual: {map_url}"
        
    db.session.add(Alert(tourist_id=tourist.id, location=location_text, alert_type=f'Panic ({source_label})'))
    
    # Check for existing active anomaly to prevent redundant entries in very short time
    ten_sec_ago = datetime.now() - timedelta(seconds=10)
    existing = Anomaly.query.filter(
        Anomaly.tourist_id == tourist.id, 
        Anomaly.status == 'active',
        Anomaly.timestamp > ten_sec_ago
    ).first()
    
    if not existing:
        db.session.add(Anomaly(
            tourist_id=tourist.id, 
            anomaly_type='Hardware SOS', 
            description=f'SOS button press detected via {source_label}.', 
            status='active'
        ))
    
    # 3. Drop safety score to critical
    tourist.safety_score = 0
    
    # 4. Notify travel groups (Auto-post to squad chats)
    linked_user = db.session.get(User, tourist.user_id) if tourist.user_id else None
    if linked_user:
        sos_messages = create_group_sos_messages(linked_user, tourist, source_label)
        for msg in sos_messages:
            try:
                emit_group_message(msg)
            except Exception as err:
                print(f"[SOS Helper] Group message emit warning: {err}")
    
    db.session.commit()
    print(f"[SOS Helper] 🚨 Unified SOS Triggered for {tourist.name} (UID: {tourist.user_id}) via {source_label}")


def normalize_translation_lang(lang: str | None) -> str:
    lang = (lang or "en").strip().lower()
    return lang if lang in SUPPORTED_TRANSLATION_LANGS else "en"


def normalize_translation_text(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def translate_text_online(text: str, source: str, target: str) -> str:
    response = requests.get(
        TRANSLATION_URL,
        params={
            "client": "gtx",
            "sl": source,
            "tl": target,
            "dt": "t",
            "q": text,
        },
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    if not payload or not payload[0]:
        return text
    return "".join(part[0] for part in payload[0] if part and part[0]).strip() or text


@app.errorhandler(OperationalError)
@app.errorhandler(InterfaceError)
@app.errorhandler(DBAPIError)
# Postgres poisons a session after a failed flush, so every later query in that
# request raises PendingRollbackError rather than a DBAPIError. SQLite never
# does this, which is why it only ever surfaced as a 500 on Render.
@app.errorhandler(PendingRollbackError)
def handle_database_error(error):
    db.session.rollback()
    print(f"[DB] Request failed: {error}")
    return database_unavailable_response()


# ─────────────────────────────────────────────
# ANOMALY DETECTION (Astra)
# ─────────────────────────────────────────────

def check_for_anomalies():
    """Flags tourists inactive or exhibiting abnormal patterns using Isolation Forest."""
    with app.app_context():
        now = datetime.now()
        active = Tourist.query.filter(Tourist.visit_end_date > now).all()
        if not active:
            return

        CRITICAL_SEC = 1200   # 20 min fallback
        WARNING_SEC  = 600    # 10 min fallback
        ten_ago = now - timedelta(minutes=10)

        data = []
        for t in active:
            idle_seconds = (now - t.last_updated_at).total_seconds() if t.last_updated_at else 0
            score = t.safety_score
            data.append([idle_seconds, score])

        if len(data) >= 3:
            try:
                from sklearn.ensemble import IsolationForest
                import numpy as np
                X = np.array(data)
                clf = IsolationForest(n_estimators=100, contamination=0.1, random_state=42)
                preds = clf.fit_predict(X)
                
                for idx, t in enumerate(active):
                    if preds[idx] == -1:  # Anomaly detected by Isolation Forest
                        recent = Anomaly.query.filter(
                            Anomaly.tourist_id == t.id,
                            Anomaly.timestamp > ten_ago
                        ).first()
                        if not recent:
                            idle_min = data[idx][0] / 60
                            desc = f"AI Detected (Isolation Forest): Idle {idle_min:.1f}m, Score: {data[idx][1]}"
                            db.session.add(Anomaly(tourist_id=t.id, anomaly_type="AI Behavioral Anomaly", description=desc))
            except ImportError:
                print("Missing scikit-learn for Isolation Forest, using fallback.")

        # Fallback for simple inactivity
        for t in active:
            if t.last_updated_at is None:
                continue
            idle = (now - t.last_updated_at).total_seconds()

            if idle > CRITICAL_SEC:
                atype = "Critical Inactivity (20+ min)"
            elif idle > WARNING_SEC:
                atype = "Warning Inactivity (10+ min)"
            else:
                continue

            recent = Anomaly.query.filter(
                Anomaly.tourist_id == t.id,
                Anomaly.timestamp > ten_ago
            ).first()

            if not recent:
                desc = f"Last update was {idle / 60:.1f} minutes ago."
                db.session.add(Anomaly(tourist_id=t.id, anomaly_type=atype, description=desc))

        db.session.commit()


# ─────────────────────────────────────────────
# INITIAL DATA SEED
# ─────────────────────────────────────────────

def seed_safety_zones():
    if SafetyZone.query.count() > 0:
        return
    zones = [
        # High-alert
        SafetyZone(name='High-Alert: Zone near LoC',                    latitude=34.5266, longitude=74.4735, radius=30,  regional_score=5),
        SafetyZone(name='High-Risk: Remote Southern Valley (J&K)',      latitude=33.7294, longitude=74.83,   radius=25,  regional_score=15),
        SafetyZone(name='High-Alert: India-China Border (Northeast)',   latitude=27.9881, longitude=88.825,  radius=40,  regional_score=10),
        # Tourist risk
        SafetyZone(name='Paharganj Area, Delhi',                        latitude=28.6439, longitude=77.2124, radius=20,  regional_score=45),
        SafetyZone(name='Baga Beach Area (Night), Goa',                 latitude=15.5562, longitude=73.7547, radius=30,  regional_score=55),
        SafetyZone(name='Isolated Ghats, Varanasi',                     latitude=25.282,  longitude=82.9563, radius=50,  regional_score=60),
        # North India
        SafetyZone(name='Leh City, Ladakh',                             latitude=34.165,  longitude=77.5771, radius=120, regional_score=95),
        SafetyZone(name="Lutyens' Delhi",                               latitude=28.6139, longitude=77.209,  radius=50,  regional_score=98),
        SafetyZone(name='Pink City, Jaipur',                            latitude=26.9124, longitude=75.7873, radius=40,  regional_score=90),
        SafetyZone(name='Golden Temple, Amritsar',                      latitude=31.62,   longitude=74.8765, radius=20,  regional_score=96),
        SafetyZone(name='Taj Mahal Complex, Agra',                      latitude=27.1751, longitude=78.0421, radius=20,  regional_score=98),
        SafetyZone(name='Hazratganj, Lucknow',                          latitude=26.8467, longitude=80.9462, radius=20,  regional_score=88),
        SafetyZone(name='Bareilly Cantt',                               latitude=28.349,  longitude=79.426,  radius=4,   regional_score=99),
        # South India
        SafetyZone(name='Hitech City, Hyderabad',                       latitude=17.4435, longitude=78.3519, radius=50,  regional_score=92),
        SafetyZone(name='Munnar Tea Gardens, Kerala',                   latitude=10.0889, longitude=77.0595, radius=50,  regional_score=88),
        # East India
        SafetyZone(name='Park Street, Kolkata',                         latitude=22.5529, longitude=88.3542, radius=50,  regional_score=87),
        SafetyZone(name='Bodh Gaya, Bihar',                             latitude=24.6961, longitude=84.9912, radius=50,  regional_score=92),
    ]
    db.session.bulk_save_objects(zones)
    db.session.commit()
    print("Seeded safety zones.")


# ─────────────────────────────────────────────
# ════════════════════════════════════════════
#  PAGE ROUTES
# ════════════════════════════════════════════
# ─────────────────────────────────────────────

@app.route('/')
def index():
    user = get_current_user()
    return render_template('index.html', username=user.username if user else None)

# --- Auth pages ---
@app.route('/register')
def register_page():
    return redirect(url_for('auth_page', register=1))

@app.route('/login')
def login_page():
    return redirect(url_for('auth_page'))

@app.route('/auth')
def auth_page():
    return render_template('auth.html')

# --- TravelTogether pages ---
@app.route('/groups', methods=['GET'])
def groups_page():
    user = get_current_user()
    if not user:
        return redirect(url_for('auth_page'))

    all_groups = Group.query.order_by(Group.created_at.desc()).all()
    my_member_ids = {m.group_id for m in user.memberships} if user.memberships else set()
    groups = [serialize_group_card(group, my_member_ids) for group in all_groups]

    dests = Destination.query.order_by(Destination.name).all()
    destinations = [{
        'destination_id': d.id,
        'destination_name': d.name,
        'country': d.country,
        'cover_url': resolve_destination_cover_url(d.name, d.country),
    } for d in dests]
    public_count = sum(1 for group in groups if group['group_type'] == 'Public')
    private_count = sum(1 for group in groups if group['group_type'] == 'Private')
    story_groups = groups[:6]
    stats = {
        'group_count': len(groups),
        'destination_count': len(destinations),
        'my_group_count': sum(1 for group in groups if group['is_member']),
        'public_count': public_count,
        'private_count': private_count,
    }

    return render_template(
        'groups.html',
        user=user,
        username=user.username,
        groups=groups,
        story_groups=story_groups,
        destinations=destinations,
        stats=stats,
    )


@app.route('/groups', methods=['POST'])
def groups_create():
    user = get_current_user()
    if not user:
        return redirect(url_for('auth_page'))

    name = (request.form.get('group_name') or '').strip()
    group_type = request.form.get('group_type', 'Public')
    dest_name = (request.form.get('destination_name') or '').strip()
    desc = (request.form.get('group_description') or '').strip() or None
    cover_image = save_group_cover_upload(request.files.get('group_photo'))

    try:
        max_members = int(request.form.get('max_members', 12))
    except (TypeError, ValueError):
        max_members = 12
    max_members = max(2, min(max_members, 100))

    if not name:
        return redirect(url_for('groups_page'))
    if group_type not in ('Public', 'Private'):
        group_type = 'Public'

    dest_id = find_or_create_destination(dest_name) if dest_name else None

    group = Group(
        id = generate_id(),
        name = name,
        description = desc,
        cover_image = cover_image,
        group_type = group_type,
        owner_id = user.id,
        destination_id = dest_id,
        max_members = max_members,
    )
    db.session.add(group)
    db.session.flush()

    member = GroupMember(
        id = generate_id(),
        group_id = group.id,
        user_id  = user.id,
        role = 'Owner',
    )
    db.session.add(member)
    db.session.commit()
    return redirect(url_for('groups_page'))


@app.route('/groups/join/<group_id>')
def groups_join(group_id):
    user = get_current_user()
    if not user:
        return redirect(url_for('auth_page'))

    group = db.session.get(Group, group_id)
    if not group:
        return redirect(url_for('groups_page'))

    existing = GroupMember.query.filter_by(group_id=group_id, user_id=user.id).first()
    if not existing and group.member_count < group.max_members:
        status = 'Pending' if group.group_type == 'Private' else 'Approved'
        db.session.add(GroupMember(
            id=generate_id(), group_id=group_id, user_id=user.id, role='Member', join_status=status,
        ))
        try:
            db.session.commit()
        except IntegrityError:
            # (group_id, user_id) is unique: a double-click or a second tab already
            # joined. Roll back so the session stays usable and treat it as joined.
            db.session.rollback()
    return redirect(url_for('groups_page'))


@app.route('/groups/leave/<group_id>')
def groups_leave(group_id):
    user = get_current_user()
    if not user:
        return redirect(url_for('auth_page'))

    member = GroupMember.query.filter_by(group_id=group_id, user_id=user.id).first()
    if member and member.role != 'Owner':
        db.session.delete(member)
        db.session.commit()
    return redirect(url_for('groups_page'))


@app.route('/groups/delete/<group_id>')
def groups_delete(group_id):
    user = get_current_user()
    if not user:
        return redirect(url_for('auth_page'))

    group = db.session.get(Group, group_id)
    if group and group.owner_id == user.id:
        db.session.delete(group)
        db.session.commit()
    return redirect(url_for('groups_page'))


@app.route('/groups/chat/<group_id>')
def chat_page(group_id):
    user = get_current_user()
    if not user:
        return redirect(url_for('auth_page'))
    group = db.session.get(Group, group_id)
    if not group:
        return "Group not found", 404

    membership = GroupMember.query.filter_by(
        group_id=group_id, user_id=user.id, join_status='Approved'
    ).first()
    if not membership:
        return redirect(url_for('groups_page'))

    member_rows = (
        db.session.query(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .filter(GroupMember.group_id == group_id, GroupMember.join_status == 'Approved')
        .all()
    )
    tourist_map = {
        tourist.user_id: tourist
        for tourist in Tourist.query.filter(
            Tourist.user_id.in_([member_user.id for _, member_user in member_rows])
        ).all()
    } if member_rows else {}
    members = [
        serialize_group_member_row(member, member_user, tourist_map=tourist_map, include_location=True)
        for member, member_user in member_rows
    ]

    msgs = (
        GroupMessage.query
        .filter_by(group_id=group_id)
        .order_by(GroupMessage.timestamp.asc())
        .limit(100)
        .all()
    )
    messages = [serialize_group_message(message) for message in msgs]

    return render_template('group_chat.html',
        group_id=group.id,
        group_name=group.name,
        username=user.username,
        members=members,
        messages=messages,
        destination_name=group.destination.name if group.destination else None,
        member_count=group.member_count,
    )


# --- Destinations management (form-based) ---
@app.route('/destinations/add', methods=['POST'])
def destinations_add():
    user = get_current_user()
    if not user:
        return redirect(url_for('auth_page'))
    name    = (request.form.get('destination_name') or '').strip().title()
    country = (request.form.get('country') or '').strip().title()
    if name:
        dest_id = find_or_create_destination(name)
        if country:
            dest = db.session.get(Destination, dest_id)
            if dest:
                dest.country = country
                db.session.commit()
    return redirect(url_for('groups_page'))


@app.route('/destinations/edit/<dest_id>', methods=['POST'])
def destinations_edit(dest_id):
    user = get_current_user()
    if not user:
        return redirect(url_for('auth_page'))
    dest = db.session.get(Destination, dest_id)
    if dest:
        name = (request.form.get('destination_name') or '').strip().title()
        country = (request.form.get('country') or '').strip().title()
        if name:
            dest.name = name
        if country:
            dest.country = country
        db.session.commit()
    return redirect(url_for('groups_page'))


@app.route('/destinations/delete/<dest_id>')
def destinations_delete(dest_id):
    user = get_current_user()
    if not user:
        return redirect(url_for('auth_page'))
    dest = db.session.get(Destination, dest_id)
    if dest:
        db.session.delete(dest)
        db.session.commit()
    return redirect(url_for('groups_page'))


# --- Astra Safety pages ---
@app.route('/profile')
def profile_page():
    user = get_current_user()
    tourist = get_current_tourist()
    is_local_preview = app.config.get('SQLALCHEMY_DATABASE_URI', '').startswith('sqlite:///')

    if not user or not tourist:
        if is_local_preview:
            preview_user = user or SimpleNamespace(username='Rudra')
            preview_tourist = tourist or SimpleNamespace(
                id=0,
                safety_score=84,
                iot_mode_enabled=True,
                name='Rudra',
                kyc_type='Aadhaar',
                kyc_id='795138462',
                visit_end_date=datetime.now() + timedelta(days=12),
                digital_id='garuda-preview-45b332105b4303e411e3dac9e44780c580820961',
                last_known_location='28.6139, 77.2090',
                phone='+91 9457831890',
                blynk_token=os.environ.get('BLYNK_AUTH_TOKEN', ''),
            )
            return render_template('profile.html', user=preview_user, tourist=preview_tourist, preview_mode=True)
        return redirect(url_for('auth_page'))

    return render_template('profile.html', user=user, tourist=tourist, preview_mode=False)

@app.route('/admin')
def admin_dashboard_page():
    return render_template('admin_dashboard.html')

@app.route('/travel')
def travel_page():
    user = get_current_user()
    return render_template('travel.html', username=user.username if user else None)


# ─────────────────────────────────────────────
# MAYURYA CHATBOT  (/api/chatbot)
# Sends user messages to the Gemini API and returns its reply.
# Keeps the API key server-side (header, never in a URL) so it never
# appears in client JS or in request logs.
# ─────────────────────────────────────────────

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '').strip()
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'gemini-3.6-flash').strip()
GEMINI_API_URL = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent'

MAYURYA_SYSTEM_PROMPT = (
    "You are Mayurya, the AI travel assistant built into SAFAR, an Indian group-travel and "
    "tourist-safety platform. Help users with destination ideas, itineraries, and budget tips, "
    "and explain SAFAR's own features when asked: travel groups and real-time group chat "
    "(at /groups), a safety dashboard with live GPS tracking, geo-fenced safety zones, anomaly "
    "detection and a one-tap panic button (at /profile), and a blockchain-backed identity "
    "ledger (at /blockchain). Keep answers concise, warm, and focused on travel in India "
    "unless the user asks otherwise.\n\n"
    "You have tools that read this SAFAR installation's live data. Prefer them over guessing: "
    "never invent group names, member counts or safety scores. When a request is too vague to "
    "act on, ask one short clarifying question first rather than calling a tool with a guess. "
    "Once you know what the user wants, call open_page to hand them a button that takes them "
    "straight there, and mention the button in your reply."
)

# Conversation memory. Each browser keeps a session_id in localStorage and sends it
# with every message; history lives here so the client cannot rewrite past turns.
CHAT_HISTORY_TURNS = 12          # user+model entries retained per session
CHAT_SESSION_TTL = 2 * 60 * 60   # seconds a session survives without a message
CHAT_MAX_SESSIONS = 500
CHAT_MAX_TOOL_ROUNDS = 3

_chat_sessions = {}
_chat_sessions_lock = threading.Lock()


def _chat_history_load(session_id: str) -> list:
    now = time.time()
    with _chat_sessions_lock:
        for stale in [s for s, v in _chat_sessions.items() if now - v['touched'] > CHAT_SESSION_TTL]:
            del _chat_sessions[stale]
        entry = _chat_sessions.get(session_id)
        return list(entry['turns']) if entry else []


def _chat_history_save(session_id: str, turns: list):
    with _chat_sessions_lock:
        if session_id not in _chat_sessions and len(_chat_sessions) >= CHAT_MAX_SESSIONS:
            oldest = min(_chat_sessions, key=lambda s: _chat_sessions[s]['touched'])
            del _chat_sessions[oldest]
        _chat_sessions[session_id] = {
            'turns': turns[-CHAT_HISTORY_TURNS:],
            'touched': time.time(),
        }


MAYURYA_PAGES = {
    'groups': '/groups',
    'profile': '/profile',
    'travel': '/travel',
    'blockchain': '/blockchain',
    'dashboard': '/user',
}

MAYURYA_TOOLS = [{
    'function_declarations': [
        {
            'name': 'search_travel_groups',
            'description': (
                'Search the travel groups that exist on this SAFAR installation, by destination, '
                'group name or trip description. Returns only public groups plus groups the '
                'signed-in user already belongs to.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'query': {
                        'type': 'string',
                        'description': 'Destination, group name or theme to match, e.g. "Jaipur".',
                    },
                    'group_type': {
                        'type': 'string',
                        'enum': ['Any', 'Public', 'Private'],
                        'description': 'Restrict to a group type. Defaults to Any.',
                    },
                },
                'required': ['query'],
            },
        },
        {
            'name': 'get_popular_destinations',
            'description': 'List the destinations with the most active travel groups on SAFAR right now.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'limit': {'type': 'integer', 'description': 'How many destinations to return (1-10).'},
                },
            },
        },
        {
            'name': 'get_my_safety_status',
            'description': (
                "Read the signed-in user's own Garuda safety profile: safety score, last known "
                'location and trip end date. Use when they ask about their own safety or tracking.'
            ),
        },
        {
            'name': 'open_page',
            'description': (
                'Give the user a button that opens a SAFAR page, optionally with the group search '
                'box pre-filled. Call this once you know where the user wants to go.'
            ),
            'parameters': {
                'type': 'object',
                'properties': {
                    'page': {
                        'type': 'string',
                        'enum': list(MAYURYA_PAGES),
                        'description': 'Which SAFAR page to open.',
                    },
                    'search': {
                        'type': 'string',
                        'description': 'Group search term to pre-fill. Only applies to the groups page.',
                    },
                    'label': {
                        'type': 'string',
                        'description': 'Short button text, e.g. "Browse Jaipur circles".',
                    },
                },
                'required': ['page', 'label'],
            },
        },
    ],
}]


def _mayurya_tool_search_groups(args, user, actions):
    query = (args.get('query') or '').strip().lower()
    group_type = args.get('group_type') or 'Any'

    member_ids = {m.group_id for m in user.memberships} if user else set()
    rows = Group.query.order_by(Group.created_at.desc()).all()

    matches = []
    for group in rows:
        if group.group_type != 'Public' and group.id not in member_ids:
            continue
        if group_type in ('Public', 'Private') and group.group_type != group_type:
            continue
        destination = group.destination.name if group.destination else ''
        haystack = f'{group.name} {destination} {group.description or ""}'.lower()
        if query and query not in haystack:
            continue
        matches.append({
            'name': group.name,
            'destination': destination or 'Not set',
            'type': group.group_type,
            'members': f'{group.member_count} of {group.max_members}',
            'already_a_member': group.id in member_ids,
        })
        if len(matches) >= 8:
            break

    return {'match_count': len(matches), 'groups': matches}


def _mayurya_tool_popular_destinations(args, user, actions):
    from sqlalchemy import func
    try:
        limit = int(args.get('limit') or 5)
    except (TypeError, ValueError):
        limit = 5
    rows = (
        db.session.query(Destination.name, func.count(Group.id).label('cnt'))
        .join(Group, Group.destination_id == Destination.id)
        .group_by(Destination.name)
        .order_by(func.count(Group.id).desc())
        .limit(max(1, min(limit, 10)))
        .all()
    )
    return {'destinations': [{'name': r.name, 'group_count': r.cnt} for r in rows]}


def _mayurya_tool_my_safety_status(args, user, actions):
    if not user:
        return {'signed_in': False, 'note': 'Nobody is signed in, so there is no safety profile to read.'}

    tourist = Tourist.query.filter_by(user_id=user.id).first()
    if not tourist:
        return {
            'registered': False,
            'note': 'This user has no Garuda safety profile yet. They can create one on the profile page.',
        }
    return {
        'registered': True,
        'safety_score': tourist.safety_score,
        'last_known_location': tourist.last_known_location or 'No location shared yet',
        'trip_ends': tourist.visit_end_date.isoformat(),
        'last_updated_at': tourist.last_updated_at.isoformat(),
    }


def _mayurya_tool_open_page(args, user, actions):
    from urllib.parse import quote

    page = (args.get('page') or '').strip().lower()
    path = MAYURYA_PAGES.get(page)
    if not path:
        return {'ok': False, 'error': f'Unknown page "{page}".'}

    search = (args.get('search') or '').strip()
    if search and page == 'groups':
        path = f'{path}?q={quote(search[:80])}'

    actions.append({'type': 'navigate', 'url': path, 'label': (args.get('label') or 'Open').strip()[:60]})
    return {'ok': True, 'note': 'A button to this page is now shown under your reply.'}


MAYURYA_TOOL_IMPLS = {
    'search_travel_groups': _mayurya_tool_search_groups,
    'get_popular_destinations': _mayurya_tool_popular_destinations,
    'get_my_safety_status': _mayurya_tool_my_safety_status,
    'open_page': _mayurya_tool_open_page,
}


def _mayurya_run_tool(name, args, user, actions) -> dict:
    impl = MAYURYA_TOOL_IMPLS.get(name)
    if not impl:
        return {'error': f'Unknown tool "{name}".'}
    try:
        return impl(args, user, actions)
    except Exception as exc:
        print(f'[Chatbot] Tool {name} failed: {exc}')
        return {'error': 'That lookup failed. Answer from general knowledge instead.'}


def _mayurya_generate(contents, with_tools: bool) -> dict:
    body = {
        'system_instruction': {'parts': [{'text': MAYURYA_SYSTEM_PROMPT}]},
        'contents': contents,
    }
    if with_tools:
        body['tools'] = MAYURYA_TOOLS

    response = requests.post(
        GEMINI_API_URL,
        json=body,
        headers={
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY,
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


@app.route('/api/chatbot', methods=['POST'])
def api_chatbot():
    """Answer a chat message with Gemini, using session memory and live SAFAR data."""
    data = request.get_json(silent=True) or {}
    message = (data.get('message') or '').strip()[:2000]
    session_id = (data.get('session_id') or '').strip()[:64]

    if not message:
        return jsonify({'error': 'message is required'}), 400

    if not GEMINI_API_KEY:
        return jsonify({'error': 'Chatbot backend is not configured.'}), 503

    user = get_current_user()
    history = _chat_history_load(session_id) if session_id else []
    contents = history + [{'role': 'user', 'parts': [{'text': message}]}]
    actions = []
    reply = ''

    try:
        # One extra round with tools switched off guarantees a text answer at the end.
        for round_index in range(CHAT_MAX_TOOL_ROUNDS + 1):
            payload = _mayurya_generate(contents, with_tools=round_index < CHAT_MAX_TOOL_ROUNDS)
            candidates = payload.get('candidates') or []
            if not candidates:
                block_reason = payload.get('promptFeedback', {}).get('blockReason')
                print(f'[Chatbot] Gemini returned no usable candidate (blockReason={block_reason}): {str(payload)[:300]}')
                break

            parts = candidates[0].get('content', {}).get('parts') or []
            calls = [p['functionCall'] for p in parts if isinstance(p, dict) and 'functionCall' in p]

            if not calls:
                reply = ''.join(p['text'] for p in parts if isinstance(p, dict) and 'text' in p).strip()
                break

            contents.append({'role': 'model', 'parts': parts})
            contents.append({'role': 'user', 'parts': [{
                'functionResponse': {
                    'name': call.get('name'),
                    'response': _mayurya_run_tool(call.get('name'), call.get('args') or {}, user, actions),
                },
            } for call in calls]})

        if not reply:
            reply = "I can help with destinations, itineraries, safety tips, and trip planning. Could you rephrase that?"

        if session_id:
            _chat_history_save(session_id, history + [
                {'role': 'user', 'parts': [{'text': message}]},
                {'role': 'model', 'parts': [{'text': reply}]},
            ])

        return jsonify({'response': reply, 'action': actions[0] if actions else None})

    except requests.Timeout:
        print('[Chatbot] Gemini request timed out after 30s')
        return jsonify({'response': 'Mayurya is thinking… please try again in a moment.'}), 200
    except requests.RequestException as exc:
        # exc/response text may echo request details but never the api key (sent via header, not URL)
        print(f'[Chatbot] Gemini request failed: {exc}')
        return jsonify({'response': 'Connection to Mayurya AI failed. Please try again shortly.'}), 200


@app.route('/user')
def user_dashboard_page():
    user = get_current_user()
    if not user:
        return redirect(url_for('auth_page'))

    # Find the user's current group (first approved membership)
    membership = GroupMember.query.filter_by(user_id=user.id, join_status='Approved').first()
    group = None
    members = []
    if membership:
        g = db.session.get(Group, membership.group_id)
        if g:
            group = {
                'group_id':          g.id,
                'group_name':        g.name,
                'group_description': g.description,
                'group_type':        g.group_type,
                'owner_id':          g.owner_id,
                'destination_name':  g.destination.name if g.destination else None,
                'member_count':      g.member_count,
            }
            member_rows = (
                db.session.query(GroupMember, User)
                .join(User, User.id == GroupMember.user_id)
                .filter(GroupMember.group_id == g.id, GroupMember.join_status == 'Approved')
                .all()
            )
            members = [{'username': u.username, 'role': m.role} for m, u in member_rows]

    return render_template('user_dashboard.html', user=user, group=group, members=members)


@app.route('/user/edit', methods=['POST'])
def user_edit():
    user = get_current_user()
    if not user:
        return redirect(url_for('auth_page'))
    phone  = request.form.get('phone_no')
    gender = request.form.get('gender')
    bio    = request.form.get('bio')
    if phone is not None:
        user.phone = phone
    if gender is not None:
        user.gender = gender
    if bio is not None:
        user.bio = bio
    db.session.commit()
    return redirect(url_for('user_dashboard_page'))


@app.route('/api/i18n/translate', methods=['POST'])
def api_i18n_translate():
    data = request.get_json(silent=True) or {}
    source = normalize_translation_lang(data.get('source'))
    target = normalize_translation_lang(data.get('target'))
    page = normalize_translation_text(data.get('page'))

    raw_texts = data.get('texts') or []
    if not isinstance(raw_texts, list):
        return jsonify({'error': 'texts must be a list.'}), 400

    cleaned_texts = []
    for item in raw_texts[:50]:
        if not isinstance(item, str):
            continue
        normalized = normalize_translation_text(item)
        if normalized:
            cleaned_texts.append(normalized)

    unique_texts = list(dict.fromkeys(cleaned_texts))
    if not unique_texts or source == target:
        passthrough = {text: text for text in unique_texts}
        return jsonify({
            'page': page,
            'provider': TRANSLATION_PROVIDER,
            'source': source,
            'target': target,
            'translations': passthrough,
        })

    translations = {}
    for text in unique_texts:
        cache_key = (source, target, text)
        if cache_key in translation_cache:
            translations[text] = translation_cache[cache_key]
            continue

        try:
            translated = translate_text_online(text, source, target)
        except requests.RequestException as exc:
            print(f"[i18n] Translation request failed for {target}: {exc}")
            translated = text

        translation_cache[cache_key] = translated
        translations[text] = translated

    return jsonify({
        'page': page,
        'provider': TRANSLATION_PROVIDER,
        'source': source,
        'target': target,
        'translations': translations,
    })


# ─────────────────────────────────────────────
# ════════════════════════════════════════════
#  AUTH API  (/api/auth/...)
# ════════════════════════════════════════════
# ─────────────────────────────────────────────

@app.route('/api/auth/register', methods=['POST'])
def api_register():
    """
    Register a new user (TravelTogether account).
    Optionally also creates a Tourist profile if KYC data is supplied.

    The email must already have been proven via /api/auth/email/verify-code
    in this same session.

    Body (JSON):
        username, password, email
        [phone, gender, bio]                  — optional user fields
        [kyc_id, kyc_type, visit_duration_days] — optional tourist fields
    """
    data = request.get_json(force=True)

    # --- Validate required fields ---
    for field in ('username', 'password', 'email'):
        if not data.get(field):
            return jsonify({'error': f'{field} is required.'}), 400

    if not validate_email(data['email']):
        return jsonify({'error': 'Invalid email address.'}), 400

    email = data['email'].strip().lower()
    if not email_verification_granted(email):
        return jsonify({
            'error': 'Please verify this email address before registering.',
            'email_verification_required': True,
        }), 403

    ok, msg = validate_password(data['password'])
    if not ok:
        return jsonify({'error': msg}), 400

    # --- Create User ---
    user = User(
        id       = generate_id(),
        username = data['username'].strip(),
        password = hash_password(data['password']),
        email    = email,
        email_verified = True,
        phone    = data.get('phone'),
        gender   = data.get('gender'),
        bio      = data.get('bio'),
    )
    db.session.add(user)

    try:
        db.session.flush()   # get user.id before commit
    except (OperationalError, InterfaceError, DBAPIError):
        db.session.rollback()
        return database_unavailable_response()
    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Database Error: {e}'}), 409


    # --- Optionally create Tourist profile ---
    tourist = None
    if data.get('kyc_id') and data.get('kyc_type') and data.get('visit_duration_days'):
        phone = data.get('phone') or ''


        end_date      = datetime.utcnow() + timedelta(days=int(data['visit_duration_days']))
        unique_string = f"{data['username']}:{data['kyc_id']}:{datetime.utcnow()}"
        digital_id    = hashlib.sha256(unique_string.encode()).hexdigest()

        tourist = Tourist(
            user_id        = user.id,
            digital_id     = digital_id,
            name           = data.get('name') or data['username'],
            phone          = phone,
            kyc_id         = data['kyc_id'],
            kyc_type       = data['kyc_type'],
            visit_end_date = end_date,
        )
        db.session.add(tourist)

    # --- Blockchain Security (Industrial Grade) ---
    # Mine a new block to permanently record this registration event
    try:
        import time
        register_event = {
            "username": user.username,
            "email": user.email,
            "ip": request.remote_addr,
            "action": "ACCOUNT_CREATED",
            "nonce": time.monotonic_ns()   # unique per registration
        }
        block = BlockchainBlock.mine_block("REGISTER", user.id, register_event)
        db.session.add(block)
    except Exception as eb:
        db.session.rollback()
        print(f"[Blockchain Error] Failed to log registration: {eb}")


    db.session.commit()
    session['user_id'] = user.id
    # The grant deliberately survives: one address may back several accounts,
    # and re-verifying for each would burn through the sender's hourly quota.
    # It still expires with EMAIL_VERIFICATION_GRANT_MINUTES.

    return jsonify({
        'message': 'Registration successful.',
        'user_id': user.id,
        'has_tourist_profile': tourist is not None,
    }), 201


@app.route('/api/auth/login', methods=['POST'])
def api_login():
    """
    Login with username+password  OR  a Supabase-verified email (Astra-style
    passwordless tourist login).

    Body options:
        { "username": "...", "password": "..." }
        { "email": "..." }   — requires /api/auth/email/verify-code first
    """
    data = request.get_json(force=True)

    if data.get('username') and data.get('password'):
        user = User.query.filter_by(username=data['username']).first()
        if not user or user.password != hash_password(data['password']):
            return jsonify({'error': 'Invalid credentials.'}), 401
        session['user_id'] = user.id
        
        # --- Blockchain Security ---
        # Mine a block for every successful login.
        # mine_block() adds a monotonic nonce automatically for unique hashes.
        try:
            login_event = {
                "username": user.username,
                "ip": request.remote_addr,
                "status": "SUCCESS",
                # nonce added automatically inside mine_block()
            }
            block = BlockchainBlock.mine_block("LOGIN", user.id, login_event)
            db.session.add(block)
            db.session.commit()
        except Exception as eb:
            db.session.rollback()   # keep session clean so login still succeeds
            print(f"[Blockchain] Login block failed: {eb}")

        return jsonify({'message': 'Login successful.', 'user_id': user.id}), 200

    if data.get('email'):
        # Passwordless login — the email must have been proven in this session.
        email = data['email'].strip().lower()
        if not email_verification_granted(email):
            return jsonify({
                'error': 'Please verify this email address before logging in.',
                'email_verification_required': True,
            }), 403

        candidates = (
            User.query.filter(func.lower(User.email) == email)
            .order_by(User.created_at.asc())
            .all()
        )
        if not candidates:
            return jsonify({'error': 'No account found for this email address.'}), 404

        # Several accounts may share one address, so the caller has to say
        # which. Picking `.first()` would silently sign them into whichever
        # row the database happened to return.
        wanted = (data.get('username') or '').strip()
        if wanted:
            user = next((u for u in candidates if u.username == wanted), None)
            if not user:
                return jsonify({'error': 'That username is not registered to this email.'}), 404
        elif len(candidates) == 1:
            user = candidates[0]
        else:
            return jsonify({
                'error': 'Several accounts use this email. Choose which one to sign in to.',
                'account_choice_required': True,
                'accounts': [u.username for u in candidates],
            }), 409

        # Commit the flag on its own — the blockchain block below rolls back
        # on failure and must not take the verified flag with it.
        user.email_verified = True
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()

        session['user_id'] = user.id
        clear_email_verification()   # one grant, one login

        tourist = user.tourist_profile
        if tourist:
            session['tourist_id'] = tourist.id

        # --- Blockchain Security for Email Login ---
        try:
            login_event = {
                "email": user.email,
                "ip": request.remote_addr,
                "status": "EMAIL_SUCCESS",
                "tourist_id": tourist.id if tourist else None
            }
            # Mine block even for tourists to ensure audit integrity
            block = BlockchainBlock.mine_block("EMAIL_LOGIN", user.id, login_event)
            db.session.add(block)
            db.session.commit()
        except Exception as eb:
            db.session.rollback()
            print(f"[Blockchain] Email login block failed: {eb}")

        return jsonify({
            'message': 'Login successful.',
            'user_id': user.id,
            'tourist_id': tourist.id if tourist else None,
        }), 200

    return jsonify({'error': 'Provide username+password or a verified email.'}), 400


@app.route('/api/auth/logout')
def api_logout():
    session.clear()
    return redirect(url_for('index'))


# ─────────────────────────────────────────────
# BLOCKCHAIN INTEGRITY API
# ─────────────────────────────────────────────

@app.route('/blockchain')
def blockchain_audit_page():
    return render_template('blockchain.html')

@app.route('/api/blockchain/blocks', methods=['GET'])
def api_blockchain_blocks():
    """Returns the full chain for visual auditing."""
    blocks = BlockchainBlock.query.order_by(BlockchainBlock.index.asc()).all()
    return jsonify([{
        "index": b.index,
        "timestamp": b.timestamp.isoformat(),
        "event_type": b.event_type,
        "user_id": b.user_id,
        "previous_hash": b.previous_hash[:16] + "...",
        "block_hash": b.block_hash
    } for b in blocks])

@app.route('/api/blockchain/verify', methods=['GET'])
def api_blockchain_verify():
    """
    Audits the entire identity ledger to ensure no administrative tampering
    has occurred. Uses timestamp_str (the exact string at mining time) to
    recalculate hashes deterministically.
    """
    blocks = BlockchainBlock.query.order_by(BlockchainBlock.index.asc()).all()
    chain_valid = True
    errors = []

    for i in range(len(blocks)):
        block = blocks[i]

        # Use timestamp_str if present (new blocks); fall back to str(timestamp) for legacy rows
        ts_key = block.timestamp_str if block.timestamp_str else str(block.timestamp)

        # 1. Verify internal hash
        recalculated = BlockchainBlock.calculate_hash(
            block.index, ts_key, block.event_type,
            block.user_id, block.data_hash, block.previous_hash
        )
        if recalculated != block.block_hash:
            chain_valid = False
            errors.append(f"Block #{block.index} hash mismatch — possible tamper or legacy block")

        # 2. Verify chain linkage
        if i > 0:
            prev_block = blocks[i - 1]
            if block.previous_hash != prev_block.block_hash:
                chain_valid = False
                errors.append(f"Block #{block.index} previous_hash broken at #{i}")

    return jsonify({
        "status":             "SECURE" if chain_valid else "TAMPERED",
        "block_count":        len(blocks),
        "integrity_verified": chain_valid,
        "anomalies":          errors,
        "audit_time":         datetime.now().isoformat()
    })


# ─────────────────────────────────────────────
# ════════════════════════════════════════════
#  EMAIL VERIFICATION API  (/api/auth/email/...)
#  Backed by Supabase Auth email OTP (GoTrue).
# ════════════════════════════════════════════
# ─────────────────────────────────────────────

def supabase_auth_request(path: str, payload: dict):
    """
    POST to the Supabase Auth (GoTrue) REST API.
    Returns (status_code, parsed_body). status_code 0 means the call never landed.
    """
    try:
        resp = requests.post(
            f"{SUPABASE_AUTH_URL}{path}",
            json=payload,
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': 'application/json',
            },
            timeout=15,
        )
    except requests.RequestException as exc:
        print(f"[EmailAuth] Supabase request to {path} failed: {exc}")
        return 0, {'error': str(exc)}

    try:
        body = resp.json()
    except ValueError:
        body = {}
    return resp.status_code, body


def supabase_error_message(body: dict, fallback: str) -> str:
    """GoTrue spreads its message across a few keys depending on the failure."""
    if not isinstance(body, dict):
        return fallback
    for key in ('msg', 'error_description', 'message', 'error'):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def grant_email_verification(email: str) -> None:
    """Record server-side that this browser session proved ownership of `email`."""
    session['verified_email'] = email.strip().lower()
    session['verified_email_at'] = datetime.utcnow().isoformat()


def email_verification_granted(email: str) -> bool:
    """
    True only if THIS session verified THIS email recently. The client never
    gets to assert its own verification — that was the hole in the old
    `{"otp_verified": true}` flow.
    """
    granted = session.get('verified_email')
    stamped = session.get('verified_email_at')
    if not granted or not stamped:
        return False
    if granted != (email or '').strip().lower():
        return False
    try:
        when = datetime.fromisoformat(stamped)
    except ValueError:
        return False
    return datetime.utcnow() <= when + timedelta(minutes=EMAIL_VERIFICATION_GRANT_MINUTES)


def clear_email_verification() -> None:
    session.pop('verified_email', None)
    session.pop('verified_email_at', None)


def use_console_email_codes() -> bool:
    """
    Log the code instead of emailing it. Forced by EMAIL_CODES_TO_CONSOLE, and
    used automatically when no Supabase project is configured so local runs
    work offline. Send and verify must agree, hence the single helper.
    """
    return EMAIL_CODES_TO_CONSOLE or not SUPABASE_AUTH_ENABLED


def issue_local_email_code(email: str) -> str:
    """Mint a code this server checks itself, instead of one Supabase mailed."""
    code = str(random.randint(100000, 999999))
    session['dev_email_code'] = code
    session['dev_email_target'] = email
    # flush: gunicorn buffers stdout, and an unflushed code never reaches the
    # log the operator is reading it from.
    print(f"[SAFAR] Email verification code for {email}: {code}", flush=True)
    return code


def local_email_code_pending(email: str) -> bool:
    """True when this session is holding a locally issued code for `email`."""
    return bool(session.get('dev_email_code')) and session.get('dev_email_target') == email


@app.route('/api/auth/email/send-code', methods=['POST'])
def api_send_email_code():
    """
    Email a 6-digit verification code via Supabase Auth.

    Body: { "email": "...", "purpose": "register" | "login" }
    One address may back several accounts (they are told apart by username),
    so only the login direction needs the address to already exist — signing
    in to an address nobody registered is a dead end worth catching before
    spending an email.
    """
    data    = request.get_json(force=True)
    email   = (data.get('email') or '').strip().lower()
    purpose = (data.get('purpose') or 'register').strip().lower()

    if not email:
        return jsonify({'error': 'Email address is required.'}), 400
    if not validate_email(email):
        return jsonify({'error': 'Invalid email address.'}), 400
    if purpose not in ('register', 'login'):
        return jsonify({'error': 'Unknown verification purpose.'}), 400

    if purpose == 'login':
        existing = User.query.filter(func.lower(User.email) == email).first()
        if not existing:
            return jsonify({'error': 'No account found for this email address.'}), 404

    # Sending a fresh code invalidates any earlier grant for this session.
    clear_email_verification()

    if use_console_email_codes():
        issue_local_email_code(email)
        return jsonify({
            'message': 'Verification code written to the server log.',
            'dev_mode': True,
        }), 200

    status, body = supabase_auth_request('/otp', {'email': email, 'create_user': True})

    if status == 200:
        return jsonify({'message': 'Verification code sent. Check your inbox.'}), 200

    # The built-in sender refuses in two ways that both stop a demo dead: the
    # 2-per-hour quota (429), and any address outside the project team (400
    # "Email address not authorized"). Both mean no mail will ever arrive, so
    # retrying is pointless — issue our own code and show it instead.
    if DEMO_CODE_FALLBACK and status in (429, 400, 401, 403, 422):
        code = issue_local_email_code(email)
        return jsonify({
            'message': 'The email service would not deliver, so here is your code.',
            'code': code,
            'fallback_reason': supabase_error_message(body, 'Email could not be sent.'),
        }), 200

    if status == 429:
        return jsonify({
            'error': supabase_error_message(body, 'Too many requests. Wait a minute and try again.')
        }), 429
    if status == 0:
        return jsonify({'error': 'Could not reach the email service. Please try again.'}), 503
    if status in (400, 401, 403, 422):
        # Supabase rejected the address itself — most often "Email address not
        # authorized", which is what the built-in sender returns for anyone who
        # is not a member of the project team. Show its wording verbatim.
        return jsonify({
            'error': supabase_error_message(body, 'This email address was rejected by the email service.')
        }), 400

    return jsonify({
        'error': supabase_error_message(body, 'Failed to send the verification email.')
    }), 502


@app.route('/api/auth/email/verify-code', methods=['POST'])
def api_verify_email_code():
    """Check the emailed code and grant this session a verified-email stamp."""
    data  = request.get_json(force=True)
    email = (data.get('email') or '').strip().lower()
    code  = (data.get('code') or '').strip()

    if not email or not code:
        return jsonify({'error': 'Email and verification code are required.'}), 400

    # A code we minted ourselves is never known to Supabase, so it has to be
    # checked here — whether it came from console mode or the demo fallback.
    if use_console_email_codes() or local_email_code_pending(email):
        expected = session.get('dev_email_code')
        target   = session.get('dev_email_target')
        if not expected or target != email:
            return jsonify({'error': 'No code was requested for this address.'}), 404
        if code != expected:
            return jsonify({'error': 'Invalid verification code.'}), 400
        session.pop('dev_email_code', None)
        session.pop('dev_email_target', None)
        grant_email_verification(email)
        return jsonify({'message': 'Email verified.', 'verified': True}), 200

    # Which template GoTrue sent decides the token's type, and we cannot know
    # it from here: a first-time address gets "Confirm signup" (type 'signup'),
    # while an address whose Supabase user already exists gets "Magic Link"
    # (type 'magiclink'). Since one address may now back several accounts, both
    # happen in normal use — so try each until one is accepted.
    status, body = 0, {}
    for token_type in ('email', 'signup', 'magiclink'):
        status, body = supabase_auth_request(
            '/verify', {'type': token_type, 'email': email, 'token': code}
        )
        if status == 200:
            grant_email_verification(email)
            return jsonify({'message': 'Email verified.', 'verified': True}), 200
        if status not in (400, 401, 403):
            break   # not a "wrong type/token" answer — stop guessing

    if status in (400, 401, 403):
        return jsonify({
            'error': supabase_error_message(body, 'Invalid or expired verification code.')
        }), 400
    if status == 0:
        return jsonify({'error': 'Could not reach the email service. Please try again.'}), 503

    return jsonify({
        'error': supabase_error_message(body, 'Verification failed.')
    }), 502


@app.route('/api/iot/config', methods=['POST'])
def api_iot_config():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.get_json(force=True)
    token = data.get('token', '').strip()
    enabled = data.get('enabled', False)

    tourist = Tourist.query.filter_by(user_id=session['user_id']).first()
    if not tourist:
        return jsonify({'error': 'Tourist profile not found. Please complete KYC first.'}), 404
        
    tourist.blynk_token = token
    tourist.iot_mode_enabled = enabled
    db.session.commit()
    
    return jsonify({'message': 'IoT Device configuration updated.'}), 200


# ─────────────────────────────────────────────
# ════════════════════════════════════════════
#  TRAVEL TOGETHER API  (/api/tt/...)
# ════════════════════════════════════════════
# ─────────────────────────────────────────────

# ── Destinations ──────────────────────────────

@app.route('/api/tt/destinations', methods=['GET'])
def tt_get_destinations():
    dests = Destination.query.order_by(Destination.name).all()
    return jsonify([{'id': d.id, 'name': d.name, 'country': d.country} for d in dests])


@app.route('/api/tt/destinations', methods=['POST'])
def tt_create_destination():
    data = request.get_json(force=True)
    name = (data.get('name') or '').strip().title()
    if not name:
        return jsonify({'error': 'Name is required.'}), 400

    dest_id = find_or_create_destination(name)
    dest    = db.session.get(Destination, dest_id)
    if data.get('country'):
        dest.country = data['country'].strip().title()
        db.session.commit()

    return jsonify({'id': dest.id, 'name': dest.name, 'country': dest.country}), 201


@app.route('/api/tt/destinations/<dest_id>', methods=['PUT'])
def tt_update_destination(dest_id):
    dest = db.session.get(Destination, dest_id)
    if not dest:
        return jsonify({'error': 'Not found.'}), 404
    data = request.get_json(force=True)
    if data.get('name'):
        dest.name = data['name'].strip().title()
    if data.get('country'):
        dest.country = data['country'].strip().title()
    db.session.commit()
    return jsonify({'message': 'Updated.', 'id': dest.id})


@app.route('/api/tt/destinations/<dest_id>', methods=['DELETE'])
def tt_delete_destination(dest_id):
    dest = db.session.get(Destination, dest_id)
    if not dest:
        return jsonify({'error': 'Not found.'}), 404
    db.session.delete(dest)
    db.session.commit()
    return jsonify({'message': 'Deleted.'})


@app.route('/api/tt/destinations/popular')
def tt_popular_destinations():
    from sqlalchemy import func
    rows = (
        db.session.query(Destination.name, func.count(Group.id).label('cnt'))
        .join(Group, Group.destination_id == Destination.id)
        .group_by(Destination.name)
        .order_by(func.count(Group.id).desc())
        .limit(int(request.args.get('limit', 5)))
        .all()
    )
    return jsonify([{'name': r.name, 'group_count': r.cnt} for r in rows])


# ── Groups ────────────────────────────────────

@app.route('/api/tt/groups', methods=['GET'])
def tt_list_groups():
    """List public groups, or groups for the logged-in user."""
    user = get_current_user()
    if not user:
        groups = Group.query.filter_by(group_type='Public').all()
        member_ids = set()
    else:
        # Return all public groups + groups the user belongs to
        member_ids = {m.group_id for m in user.memberships}
        groups = Group.query.filter(
            (Group.group_type == 'Public') | (Group.id.in_(member_ids))
        ).all()

    payload = []
    for group in groups:
        cover = resolve_group_cover(group)
        payload.append({
            'id': group.id,
            'name': group.name,
            'description': group.description,
            'type': group.group_type,
            'owner_id': group.owner_id,
            'destination': group.destination.name if group.destination else None,
            'member_count': group.member_count,
            'max_members': group.max_members,
            'created_at': group.created_at.isoformat(),
            'cover_image': group.cover_image,
            'cover_url': cover['url'],
            'cover_mode': cover['mode'],
            'cover_theme': cover['theme'],
            'is_member': group.id in member_ids,
        })

    return jsonify(payload)


@app.route('/api/tt/groups', methods=['POST'])
def tt_create_group():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated.'}), 401

    data = request.get_json(force=True)
    name = (data.get('name') or '').strip()
    group_type = data.get('type', 'Public')
    dest_name = data.get('destination')
    try:
        max_members = int(data.get('max_members', 50))
    except (TypeError, ValueError):
        max_members = 50

    if not name:
        return jsonify({'error': 'Group name is required.'}), 400
    if group_type not in ('Public', 'Private'):
        return jsonify({'error': "type must be 'Public' or 'Private'."}), 400

    dest_id = find_or_create_destination(dest_name) if dest_name else None

    group = Group(
        id = generate_id(),
        name = name,
        description = data.get('description'),
        cover_image = data.get('cover_image'),
        group_type = group_type,
        owner_id = user.id,
        destination_id = dest_id,
        max_members = max(2, min(max_members, 100)),
    )
    db.session.add(group)
    db.session.flush()

    member = GroupMember(
        id       = generate_id(),
        group_id = group.id,
        user_id  = user.id,
        role     = 'Owner',
    )
    db.session.add(member)
    db.session.commit()

    return jsonify({'message': 'Group created.', 'group_id': group.id}), 201


@app.route('/api/tt/groups/<group_id>', methods=['GET'])
def tt_get_group(group_id):
    user = get_current_user()
    g = db.session.get(Group, group_id)
    if not g:
        return jsonify({'error': 'Not found.'}), 404
    return jsonify(serialize_group_details(g, user))


@app.route('/api/tt/groups/<group_id>/join', methods=['POST'])
def tt_join_group(group_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated.'}), 401

    group = db.session.get(Group, group_id)
    if not group:
        return jsonify({'error': 'Group not found.'}), 404
    if group.member_count >= group.max_members:
        return jsonify({'error': 'Group is full.'}), 400

    existing = GroupMember.query.filter_by(group_id=group_id, user_id=user.id).first()
    if existing:
        return jsonify({'error': 'Already a member.'}), 409

    status = 'Pending' if group.group_type == 'Private' else 'Approved'
    db.session.add(GroupMember(
        id       = generate_id(),
        group_id = group_id,
        user_id  = user.id,
        role     = 'Member',
        join_status = status,
    ))
    db.session.commit()

    return jsonify({'message': f'Joined group (status: {status}).'}), 200


@app.route('/api/tt/groups/<group_id>/leave', methods=['POST'])
def tt_leave_group(group_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated.'}), 401

    member = GroupMember.query.filter_by(group_id=group_id, user_id=user.id).first()
    if not member:
        return jsonify({'error': 'Not a member.'}), 404
    if member.role == 'Owner':
        return jsonify({'error': 'Owner cannot leave. Delete the group instead.'}), 403

    db.session.delete(member)
    db.session.commit()

    return jsonify({'message': 'Left group.'})


@app.route('/api/tt/groups/<group_id>', methods=['DELETE'])
def tt_delete_group(group_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated.'}), 401

    group = db.session.get(Group, group_id)
    if not group:
        return jsonify({'error': 'Not found.'}), 404
    if group.owner_id != user.id:
        return jsonify({'error': 'Only the owner can delete this group.'}), 403

    db.session.delete(group)
    db.session.commit()
    return jsonify({'message': 'Group deleted.'})


@app.route('/api/tt/groups/<group_id>/members')
def tt_group_members(group_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated.'}), 401

    is_member = GroupMember.query.filter_by(
        group_id=group_id, user_id=user.id, join_status='Approved'
    ).first()
    if not is_member:
        return jsonify({'error': 'Not a member of this group.'}), 403

    members = (
        db.session.query(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .filter(GroupMember.group_id == group_id,
                GroupMember.join_status == 'Approved')
        .all()
    )
    tourist_map = {
        tourist.user_id: tourist
        for tourist in Tourist.query.filter(
            Tourist.user_id.in_([member_user.id for _, member_user in members])
        ).all()
    } if members else {}
    return jsonify([
        serialize_group_member_row(member, member_user, tourist_map=tourist_map, include_location=True)
        for member, member_user in members
    ])


@app.route('/api/tt/groups/<group_id>/messages')
def tt_group_messages(group_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated.'}), 401

    member = GroupMember.query.filter_by(
        group_id=group_id, user_id=user.id, join_status='Approved'
    ).first()
    if not member:
        return jsonify({'error': 'Not a member of this group.'}), 403

    limit = min(int(request.args.get('limit', 100)), 200)
    before_id = request.args.get('before')

    query = GroupMessage.query.filter_by(group_id=group_id)
    if before_id:
        query = query.filter(GroupMessage.id < int(before_id))
    msgs = (
        query
        .order_by(GroupMessage.id.desc())
        .limit(limit)
        .all()
    )
    msgs.reverse()
    return jsonify([serialize_group_message(message) for message in msgs])


@app.route('/api/tt/groups/<group_id>/messages', methods=['POST'])
def tt_send_message(group_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated.'}), 401

    member = GroupMember.query.filter_by(
        group_id=group_id, user_id=user.id, join_status='Approved'
    ).first()
    if not member:
        return jsonify({'error': 'Not a member of this group.'}), 403

    attachment = None
    if request.files:
        try:
            attachment = save_group_document_upload(request.files.get('document'))
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
    if request.is_json:
        data = request.get_json(force=True) or {}
        text = (data.get('message') or '').strip()
    else:
        text = (request.form.get('message') or '').strip()

    if not text and not attachment:
        return jsonify({'error': 'Message or document is required.'}), 400
    if request.files and not attachment:
        return jsonify({'error': 'Unsupported document type. Upload PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV, RTF, or ZIP.'}), 400

    message_type = 'document' if attachment else 'text'
    msg = build_group_message(
        group_id=group_id,
        sender_id=user.id,
        text=text,
        message_type=message_type,
        attachment=attachment,
    )
    db.session.commit()

    emit_group_message(msg)

    return jsonify({'message': 'Sent.', 'payload': serialize_group_message(msg), 'id': msg.id}), 201


@app.route('/api/tt/my-groups')
def tt_my_groups():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated.'}), 401

    rows = (
        db.session.query(Group, GroupMember, Destination)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .outerjoin(Destination, Destination.id == Group.destination_id)
        .filter(GroupMember.user_id == user.id)
        .all()
    )
    return jsonify([{
        'id':          g.id,
        'name':        g.name,
        'type':        g.group_type,
        'role':        m.role,
        'destination': d.name if d else None,
        'member_count': g.member_count,
    } for g, m, d in rows])


# ─────────────────────────────────────────────
# ════════════════════════════════════════════
#  ASTRA SAFETY API  (/api/safety/...)
# ════════════════════════════════════════════
# ─────────────────────────────────────────────

@app.route('/api/safety/register', methods=['POST'])
def safety_register():
    """
    Creates a Tourist profile for an existing User, or standalone if no user session.
    Body: name, phone, kyc_id, kyc_type, visit_duration_days
    """
    data = request.get_json(force=True)

    required = ('name', 'phone', 'kyc_id', 'kyc_type', 'visit_duration_days')
    for f in required:
        if not data.get(f):
            return jsonify({'error': f'{f} is required.'}), 400

    # No unique restrictions on phone or kyc_id

    end_date  = datetime.utcnow() + timedelta(days=int(data['visit_duration_days']))
    unique_s  = f"{data['name']}:{data['kyc_id']}:{datetime.utcnow()}"
    digital_id = hashlib.sha256(unique_s.encode()).hexdigest()

    user_id = session.get('user_id')
    tourist = Tourist(
        user_id        = user_id,
        digital_id     = digital_id,
        name           = data['name'],
        phone          = data['phone'],
        kyc_id         = data['kyc_id'],
        kyc_type       = data['kyc_type'],
        visit_end_date = end_date,
    )
    db.session.add(tourist)
    db.session.commit()
    session['tourist_id'] = tourist.id

    return jsonify({'message': 'Tourist profile created.', 'tourist_id': tourist.id}), 201


@app.route('/api/safety/update_location', methods=['POST'])
def safety_update_location():
    tourist_id = session.get('tourist_id')
    if not tourist_id:
        tourist = get_current_tourist()
        if tourist:
            tourist_id = tourist.id
    if not tourist_id:
        return jsonify({'error': 'Not authenticated as a tourist.'}), 401

    data = request.get_json(force=True)
    lat, lon = data.get('latitude'), data.get('longitude')
    if lat is None or lon is None:
        return jsonify({'error': 'latitude and longitude are required.'}), 400

    tourist = db.session.get(Tourist, tourist_id)
    if not tourist:
        return jsonify({'error': 'Tourist not found.'}), 404

    # Resolve active anomalies on any location update
    Anomaly.query.filter_by(tourist_id=tourist.id, status='active').update({'status': 'resolved'})

    tourist.last_known_location = f"Lat: {lat}, Lon: {lon}"
    tourist.last_updated_at     = datetime.now()

    # Geo-fence scoring
    current_zone_score = None
    for zone in SafetyZone.query.all():
        if haversine(lat, lon, zone.latitude, zone.longitude) <= zone.radius:
            if current_zone_score is None or zone.regional_score < current_zone_score:
                current_zone_score = zone.regional_score

            if zone.regional_score < 40:
                ten_ago = datetime.utcnow() - timedelta(minutes=10)
                breach  = Alert.query.filter(
                    Alert.tourist_id == tourist.id,
                    Alert.alert_type.like('%Geo-fence%'),
                    Alert.timestamp > ten_ago,
                ).first()
                if not breach:
                    db.session.add(Alert(
                        tourist_id = tourist.id,
                        location   = tourist.last_known_location,
                        alert_type = f"Geo-fence Breach: {zone.name}",
                    ))

    if current_zone_score is not None:
        if current_zone_score < tourist.safety_score:
            tourist.safety_score = current_zone_score
        elif current_zone_score > 80 and tourist.safety_score < 100:
            tourist.safety_score = min(100, tourist.safety_score + 1)
            
    recent_panic = Alert.query.filter(
        Alert.tourist_id == tourist.id,
        Alert.alert_type == 'HARDWARE Panic',
        Alert.timestamp > (datetime.now() - timedelta(seconds=60))
    ).first()
    
    if recent_panic:
        tourist.safety_score = 0 # Lock score at 0 during active panics

    db.session.commit()
    return jsonify({
        'message': 'Location updated.', 
        'safety_score': tourist.safety_score, 
        'is_panicking': bool(recent_panic)
    }), 200


@app.route('/api/safety/panic', methods=['POST'])
def safety_panic():
    tourist = get_current_tourist()
    tourist_id = session.get('tourist_id') or (tourist.id if tourist else None)
    if not tourist_id:
        return jsonify({'error': 'Not authenticated.'}), 401

    tourist = db.session.get(Tourist, tourist_id)
    if not tourist:
        return jsonify({'error': 'Tourist not found.'}), 404

    trigger_hardware_sos(tourist, source_label='Website Panic Button')
    return jsonify({'message': 'Panic alert registered.'}), 200


@app.route('/api/safety/zones')
def safety_zones():
    zones = SafetyZone.query.all()
    return jsonify([{
        'name':           z.name,
        'latitude':       z.latitude,
        'longitude':      z.longitude,
        'radius':         z.radius,
        'regional_score': z.regional_score,
    } for z in zones])


@app.route('/api/safety/my_profile')
def safety_my_profile():
    tourist = get_current_tourist()
    if not tourist:
        return jsonify({'error': 'No tourist profile found.'}), 404
    tourist.last_updated_at = datetime.now()
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
    return jsonify({
        'id':                   tourist.id,
        'name':                 tourist.name,
        'phone':                tourist.phone,
        'safety_score':         tourist.safety_score,
        'last_known_location':  tourist.last_known_location,
        'visit_end_date':       tourist.visit_end_date.isoformat(),
        'last_updated_at':      tourist.last_updated_at.isoformat() if tourist.last_updated_at else None,
        'iot_mode_enabled':     bool(tourist.iot_mode_enabled),
    })


# ── IoT Device API  (/api/iot/...) ─────────────

@app.route('/api/navigation/route', methods=['POST'])
def api_navigation_route():
    tourist = get_current_tourist()
    if not tourist:
        return jsonify({'error': 'No tourist profile found.'}), 404

    data = request.get_json(force=True) or {}
    destination_query = (data.get('destination') or data.get('query') or '').strip()
    if not destination_query:
        return jsonify({'error': 'destination is required.'}), 400

    origin_pair = None
    try:
        origin_lat = data.get('origin_lat')
        origin_lon = data.get('origin_lon')
        if origin_lat is not None and origin_lon is not None:
            origin_pair = (float(origin_lat), float(origin_lon))
    except (TypeError, ValueError):
        origin_pair = None

    if not origin_pair:
        current_location = parse_location_snapshot(tourist.last_known_location)
        if current_location and current_location.get('latitude') is not None and current_location.get('longitude') is not None:
            origin_pair = (current_location['latitude'], current_location['longitude'])

    if not origin_pair:
        return jsonify({'error': 'Your current location is not available yet.'}), 400

    destination = resolve_navigation_destination(destination_query, near=origin_pair)
    if not destination:
        return jsonify({'error': f'Could not find a route target for "{destination_query}".'}), 404

    route = fetch_navigation_route(
        origin_pair[0],
        origin_pair[1],
        destination['latitude'],
        destination['longitude'],
        travel_mode=(data.get('travel_mode') or 'driving').strip().lower(),
        include_steps=(str(data.get('with_steps', '1')).strip().lower() not in {'0', 'false', 'no', 'off'}),
    )

    directions_url = build_google_maps_directions_url(
        origin_pair[0],
        origin_pair[1],
        destination['latitude'],
        destination['longitude'],
        travel_mode=(data.get('travel_mode') or 'driving').strip().lower(),
    )

    response_payload = {
        'candidates': destination.pop('alternatives', []),
        'origin': {
            'latitude': origin_pair[0],
            'longitude': origin_pair[1],
            'label': 'Current location',
        },
        'destination': destination,
        'directions_url': directions_url,
    }

    if route and route.get('coordinates'):
        response_payload['route'] = {
            'provider': route['provider'],
            'profile': route.get('profile'),
            'distance_km': round((route.get('distance_m') or 0) / 1000, 2),
            'duration_min': round((route.get('duration_s') or 0) / 60, 1),
            'distance_m': route.get('distance_m'),
            'duration_s': route.get('duration_s'),
            'coordinates': route['coordinates'],
            'steps': route.get('steps') or [],
            'alternatives': route.get('alternatives') or [],
        }
    else:
        response_payload['route'] = None
        response_payload['message'] = 'Navigation preview is available, but live routing could not be loaded right now.'

    return jsonify(response_payload)


@app.route('/api/navigation/suggest')
def api_navigation_suggest():
    """Type-ahead place suggestions for the navigation search box."""
    query = (request.args.get('q') or '').strip()
    if len(query) < 3:
        return jsonify({'suggestions': []})

    near = None
    try:
        lat = request.args.get('lat')
        lon = request.args.get('lon')
        if lat is not None and lon is not None:
            near = (float(lat), float(lon))
    except (TypeError, ValueError):
        near = None

    if near is None:
        tourist = get_current_tourist()
        snapshot = parse_location_snapshot(tourist.last_known_location) if tourist else None
        if snapshot and snapshot.get('latitude') is not None:
            near = (snapshot['latitude'], snapshot['longitude'])

    suggestions = photon_suggestions(query, near=near, limit=5)
    if not suggestions:
        suggestions = geocode_candidates(query, near=near, limit=5)
    return jsonify({'suggestions': suggestions})


@app.route('/api/iot/blynk-webhook', methods=['GET', 'POST'])
def api_iot_blynk_webhook():
    """
    Dedicated instant endpoint for Blynk IoT Webhooks.
    To use: Set up a Blynk Webhook widget to POST to:
    {YOUR_URL}/api/iot/blynk-webhook?token={AUTH_TOKEN}&v3={V3_VALUE}&v4={URL}
    """
    # Handle both Query String (GET) and Form/JSON (POST)
    token = request.args.get('token') or (request.json or {}).get('token')
    v3 = request.args.get('v3') or (request.json or {}).get('v3')
    v4 = request.args.get('v4') or (request.json or {}).get('v4')
    
    if not token:
        return jsonify({'error': 'token is required'}), 400
        
    tourist = Tourist.query.filter_by(blynk_token=token).first()
    if not tourist:
        # Fallback to general environment token if it matches
        if token == os.environ.get('BLYNK_AUTH_TOKEN'):
            tourist = Tourist.query.filter_by(iot_mode_enabled=True).first()
            
    if not tourist:
        return jsonify({'error': 'No tourist profile matched this token'}), 404
        
    # Trigger SOS if v3 is high (1 or 255)
    if v3 and str(v3) in ["1", "255"]:
        trigger_hardware_sos(tourist, source_label='Blynk Webhook', map_url=v4)
        return jsonify({'status': 'SOS triggered'}), 200
        
    return jsonify({'status': 'received'}), 200


# ── ThingSpeak IoT  (/api/iot/thingspeak/...) ──
# The ESP32 in iot_device/safar_tracker.ino writes to a ThingSpeak channel:
#   field1 = latitude   field2 = longitude
#   field3 = SOS state (1 while the button is held)
#   field4 = GPS fix valid (1 = real coordinates, 0 = no lock yet)
# It posts every 20s, and immediately on an SOS press.

THINGSPEAK_CHANNEL_ID = os.environ.get('THINGSPEAK_CHANNEL_ID', '3465207').strip()
THINGSPEAK_READ_API_KEY = os.environ.get('THINGSPEAK_READ_API_KEY', '').strip()
THINGSPEAK_POLL_SECONDS = int(os.environ.get('THINGSPEAK_POLL_SECONDS', '10'))
THINGSPEAK_TOURIST_ID = os.environ.get('THINGSPEAK_TOURIST_ID', '').strip()
THINGSPEAK_FEED_URL = f'https://api.thingspeak.com/channels/{THINGSPEAK_CHANNEL_ID}/feeds.json'

# entry_id of the last row already acted on, so a re-read of the same SOS row
# does not fire a second alert. ThingSpeak keeps returning the latest entry
# between device writes (one write per 20s vs. a 10s poll).
_thingspeak_state = {'last_entry_id': None, 'last_error': None, 'last_ok_at': None}


def _thingspeak_fetch(results=1):
    """Read the most recent feed rows. Returns (payload, error_message)."""
    if not THINGSPEAK_CHANNEL_ID:
        return None, 'THINGSPEAK_CHANNEL_ID is not set.'

    params = {'results': max(1, min(int(results), 100))}
    if THINGSPEAK_READ_API_KEY:
        params['api_key'] = THINGSPEAK_READ_API_KEY

    try:
        response = requests.get(THINGSPEAK_FEED_URL, params=params, timeout=8)
    except requests.RequestException as exc:
        return None, f'ThingSpeak unreachable: {exc}'

    # A private channel without a valid read key answers 400 with the body "-1".
    if response.status_code != 200 or response.text.strip() == '-1':
        return None, (
            'ThingSpeak refused the read. The channel is private — set '
            'THINGSPEAK_READ_API_KEY to its Read API Key.'
        )

    try:
        return response.json(), None
    except ValueError:
        return None, 'ThingSpeak returned a malformed response.'


def _thingspeak_parse_entry(entry):
    """Turn one raw feed row into plain values, or None where the field is unusable."""
    def num(key):
        raw = entry.get(key)
        if raw is None or str(raw).strip() == '':
            return None
        try:
            return float(raw)
        except (TypeError, ValueError):
            return None

    lat, lon = num('field1'), num('field2')
    sos = num('field3')
    gps_valid = num('field4')

    # field4 is the sketch's own fix flag; it sends 0,0 with field4=0 before lock.
    located = bool(gps_valid) and lat is not None and lon is not None and (lat != 0.0 or lon != 0.0)

    return {
        'entry_id': entry.get('entry_id'),
        'created_at': entry.get('created_at'),
        'lat': lat,
        'lon': lon,
        'sos': sos == 1,
        'gps_valid': bool(gps_valid),
        'located': located,
        'status': entry.get('status'),
    }


def _thingspeak_target_tourist():
    """The demo rig is a single device, so it maps to exactly one tourist.

    Pin that with THINGSPEAK_TOURIST_ID. Without it the seeded demo rows
    (ten of them carry iot_mode_enabled) make the choice arbitrary — an
    unordered .first() is whatever Postgres happens to scan first, so an SOS
    could be filed against the wrong person.
    """
    if THINGSPEAK_TOURIST_ID:
        try:
            pinned = db.session.get(Tourist, int(THINGSPEAK_TOURIST_ID))
        except (TypeError, ValueError):
            pinned = None
        if pinned:
            return pinned
        print(f'[ThingSpeak] THINGSPEAK_TOURIST_ID={THINGSPEAK_TOURIST_ID} matches no tourist.')

    return (
        Tourist.query.filter_by(iot_mode_enabled=True).order_by(Tourist.id.desc()).first()
        or Tourist.query.order_by(Tourist.id.desc()).first()
    )


@app.route('/api/iot/thingspeak/feed')
def api_thingspeak_feed():
    """Live device telemetry for the admin dashboard."""
    try:
        results = int(request.args.get('results', 20))
    except (TypeError, ValueError):
        results = 20

    payload, error = _thingspeak_fetch(results)
    if error:
        return jsonify({
            'connected': False,
            'error': error,
            'channel_id': THINGSPEAK_CHANNEL_ID,
            'entries': [],
        }), 200

    channel = payload.get('channel') or {}
    entries = [_thingspeak_parse_entry(e) for e in (payload.get('feeds') or [])]
    latest = entries[-1] if entries else None

    return jsonify({
        'connected': True,
        'channel_id': THINGSPEAK_CHANNEL_ID,
        'channel_name': channel.get('name'),
        'last_entry_at': channel.get('updated_at'),
        'latest': latest,
        'entries': entries,
    })


def thingspeak_loop():
    """Polls the ThingSpeak channel for GPS updates and SOS presses."""
    if not THINGSPEAK_CHANNEL_ID:
        print('[ThingSpeak] No channel configured — poller not started.')
        return

    warned_about_key = False

    while True:
        with app.app_context():
            payload, error = _thingspeak_fetch(1)

            if error:
                _thingspeak_state['last_error'] = error
                # The missing-key case never fixes itself; say it once, not every 10s.
                if 'THINGSPEAK_READ_API_KEY' in error:
                    if not warned_about_key:
                        print(f'[ThingSpeak] {error}')
                        warned_about_key = True
                else:
                    print(f'[ThingSpeak] {error}')
            else:
                warned_about_key = False
                _thingspeak_state['last_error'] = None
                _thingspeak_state['last_ok_at'] = datetime.now()

                feeds = payload.get('feeds') or []
                if feeds:
                    entry = _thingspeak_parse_entry(feeds[-1])
                    is_new = entry['entry_id'] != _thingspeak_state['last_entry_id']
                    _thingspeak_state['last_entry_id'] = entry['entry_id']

                    try:
                        tourist = _thingspeak_target_tourist()
                        if tourist and is_new:
                            if entry['located']:
                                tourist.last_known_location = f"Lat: {entry['lat']}, Lon: {entry['lon']}"
                                tourist.last_updated_at = datetime.now()
                                print(f"[ThingSpeak] 🌍 GPS {entry['lat']}, {entry['lon']} for {tourist.name}")

                            if entry['sos']:
                                map_url = (
                                    f"https://maps.google.com/?q={entry['lat']},{entry['lon']}"
                                    if entry['located'] else None
                                )
                                print(f"[ThingSpeak] 🔥 SOS press for {tourist.name} (entry {entry['entry_id']})")
                                trigger_hardware_sos(tourist, source_label='ThingSpeak Channel', map_url=map_url)
                            else:
                                db.session.commit()
                    except Exception as exc:
                        db.session.rollback()
                        print(f'[ThingSpeak] Could not apply telemetry: {exc}')

        time.sleep(max(5, THINGSPEAK_POLL_SECONDS))


# ── Admin / Dashboard ─────────────────────────

@app.route('/api/admin/tourists')
def admin_tourists():
    tourists = Tourist.query.order_by(Tourist.id.desc()).all()
    now = datetime.now()
    result = []
    for t in tourists:
        last_up = t.last_updated_at or t.registration_date
        # Active in last 15 minutes or having active session = Online
        is_online = bool(last_up and (now - last_up).total_seconds() < 900)
        device_mode = 'Fixed IoT Device' if t.iot_mode_enabled else 'Mobile Web App'
        device_status = 'ON' if is_online else 'OFF'

        result.append({
            'id':                  t.id,
            'name':                t.name,
            'phone':               t.phone,
            'safety_score':        t.safety_score,
            'last_known_location': t.last_known_location,
            'visit_end_date':      t.visit_end_date.isoformat(),
            'iot_mode_enabled':    bool(t.iot_mode_enabled),
            'blynk_token':         bool(t.blynk_token),
            'is_online':           is_online,
            'device_mode':         device_mode,
            'device_status':       device_status,
            'last_updated_at':     last_up.isoformat() if last_up else None,
        })
    return jsonify(result)


@app.route('/api/admin/alerts')
def admin_alerts():
    alerts = Alert.query.order_by(Alert.timestamp.desc()).limit(50).all()
    return jsonify([{
        'tourist_name': a.tourist.name,
        'alert_type':   a.alert_type,
        'location':     a.location,
        'timestamp':    a.timestamp.strftime('%d-%b-%Y %H:%M:%S'),
    } for a in alerts])


@app.route('/api/admin/anomalies')
def admin_anomalies():
    anomalies = (
        Anomaly.query.filter_by(status='active')
        .order_by(Anomaly.timestamp.desc())
        .limit(50).all()
    )
    return jsonify([{
        'tourist_name': a.tourist.name,
        'anomaly_type': a.anomaly_type,
        'description':  a.description,
        'timestamp':    a.timestamp.strftime('%d-%b-%Y %H:%M:%S'),
    } for a in anomalies])


# Cron endpoint (call from external scheduler)
@app.route('/cron/anomaly-check/<secret_key>')
def cron_anomaly_check(secret_key):
    cron_secret = os.environ.get('CRON_SECRET_KEY')
    if not cron_secret or secret_key != cron_secret:
        return jsonify({'error': 'Unauthorized.'}), 401
    check_for_anomalies()
    return jsonify({'message': 'Anomaly check complete.'}), 200


# ─────────────────────────────────────────────
# ════════════════════════════════════════════
#  SOCKET IO EVENTS  (real-time group chat)
# ════════════════════════════════════════════
# ─────────────────────────────────────────────

# Online tracking: { room_id: { sid: username } }
online_users = {}

def _broadcast_online(room):
    """Push updated online list to everyone in the room."""
    users = list(set(online_users.get(room, {}).values()))
    socketio.emit('online_users', {'users': users}, room=room)


@socketio.on('join')
def on_join(data):
    room = data.get('group_id')
    username = data.get('username', '')
    if not room:
        return
    join_room(room)

    # Track online user
    sid = request.sid
    if room not in online_users:
        online_users[room] = {}
    online_users[room][sid] = username

    # Broadcast join + online list
    emit('user_joined', {'username': username}, room=room, include_self=False)
    _broadcast_online(room)


@socketio.on('leave')
def on_leave(data):
    room = data.get('group_id')
    username = data.get('username', '')
    if not room:
        return
    leave_room(room)

    # Remove from online tracking
    sid = request.sid
    if room in online_users:
        online_users[room].pop(sid, None)
        if not online_users[room]:
            del online_users[room]

    emit('user_left', {'username': username}, room=room)
    _broadcast_online(room)


@socketio.on('disconnect')
def on_disconnect():
    """Clean up all rooms when a user disconnects."""
    sid = request.sid
    for room in list(online_users.keys()):
        if sid in online_users[room]:
            username = online_users[room].pop(sid)
            if not online_users[room]:
                del online_users[room]
            emit('user_left', {'username': username}, room=room)
            _broadcast_online(room)


@socketio.on('typing')
def on_typing(data):
    room = data.get('group_id')
    username = data.get('username', '')
    if room:
        emit('user_typing', {'username': username}, room=room, include_self=False)


@socketio.on('stop_typing')
def on_stop_typing(data):
    room = data.get('group_id')
    username = data.get('username', '')
    if room:
        emit('user_stop_typing', {'username': username}, room=room, include_self=False)


@socketio.on('send_message')
def on_send_message(data):
    """
    Expect: { group_id, message }
    Session must contain user_id.
    """
    user = get_current_user()
    if not user:
        return

    group_id = data.get('group_id')
    text     = (data.get('message') or '').strip()
    if not group_id or not text:
        return

    member = GroupMember.query.filter_by(
        group_id=group_id, user_id=user.id, join_status='Approved'
    ).first()
    if not member:
        return

    msg = build_group_message(
        group_id=group_id,
        sender_id=user.id,
        text=text,
        message_type='text',
    )
    db.session.commit()
    emit('new_message', serialize_group_message(msg), room=group_id)


# ─────────────────────────────────────────────
# DB INIT + SERVER ENTRY POINTS
# ─────────────────────────────────────────────

def init_db():
    with app.app_context():
        try:
            db.create_all()
            ensure_group_schema()
            ensure_user_schema()
            os.makedirs(GROUP_UPLOAD_DIR, exist_ok=True)
            os.makedirs(GROUP_MESSAGE_UPLOAD_DIR, exist_ok=True)
            seed_safety_zones()
            print("Database ready.")
        except Exception as e:
            print(f"[DB] Warning: db.create_all() encountered an issue (tables may already exist): {e}")
            ensure_group_schema()
            ensure_user_schema()
            os.makedirs(GROUP_UPLOAD_DIR, exist_ok=True)
            os.makedirs(GROUP_MESSAGE_UPLOAD_DIR, exist_ok=True)
            print("Database ready (skipped schema creation).")


def _is_bind_error(error: OSError) -> bool:
    """True when the socket bind was blocked or already in use."""
    msg = str(error).lower()
    return (
        getattr(error, "winerror", None) in {10013, 10048}
        or "forbidden by its access permissions" in msg
        or "only one usage of each socket address" in msg
    )


def run_server(host=None, port=None, debug=False):
    """Entry point used by main.py / web.py launchers."""
    init_db()

    resolved_host = host or os.environ.get("HOST")
    if not resolved_host:
        resolved_host = "127.0.0.1" if debug else "0.0.0.0"

    if port is None:
        default_port = "5050" if debug else "5000"
        port_text = os.environ.get("PORT", default_port)
    else:
        port_text = str(port)

    try:
        resolved_port = int(port_text)
    except ValueError:
        resolved_port = 5050 if debug else 5000

    candidates = [(resolved_host, resolved_port)]
    if resolved_host != "127.0.0.1":
        candidates.append(("127.0.0.1", resolved_port))
    for fallback_port in (5050, 8000, 8080, 5001):
        for fallback_host in (resolved_host, "127.0.0.1"):
            pair = (fallback_host, fallback_port)
            if pair not in candidates:
                candidates.append(pair)

    last_error = None
    for h, p in candidates:
        try:
            print(f"[Server] Trying http://{h}:{p}")
            run_kwargs = {'host': h, 'port': p, 'debug': debug}
            if debug or os.environ.get("ALLOW_UNSAFE_WERKZEUG", "0") == "1":
                run_kwargs['allow_unsafe_werkzeug'] = True
            socketio.run(app, **run_kwargs)
            return
        except OSError as exc:
            if not _is_bind_error(exc):
                raise
            last_error = exc
            print(f"[Server] Bind failed on {h}:{p} ({exc}). Trying next option...")

    raise RuntimeError(f"Could not bind any local server port. Last error: {last_error}")


def anomaly_loop():
    while True:
        try:
            check_for_anomalies()
        except Exception as e:
            print(f"Anomaly loop error: {e}")
        time.sleep(300)

def serial_monitor_loop():
    """Reads directly from the ESP32 over USB at 115200 baud for absolute 0-latency alerts, auto-detecting COM port."""
    try:
        import serial
        import serial.tools.list_ports
    except ImportError:
        print("[USB Serial] PySerial not installed. Run: pip install pyserial")
        return
        
    ser = None
    while True:
        if ser is None or not ser.is_open:
            ports = list(serial.tools.list_ports.comports())
            # Usually Arduino/ESP appear as USB Serial Device
            for p in ports:
                try:
                    ser = serial.Serial(p.device, 115200, timeout=1)
                    print(f"[USB Serial] 🟢 Successfully connected to {p.device} directly! Bypassing cloud latency.")
                    break
                except Exception:
                    pass
            if ser is None or not ser.is_open:
                time.sleep(5) # Retry finding port every 5 seconds
                continue

        try:
            if ser.in_waiting > 0:
                line = ser.readline().decode('utf-8', errors='ignore').strip()
                
                if line:
                    with app.app_context():
                        is_sos = "SOS BUTTON PRESSED" in line.upper() or "SOS ALERT PRESSED" in line.upper()
                        is_gps = line.startswith("GPS:")
                        
                        if is_sos:
                            print(f"[USB Serial] 🚨 INSTANT HARDWARE SOS DETECTED FROM {ser.port}!!!")
                        
                        # Link this hardware to the first Active IoT Tourist
                        user = Tourist.query.filter_by(iot_mode_enabled=True).first()
                        if not user:
                            if is_sos or is_gps:
                                print(f"[USB Serial] ⚠️ Event ignored: No Tourist has IoT Mode enabled! Please enable it in the frontend profile.")
                            continue
                            
                        # 1. 0-LATENCY USB SOS TRIGGER
                        if is_sos:
                            trigger_hardware_sos(user, source_label='Direct USB Serial')
                            
                        # 2. LOCAL USB GPS TRACKING TRIGGER
                        elif is_gps:
                            try:
                                coords = line.replace("GPS:", "").split(",")
                                if len(coords) == 2:
                                    lat, lon = coords[0].strip(), coords[1].strip()
                                    if float(lat) != 0.0 and float(lon) != 0.0:
                                        user.last_known_location = f"Lat: {lat}, Lon: {lon}"
                                        user.last_updated_at = datetime.now()
                                        db.session.commit()
                                        print(f"[USB Serial] 🌍 GPS Update for user {user.name} ({user.id}): Lat {lat}, Lon {lon}")
                            except ValueError:
                                pass # Incomplete or corrupt GPS stream
                                
        except Exception as e:
            print(f"[USB Serial] 🔴 Communication Error: {e}")
            time.sleep(2)

def rakesh_db_agent():
    """High AI Agent 'Rakesh': Permanently monitors and self-heals the Supabase connection."""
    with app.app_context():
        supabase_api = os.environ.get('SUPABASE_URL')
        while True:
            try:
                # 1. Check REST API Health (Bypasses port blocks, verifies database is online)
                rest_ok = False
                if supabase_api:
                    try:
                        res = requests.get(f"{supabase_api}/rest/v1/", timeout=5)
                        rest_ok = res.status_code in [200, 401, 403, 404]
                    except:
                        pass
                
                # 2. Check SQLAlchemy Pool Health
                pool_ok = False
                try:
                    with db.engine.connect() as conn:
                        conn.execute(text("SELECT 1"))
                        pool_ok = True
                except Exception as e:
                    err_msg = str(e).lower()
                    if "circuit breaker" in err_msg or "timeout" in err_msg:
                        print(f"[Agent Rakesh] ⚠️ DB Pool Stalled. Forcing pool flush and auto-reconnect...")
                        db.engine.dispose() # Flushes all dead connections to reset the circuit breaker
                
                if pool_ok:
                    pass # Silent operation when healthy to avoid console spam
                elif rest_ok and not pool_ok:
                    print("[Agent Rakesh] 🔄 Supabase Cloud is ONLINE, but Pooler is blocked. Swapped and reset pool.")
                else:
                    print("[Agent Rakesh] ❌ CRITICAL: Supabase is completely unreachable from this network.")
                    
            except Exception as e:
                print(f"[Agent Rakesh] Diagnostics error: {e}")
            
            time.sleep(30) # Rakesh monitors every 30 seconds

@app.before_request
def start_background_threads():
    if not hasattr(app, 'threads_started'):
        if not app.config.get('DB_CONNECTION_READY', True):
            return
        app.threads_started = True
        threading.Thread(target=anomaly_loop, daemon=True).start()
        # The tracker now writes to ThingSpeak instead of Blynk.
        threading.Thread(target=thingspeak_loop, daemon=True).start()
        threading.Thread(target=serial_monitor_loop, daemon=True).start()
        threading.Thread(target=rakesh_db_agent, daemon=True).start()
        print("[Agent Rakesh] 🕶️ Activated. Monitoring Supabase health in background...")


if __name__ == '__main__':
    run_server(debug=os.environ.get("APP_DEBUG", "0") == "1")
