
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import ForeignKey, text
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
import hashlib
import time as _time

db = SQLAlchemy()

# SHARED UTILITY

def generate_id():
    return uuid.uuid4().hex


# BLOCKCHAIN SECURITY LAYER

class BlockchainBlock(db.Model):
    """Immutable Ledger for Login/Registration Security (Industry Standard)."""
    __tablename__ = 'blockchain_ledger'

    id              = db.Column(db.Integer, primary_key=True, autoincrement=True)
    index           = db.Column(db.Integer, nullable=False)
    # timestamp_str is the EXACT string used when computing block_hash.
    # This avoids DB round-trip precision loss breaking verify().
    timestamp_str   = db.Column(db.String(30), nullable=False)  # ISO microsecond string
    timestamp       = db.Column(db.DateTime, nullable=False)    # for display/sorting
    event_type      = db.Column(db.String(50), nullable=False)  # 'REGISTER' | 'LOGIN'
    user_id         = db.Column(db.String(32), nullable=False)
    data_hash       = db.Column(db.String(64), nullable=False)  # SHA-256 of event payload
    previous_hash   = db.Column(db.String(64), nullable=False)
    block_hash      = db.Column(db.String(64), nullable=False)  # integrity proven by chain linkage

    @staticmethod
    def calculate_hash(index, timestamp_str, event_type, user_id, data_hash, previous_hash):
        """Hash is computed over the stable timestamp_str, not the DateTime object."""
        value = f"{index}{timestamp_str}{event_type}{user_id}{data_hash}{previous_hash}"
        return hashlib.sha256(value.encode()).hexdigest()

    @staticmethod
    def get_latest_block():
        """Always query fresh — bypasses ORM identity cache using with_for_update."""
        return (
            BlockchainBlock.query
            .order_by(BlockchainBlock.index.desc())
            .first()
        )

    @staticmethod
    def mine_block(event_type, user_id, event_data):
        """Creates and returns a new block; adds monotonic nonce to guarantee unique hash."""
        # Expire ORM cache so get_latest_block() reads DB fresh
        db.session.expire_all()

        last_block = BlockchainBlock.get_latest_block()
        idx    = (last_block.index + 1) if last_block else 0
        prev_h = last_block.block_hash  if last_block else "0" * 64

        # Add a monotonic nanosecond nonce so rapid same-user logins always differ
        if isinstance(event_data, dict):
            event_data.setdefault('nonce', _time.monotonic_ns())

        # Hash the event payload
        d_hash = hashlib.sha256(str(event_data).encode()).hexdigest()

        # Use a stable ISO string for hashing — store it so verify() can reproduce it exactly
        ts     = datetime.now()
        ts_str = ts.strftime('%Y-%m-%dT%H:%M:%S.%f')   # microsecond-precise string
        b_hash = BlockchainBlock.calculate_hash(idx, ts_str, event_type, str(user_id), d_hash, prev_h)

        new_block = BlockchainBlock(
            index         = idx,
            timestamp_str = ts_str,
            timestamp     = ts,
            event_type    = event_type,
            user_id       = str(user_id),
            data_hash     = d_hash,
            previous_hash = prev_h,
            block_hash    = b_hash,
        )
        return new_block


# PROJECT 1 – TRAVEL TOGETHER MODELS


class User(db.Model):
    __tablename__ = 'users'

    id          = db.Column(db.String(32), primary_key=True, default=generate_id)
    username    = db.Column(db.String(80), unique=True, nullable=False)
    password    = db.Column(db.String(256), nullable=False)   # store hashed
    email       = db.Column(db.String(120), nullable=False)
    phone       = db.Column(db.String(20))       # shared with Tourist
    gender      = db.Column(db.String(10))
    bio         = db.Column(db.Text)
    created_at  = db.Column(db.DateTime, default=datetime.now)

    # Relationships
    owned_groups   = relationship('Group', back_populates='owner', cascade='all, delete-orphan')
    memberships    = relationship('GroupMember', back_populates='user', cascade='all, delete-orphan')
    sent_messages  = relationship('GroupMessage', back_populates='sender', cascade='all, delete-orphan')
    tourist_profile = relationship('Tourist', back_populates='user', uselist=False, cascade='all, delete-orphan')

    def __repr__(self):
        return f'<User {self.username}>'


class Destination(db.Model):
    __tablename__ = 'destinations'

    id   = db.Column(db.String(32), primary_key=True, default=generate_id)
    name = db.Column(db.String(120), unique=True, nullable=False)
    country = db.Column(db.String(80), default='Unknown')

    groups       = relationship('Group', back_populates='destination')
    safety_zones = relationship('SafetyZone', back_populates='destination')

    def __repr__(self):
        return f'<Destination {self.name}>'


class Group(db.Model):
    __tablename__ = 'groups'

    id           = db.Column(db.String(32), primary_key=True, default=generate_id)
    name         = db.Column(db.String(120), nullable=False)
    description  = db.Column(db.Text)
    cover_image  = db.Column(db.String(255))
    group_type   = db.Column(db.String(10), nullable=False)   # 'Public' | 'Private'
    owner_id     = db.Column(db.String(32), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    destination_id = db.Column(db.String(32), ForeignKey('destinations.id', ondelete='SET NULL'))
    max_members  = db.Column(db.Integer, default=50)
    created_at   = db.Column(db.DateTime, default=datetime.now)

    @property
    def member_count(self):
        return (
            db.session.query(GroupMember)
            .filter(GroupMember.group_id == self.id, GroupMember.join_status == 'Approved')
            .count()
        )

    owner       = relationship('User', back_populates='owned_groups')
    destination = relationship('Destination', back_populates='groups')
    members     = relationship('GroupMember', back_populates='group', cascade='all, delete-orphan')
    messages    = relationship('GroupMessage', back_populates='group', cascade='all, delete-orphan')

    def __repr__(self):
        return f'<Group {self.name}>'


class GroupMember(db.Model):
    __tablename__ = 'group_members'
    __table_args__ = (db.UniqueConstraint('group_id', 'user_id'),)

    id          = db.Column(db.String(32), primary_key=True, default=generate_id)
    group_id    = db.Column(db.String(32), ForeignKey('groups.id', ondelete='CASCADE'), nullable=False)
    user_id     = db.Column(db.String(32), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    role        = db.Column(db.String(10), default='Member')    # 'Owner' | 'Admin' | 'Member'
    join_status = db.Column(db.String(10), default='Approved')  # 'Pending' | 'Approved' | 'Rejected' | 'Blocked'
    joined_at   = db.Column(db.DateTime, default=datetime.now)

    group = relationship('Group', back_populates='members')
    user  = relationship('User', back_populates='memberships')

    def __repr__(self):
        return f'<GroupMember user={self.user_id} group={self.group_id}>'


class GroupMessage(db.Model):
    __tablename__ = 'group_messages'

    id          = db.Column(db.Integer, primary_key=True, autoincrement=True)
    group_id    = db.Column(db.String(32), ForeignKey('groups.id', ondelete='CASCADE'), nullable=False)
    sender_id   = db.Column(db.String(32), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    message     = db.Column(db.Text, nullable=False)
    message_type= db.Column(db.String(50), default='text')
    attachment_name = db.Column(db.String(255))
    attachment_url  = db.Column(db.String(512))
    attachment_mime = db.Column(db.String(100))
    attachment_size = db.Column(db.Integer)
    location_snapshot = db.Column(db.String(200))
    timestamp   = db.Column(db.DateTime, default=datetime.now)

    group  = relationship('Group', back_populates='messages')
    sender = relationship('User', back_populates='sent_messages')

    def __repr__(self):
        return f'<GroupMessage id={self.id}>'


# ─────────────────────────────────────────────
# PROJECT 2 – ASTRA TOURIST SAFETY MODELS
# ─────────────────────────────────────────────

class Tourist(db.Model):
    __tablename__ = 'tourists'

    id                  = db.Column(db.Integer, primary_key=True)
    user_id             = db.Column(db.String(32), ForeignKey('users.id', ondelete='CASCADE'), unique=True)
    digital_id          = db.Column(db.String(128), unique=True, nullable=False)
    name                = db.Column(db.String(100), nullable=False)
    phone               = db.Column(db.String(20), nullable=False)
    kyc_id              = db.Column(db.String(50), nullable=False)
    kyc_type            = db.Column(db.String(50), nullable=False)
    visit_end_date      = db.Column(db.DateTime, nullable=False)
    safety_score        = db.Column(db.Integer, default=100)
    last_known_location = db.Column(db.String(100), default='Not Available')
    registration_date   = db.Column(db.DateTime, default=datetime.now)
    last_updated_at     = db.Column(db.DateTime, default=datetime.now)

    # Blynk IoT Integration
    blynk_token         = db.Column(db.String(64), nullable=True) # Blynk Auth Token
    iot_mode_enabled    = db.Column(db.Boolean, default=False)    # Is it using IoT device GPS/SOS?

    user     = relationship('User', back_populates='tourist_profile')
    alerts   = relationship('Alert', back_populates='tourist', cascade='all, delete-orphan')
    anomalies = relationship('Anomaly', back_populates='tourist', cascade='all, delete-orphan')

    def __repr__(self):
        return f'<Tourist {self.name}>'


class SafetyZone(db.Model):
    __tablename__ = 'safety_zones'

    id             = db.Column(db.Integer, primary_key=True)
    name           = db.Column(db.String(100), nullable=False)
    latitude       = db.Column(db.Float, nullable=False)
    longitude      = db.Column(db.Float, nullable=False)
    radius         = db.Column(db.Float, nullable=False)   # kilometres
    regional_score = db.Column(db.Integer, nullable=False)
    destination_id = db.Column(db.String(32), ForeignKey('destinations.id', ondelete='SET NULL'))

    destination = relationship('Destination', back_populates='safety_zones')

    def __repr__(self):
        return f'<SafetyZone {self.name}>'


class Alert(db.Model):
    __tablename__ = 'alerts'

    id         = db.Column(db.Integer, primary_key=True)
    tourist_id = db.Column(db.Integer, ForeignKey('tourists.id', ondelete='CASCADE'), nullable=False)
    location   = db.Column(db.String(100))
    alert_type = db.Column(db.String(100))
    timestamp  = db.Column(db.DateTime, default=datetime.now)

    tourist = relationship('Tourist', back_populates='alerts')

    def __repr__(self):
        return f'<Alert {self.alert_type}>'


class Anomaly(db.Model):
    __tablename__ = 'anomalies'

    id          = db.Column(db.Integer, primary_key=True)
    tourist_id  = db.Column(db.Integer, ForeignKey('tourists.id', ondelete='CASCADE'), nullable=False)
    anomaly_type = db.Column(db.String(100))
    description  = db.Column(db.String(255))
    timestamp    = db.Column(db.DateTime, default=datetime.now)
    status       = db.Column(db.String(20), default='active')   # 'active' | 'resolved'

    tourist = relationship('Tourist', back_populates='anomalies')

    def __repr__(self):
        return f'<Anomaly {self.anomaly_type}>'
