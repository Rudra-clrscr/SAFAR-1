from datetime import datetime, timedelta
from app import app, db, Tourist, Alert, Anomaly, User, trigger_hardware_sos

with app.app_context():
    # Find or create a test tourist
    t = Tourist.query.filter_by(blynk_token='2jkZ6xI1TFwbKW0q6BZsxBLe9PHz3kmV').first()
    if not t:
        print("Creating test tourist...")
        t = Tourist(
            user_id='test-user-id',
            name='IoT Tester',
            phone='+910000000000',
            kyc_id='TEST1234',
            kyc_type='ID',
            visit_end_date=datetime.now() + timedelta(days=1),
            blynk_token='2jkZ6xI1TFwbKW0q6BZsxBLe9PHz3kmV',
            iot_mode_enabled=True,
            digital_id='test-iot-id'
        )
        db.session.add(t)
        db.session.commit()
    
    print(f"Testing SOS for {t.name}...")
    trigger_hardware_sos(t, source_label='Unit Test', map_url='http://maps.google.com/test')
    
    # Check if records were created
    alert = Alert.query.filter_by(tourist_id=t.id).order_by(Alert.id.desc()).first()
    anomaly = Anomaly.query.filter_by(tourist_id=t.id, status='active').order_by(Anomaly.id.desc()).first()
    
    if alert and 'Visual: http://maps.google.com/test' in alert.location:
        print("✅ Alert created with Map URL!")
    else:
        print("❌ Alert creation failed or Map URL missing.")
        
    if anomaly and anomaly.anomaly_type == 'Hardware SOS':
        print("✅ Anomaly created!")
    else:
        print("❌ Anomaly creation failed.")
