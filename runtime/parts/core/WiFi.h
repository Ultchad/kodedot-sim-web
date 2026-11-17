// WiFi for dotcore: NOT CONNECTED, on purpose. The bench does not route sockets to the simulator's network objects from a sketch (decision in
// docs/STATUS-parts.md), so nothing here fakes success: begin() leaves the radio disconnected, status() says so, WiFiClient::connect() fails,
// scans find nothing. The first call prints one note in the part's console (not on Serial, so sketches that parse Serial still work).
#pragma once
#include "Arduino.h"
#include <IPAddress.h>
#include <string.h>

enum wl_status_t { WL_NO_SHIELD = 255, WL_IDLE_STATUS = 0, WL_NO_SSID_AVAIL = 1, WL_SCAN_COMPLETED = 2, WL_CONNECTED = 3, WL_CONNECT_FAILED = 4, WL_CONNECTION_LOST = 5, WL_DISCONNECTED = 6 };
enum wifi_mode_t { WIFI_OFF = 0, WIFI_STA = 1, WIFI_AP = 2, WIFI_AP_STA = 3 };
#define WIFI_FIRMWARE_LATEST_VERSION "dotbench-none"

static inline void dp_wifi_note(const char *what) {
  static bool said = false; if (said) return; said = true;
  char b[160]; int n = snprintf(b, sizeof b, "WiFi is not simulated by dotbench: %s -> not connected (no network is reachable from a sketch).", what);
  dp_log((const uint8_t *)b, n);
}
class WiFiClass {
public:
  int begin(const char *ssid = nullptr, const char * = nullptr) { dp_wifi_note("WiFi.begin()"); (void)ssid; return WL_NO_SSID_AVAIL; }
  int begin(const char *ssid, int, const char *) { return begin(ssid); }
  int beginAP(const char *, const char * = nullptr) { dp_wifi_note("WiFi.beginAP()"); return WL_CONNECT_FAILED; }
  bool mode(wifi_mode_t) { return true; }
  bool softAP(const char *, const char * = nullptr) { dp_wifi_note("softAP()"); return false; }
  bool config(IPAddress, IPAddress = IPAddress(), IPAddress = IPAddress()) { return true; }
  void disconnect(bool = false) {}
  bool setHostname(const char *) { return true; }
  void setAutoReconnect(bool) {}
  uint8_t status() { return WL_DISCONNECTED; }
  bool isConnected() { return false; }
  IPAddress localIP() { return IPAddress(0, 0, 0, 0); }
  IPAddress gatewayIP() { return IPAddress(0, 0, 0, 0); }
  IPAddress subnetMask() { return IPAddress(0, 0, 0, 0); }
  String SSID() { return String(); }
  int32_t RSSI() { return 0; }
  int16_t scanNetworks() { dp_wifi_note("WiFi.scanNetworks()"); return 0; }
  String SSID(uint8_t) { return String(); }
  uint8_t *macAddress(uint8_t *m) { memset(m, 0, 6); return m; }
  String macAddress() { return String("00:00:00:00:00:00"); }
  String firmwareVersion() { return String(WIFI_FIRMWARE_LATEST_VERSION); }
  void end() {}
};
static WiFiClass WiFi;
