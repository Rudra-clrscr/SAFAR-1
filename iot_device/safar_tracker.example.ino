/*************************************************************
  SAFAR — IoT Hardware Tracker (ESP32)

  Publishes GPS position and an SOS button state to a ThingSpeak
  channel. The SAFAR backend polls that channel (thingspeak_loop in
  app.py) to update the tourist's live location and to raise a
  hardware SOS alert on the admin dashboard.

  ── Setup ────────────────────────────────────────────────────
  1. Copy this file to `safar_tracker.ino` in the same folder.
     That name is gitignored, so your real credentials stay local.
  2. Fill in ssid / pass / channelID / writeAPIKey below.
  3. In the SAFAR backend `.env`, set:
        THINGSPEAK_CHANNEL_ID   = your channel id
        THINGSPEAK_READ_API_KEY = the channel's *Read* API Key
     (the Read key is separate from the write key used here)

  ── Channel field mapping (must match the backend) ───────────
     field1 = latitude
     field2 = longitude
     field3 = SOS state   (1 while the button is held, else 0)
     field4 = GPS fix valid (1 = real coordinates, 0 = no lock)

  ── Wiring (ESP32) ───────────────────────────────────────────
     GPS TX    -> GPIO 16 (RX2)
     GPS RX    -> GPIO 17 (TX2)
     SOS Btn   -> GPIO 4, wired to GND when pressed (INPUT_PULLUP)
     Onboard LED on GPIO 2 lights while SOS is held.
 *************************************************************/

#include <WiFi.h>
#include <WiFiClient.h>
#include <ThingSpeak.h>
#include <TinyGPS++.h>

// ── Fill these in ────────────────────────────────────────────
char ssid[] = "YOUR_WIFI_SSID";
char pass[] = "YOUR_WIFI_PASSWORD";

unsigned long channelID = 0000000;                  // ThingSpeak channel ID
const char * writeAPIKey = "YOUR_WRITE_API_KEY";    // ThingSpeak Write API Key
// ─────────────────────────────────────────────────────────────

const int SOS_BUTTON = 4;
const int ONBOARD_LED = 2;

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
WiFiClient client;

unsigned long lastUpdateTime = 0;
// ThingSpeak's free tier rejects writes faster than one per 15s.
const unsigned long updateInterval = 20000;

void connectWiFi() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.print("Connecting to WiFi");
    WiFi.begin(ssid, pass);
    while (WiFi.status() != WL_CONNECTED) {
      delay(500);
      Serial.print(".");
    }
    Serial.println("\nWiFi connected");
  }
}

void sendToThingSpeak(float lat, float lng, int sosState, int gpsValid) {
  ThingSpeak.setField(1, lat);
  ThingSpeak.setField(2, lng);
  ThingSpeak.setField(3, sosState);
  ThingSpeak.setField(4, gpsValid);

  if (sosState == 1) {
    ThingSpeak.setStatus("SOS Pressed");
  } else {
    ThingSpeak.setStatus("Normal");
  }

  int x = ThingSpeak.writeFields(channelID, writeAPIKey);

  if (x == 200) {
    Serial.println("ThingSpeak update successful");
  } else {
    Serial.print("Problem updating channel. HTTP error code: ");
    Serial.println(x);
  }
}

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600, SERIAL_8N1, 16, 17);

  pinMode(SOS_BUTTON, INPUT_PULLUP);
  pinMode(ONBOARD_LED, OUTPUT);

  connectWiFi();
  ThingSpeak.begin(client);
}

void loop() {
  connectWiFi();

  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  int gpsValid = gps.location.isValid() ? 1 : 0;
  float lat = gpsValid ? gps.location.lat() : 0.0;
  float lng = gpsValid ? gps.location.lng() : 0.0;

  // An SOS press posts immediately rather than waiting for the interval.
  if (digitalRead(SOS_BUTTON) == LOW) {
    digitalWrite(ONBOARD_LED, HIGH);
    Serial.println("!!! SOS ALERT PRESSED !!!");

    sendToThingSpeak(lat, lng, 1, gpsValid);
    lastUpdateTime = millis();

    while (digitalRead(SOS_BUTTON) == LOW) {
      delay(10);
    }

    delay(300);
    digitalWrite(ONBOARD_LED, LOW);
  }

  if (millis() - lastUpdateTime > updateInterval) {
    sendToThingSpeak(lat, lng, 0, gpsValid);
    lastUpdateTime = millis();
  }
}
