import os
import sys
from datetime import datetime, timedelta
import random

# Ensure local imports work
PROJECT_ROOT = os.path.abspath(os.path.dirname(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app import app, db, hash_password
from database import (
    User, Destination, Group, GroupMember, GroupMessage,
    Tourist, SafetyZone, Alert, Anomaly, BlockchainBlock,
    generate_id
)

def seed_data():
    with app.app_context():
        print("Cleaning existing database tables (except safety zones)...")
        db.session.query(GroupMessage).delete()
        db.session.query(GroupMember).delete()
        db.session.query(Group).delete()
        db.session.query(Tourist).delete()
        db.session.query(User).delete()
        db.session.query(BlockchainBlock).delete()
        db.session.commit()

        print("1. Seeding Destinations...")
        dest_names = [
            ("Goa", "India"),
            ("Jaipur", "India"),
            ("Kerala", "India"),
            ("Manali", "India"),
            ("Varanasi", "India"),
            ("Agra", "India")
        ]
        dests = {}
        for name, country in dest_names:
            dest = Destination(id=generate_id(), name=name, country=country)
            db.session.add(dest)
            dests[name.lower()] = dest
        db.session.flush()

        print("2. Seeding Users...")
        user_data = [
            ("rudra", "rudra@safar.in", "+919457831890", "Male", "Explorer & nature lover. Always down for mountain trekking."),
            ("rakesh", "rakesh@safar.in", "+919876543210", "Male", "History buff and heritage traveler. Love exploring old fortresses."),
            ("ananya", "ananya@safar.in", "+919999999999", "Female", "Beach person. Sunset chaser and amateur photographer."),
            ("kabir", "kabir@safar.in", "+918888888888", "Male", "Backpacker traveling on a budget. Hitchhiker and street food critic."),
            ("aarav", "aarav@safar.in", "+917777777777", "Male", "Tech nomad working from the hills. Coffee and code.")
        ]
        users = {}
        for username, email, phone, gender, bio in user_data:
            user = User(
                id=generate_id(),
                username=username,
                password=hash_password("SafarPass123!"),  # Valid password format
                email=email,
                phone=phone,
                gender=gender,
                bio=bio,
                created_at=datetime.now() - timedelta(days=random.randint(5, 15))
            )
            db.session.add(user)
            users[username] = user
        db.session.flush()

        print("3. Seeding Tourist Profiles...")
        # Add tourist profiles for Rudra and Rakesh
        tourists = []
        
        # Rudra (Active tourist profile)
        unique_string_rudra = f"rudra:123456789012:{datetime.utcnow()}"
        digital_id_rudra = hash_password(unique_string_rudra)
        rudra_tourist = Tourist(
            user_id=users["rudra"].id,
            digital_id=digital_id_rudra,
            name="Rudra Sharma",
            phone=users["rudra"].phone,
            kyc_id="123456789012",
            kyc_type="Aadhaar",
            visit_end_date=datetime.now() + timedelta(days=12),
            safety_score=85,
            last_known_location="Lat: 28.6139, Lon: 77.2090",
            iot_mode_enabled=True,
            blynk_token="blynk_auth_token_mock_123"
        )
        db.session.add(rudra_tourist)
        tourists.append(rudra_tourist)

        # Rakesh (Active tourist profile)
        unique_string_rakesh = f"rakesh:P7851239:{datetime.utcnow()}"
        digital_id_rakesh = hash_password(unique_string_rakesh)
        rakesh_tourist = Tourist(
            user_id=users["rakesh"].id,
            digital_id=digital_id_rakesh,
            name="Rakesh Verma",
            phone=users["rakesh"].phone,
            kyc_id="P7851239",
            kyc_type="Passport",
            visit_end_date=datetime.now() + timedelta(days=5),
            safety_score=92,
            last_known_location="Lat: 26.9124, Lon: 75.7873"
        )
        db.session.add(rakesh_tourist)
        tourists.append(rakesh_tourist)
        db.session.flush()

        print("4. Seeding Groups...")
        group_data = [
            ("Goa Beach Bashers", "Chill vibes, beach volleyball, and shack hopping in North Goa. Join for sunset parties!", "Public", "rudra", "goa", 15),
            ("Jaipur Heritage Explorers", "Exploring Hawa Mahal, Amer Fort, and authentic Rajasthani street foods.", "Public", "rakesh", "jaipur", 12),
            ("Manali Winter Trek", "Backpacking trek to Solang Valley and Jogini waterfalls. Heavy snow prep needed.", "Private", "ananya", "manali", 8),
            ("Kerala Backwaters", "Relaxing houseboat tour in Alappuzha backwaters. Traditional fish curry and lagoons.", "Public", "kabir", "kerala", 20)
        ]
        groups = {}
        for name, desc, gtype, owner_name, dest_name, max_m in group_data:
            group = Group(
                id=generate_id(),
                name=name,
                description=desc,
                group_type=gtype,
                owner_id=users[owner_name].id,
                destination_id=dests[dest_name].id,
                max_members=max_m,
                created_at=datetime.now() - timedelta(days=random.randint(1, 4))
            )
            db.session.add(group)
            groups[name] = group
        db.session.flush()

        print("5. Seeding Memberships...")
        memberships = [
            # Goa Beach Bashers
            ("Goa Beach Bashers", "rudra", "Owner", "Approved"),
            ("Goa Beach Bashers", "ananya", "Member", "Approved"),
            ("Goa Beach Bashers", "aarav", "Member", "Approved"),
            ("Goa Beach Bashers", "kabir", "Member", "Pending"),
            # Jaipur Heritage Explorers
            ("Jaipur Heritage Explorers", "rakesh", "Owner", "Approved"),
            ("Jaipur Heritage Explorers", "kabir", "Member", "Approved"),
            ("Jaipur Heritage Explorers", "rudra", "Member", "Approved"),
            # Manali Winter Trek
            ("Manali Winter Trek", "ananya", "Owner", "Approved"),
            ("Manali Winter Trek", "kabir", "Member", "Approved"),
            ("Manali Winter Trek", "aarav", "Member", "Pending"),
            # Kerala Backwaters
            ("Kerala Backwaters", "kabir", "Owner", "Approved"),
            ("Kerala Backwaters", "rakesh", "Member", "Approved")
        ]
        for gname, uname, role, status in memberships:
            db.session.add(GroupMember(
                id=generate_id(),
                group_id=groups[gname].id,
                user_id=users[uname].id,
                role=role,
                join_status=status,
                joined_at=datetime.now() - timedelta(hours=random.randint(10, 48))
            ))
        db.session.flush()

        print("6. Seeding Messages...")
        msg_data = [
            # Goa Beach Bashers
            ("Goa Beach Bashers", "rudra", "Hey everyone! Welcome to the Goa Beach Bashers squad! 🌴"),
            ("Goa Beach Bashers", "ananya", "Hey Rudra! Super excited. Are we planning North or South Goa?"),
            ("Goa Beach Bashers", "rudra", "North Goa primarily! Anjuna and Baga beaches. Sunset party at Curlies is on the cards!"),
            ("Goa Beach Bashers", "aarav", "I am in! Let me know when we finalize flight dates so I can book my tickets."),
            # Jaipur Heritage Explorers
            ("Jaipur Heritage Explorers", "rakesh", "Welcome explorers! First stop on Saturday morning: Amer Fort 🏰"),
            ("Jaipur Heritage Explorers", "rudra", "Awesome. Let's make sure we go early to beat the heat."),
            ("Jaipur Heritage Explorers", "kabir", "Yes, and we can grab Pyaaz Kachori from Rawat Mishthan Bhandar right after!"),
            ("Jaipur Heritage Explorers", "rakesh", "Oh yes, that kachori is legendary. Added to the itinerary!")
        ]
        for gname, uname, text in msg_data:
            db.session.add(GroupMessage(
                group_id=groups[gname].id,
                sender_id=users[uname].id,
                message=text,
                message_type="text",
                timestamp=datetime.now() - timedelta(minutes=random.randint(5, 120))
            ))
        db.session.commit()

        print("7. Seeding Blockchain Audit Ledger...")
        # Populate blockchain with verified registration and login records
        # Registrations
        for uname, uobj in users.items():
            reg_event = {
                "username": uobj.username,
                "email": uobj.email,
                "ip": "127.0.0.1",
                "action": "ACCOUNT_CREATED"
            }
            block = BlockchainBlock.mine_block("REGISTER", uobj.id, reg_event)
            db.session.add(block)
            db.session.commit()

        # Logins
        for uname in ["rudra", "rakesh", "ananya"]:
            uobj = users[uname]
            login_event = {
                "username": uobj.username,
                "ip": "127.0.0.1",
                "status": "SUCCESS"
            }
            block = BlockchainBlock.mine_block("LOGIN", uobj.id, login_event)
            db.session.add(block)
            db.session.commit()

        print("\nDATABASE SUCCESSFULLY SEEDED WITH RICH SAMPLE DATA!")

if __name__ == "__main__":
    seed_data()
