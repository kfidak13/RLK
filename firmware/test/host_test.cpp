// Runs the firmware's command handling on the computer, with the Arduino API
// stubbed. Build and run from the repo root:
//   clang++ -std=c++17 -o /tmp/scanner_host_test firmware/test/host_test.cpp && /tmp/scanner_host_test
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define A3 17
typedef unsigned char byte;
using std::max;

int pinLevel[20];
int rises[20];
std::vector<int> nextReadings;

void pinMode(int, int) {}
void digitalWrite(int pin, int level) {
  if (level == HIGH && pinLevel[pin] == LOW) rises[pin]++;
  pinLevel[pin] = level;
}
void delay(unsigned long) {}
void delayMicroseconds(unsigned int) {}
int analogRead(int) {
  int value = nextReadings.back();
  nextReadings.pop_back();
  return value;
}

struct FakeSerial {
  std::string in, out;
  void begin(long) {}
  int available() { return in.size(); }
  char read() {
    char c = in[0];
    in.erase(0, 1);
    return c;
  }
  void print(const char* s) { out += s; }
  void print(long n) { out += std::to_string(n); }
  void print(char c) { out += c; }
  void println(const char* s) { out += std::string(s) + "\n"; }
  void println(long n) { out += std::to_string(n) + "\n"; }
  void println(int n) { out += std::to_string(n) + "\n"; }
} Serial;

#include "../scanner/scanner.ino"

int failures = 0;

void expectEq(const std::string& what, const std::string& got, const std::string& want) {
  if (got == want) return;
  printf("FAIL %s: got '%s', want '%s'\n", what.c_str(), got.c_str(), want.c_str());
  failures++;
}

void expectInt(const std::string& what, int got, int want) {
  expectEq(what, std::to_string(got), std::to_string(want));
}

std::string send(const std::string& text) {
  Serial.in = text + "\n";
  Serial.out.clear();
  loop();
  if (!Serial.out.empty() && Serial.out.back() == '\n') Serial.out.pop_back();
  return Serial.out;
}

void clearRises() { memset(rises, 0, sizeof(rises)); }

int main() {
  setup();
  expectEq("boot", Serial.out, "ready\n");
  expectInt("motors released at boot", pinLevel[ENABLE_PIN], HIGH);

  expectEq("move while released", send("M 1 0"), "err off");
  expectInt("no steps while released", rises[X_STEP_PIN], 0);

  expectEq("enable", send("E"), "ok");
  expectInt("enable pin low", pinLevel[ENABLE_PIN], LOW);

  clearRises();
  expectEq("pan move", send("M 3 0"), "ok 3 0");
  expectInt("pan steps X by default", rises[X_STEP_PIN], 3);
  expectInt("tilt driver untouched", rises[Y_STEP_PIN], 0);
  expectInt("positive direction", pinLevel[X_DIR_PIN], HIGH);

  clearRises();
  expectEq("past the limit", send("M 5 21"), "err limit");
  expectInt("refused move leaves pan still", rises[X_STEP_PIN], 0);
  expectInt("refused move leaves tilt still", rises[Y_STEP_PIN], 0);

  clearRises();
  expectEq("up to the limit", send("M -3 20"), "ok 0 20");
  expectInt("tilt steps Y by default", rises[Y_STEP_PIN], 20);
  expectInt("negative direction", pinLevel[X_DIR_PIN], LOW);
  expectEq("one past the limit", send("M 0 1"), "err limit");

  // Tightening limits past the current position must take effect, not be refused.
  expectEq("tighten past position", send("L -20 10"), "ok");
  expectEq("further out is refused", send("M 0 1"), "err limit");
  expectEq("pan still works outside the limits", send("M 1 0"), "ok 1 20");
  expectEq("back towards the range is allowed", send("M 0 -1"), "ok 1 19");
  expectEq("all the way back", send("M 0 -9"), "ok 1 10");
  expectEq("the new limit holds", send("M 0 1"), "err limit");

  expectEq("limits must include zero (min)", send("L 5 20"), "err cmd");
  expectEq("limits must include zero (max)", send("L -20 -5"), "err cmd");
  expectEq("rejected limits change nothing", send("M 0 1"), "err limit");
  expectEq("restore limits", send("L -20 20"), "ok");

  expectEq("zero", send("Z"), "ok");
  expectEq("position from new zero", send("M 0 20"), "ok 0 20");
  expectEq("limit from new zero", send("M 0 1"), "err limit");
  expectEq("back", send("M 0 -20"), "ok 0 0");

  clearRises();
  expectEq("swap tilt driver", send("A 1"), "ok");
  expectEq("tilt after swap", send("M 0 2"), "ok 0 2");
  expectInt("tilt now steps X", rises[X_STEP_PIN], 2);
  expectInt("pan driver idle", rises[Y_STEP_PIN], 0);
  expectEq("restore driver", send("A 0"), "ok");
  expectEq("bad driver", send("A 2"), "err cmd");

  nextReadings = {300, 1023, 310, 0, 305, 300, 290, 300, 295, 305};
  expectEq("median ignores spikes", send("R"), "d 300");

  expectEq("release", send("D"), "ok");
  expectInt("enable pin high", pinLevel[ENABLE_PIN], HIGH);
  expectEq("move after release", send("M 1 0"), "err off");

  expectEq("junk", send("hello"), "err cmd");
  expectEq("blank", send(""), "err cmd");
  expectEq("extra argument", send("M 1 2 3"), "err cmd");
  expectEq("missing argument", send("M 1"), "err cmd");
  expectEq("carriage return", send("E\r"), "ok");
  expectEq("overlong line", send(std::string(40, 'M')), "err cmd");
  expectEq("usable after overlong line", send("D"), "ok");

  printf(failures ? "%d failed\n" : "all passed\n", failures);
  return failures ? 1 : 0;
}
