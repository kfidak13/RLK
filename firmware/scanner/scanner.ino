// IR pan-tilt scanner firmware. Answers one-line serial commands; the browser
// runs the sweep. The protocol is in docs/superpowers/specs/2026-11-02-3d-scan-viewer-design.md.

const int ENABLE_PIN = 8;  // LOW = enabled
const int X_STEP_PIN = 2;
const int X_DIR_PIN = 5;
const int Y_STEP_PIN = 3;
const int Y_DIR_PIN = 6;
const int SENSOR_PIN = A3;

const unsigned int STEP_PERIOD_US = 10000;  // about 100 steps per second
const int SETTLE_MS = 100;
const int READINGS = 10;
const int READING_GAP_MS = 40;

long panPos = 0;
long tiltPos = 0;
long tiltMin = -20;
long tiltMax = 20;
bool motorsOn = false;
bool tiltIsX = false;

char line[32];
byte lineLen = 0;
bool lineTooLong = false;

void setMotors(bool on) {
  motorsOn = on;
  digitalWrite(ENABLE_PIN, on ? LOW : HIGH);
}

void setup() {
  pinMode(ENABLE_PIN, OUTPUT);
  setMotors(false);
  pinMode(X_STEP_PIN, OUTPUT);
  pinMode(X_DIR_PIN, OUTPUT);
  pinMode(Y_STEP_PIN, OUTPUT);
  pinMode(Y_DIR_PIN, OUTPUT);
  Serial.begin(115200);
  Serial.println("ready");
}

void pulse(int stepPin) {
  digitalWrite(stepPin, HIGH);
  delayMicroseconds(2);
  digitalWrite(stepPin, LOW);
}

// ponytail: fixed speed, no ramp. Add acceleration if test moves skip steps.
void stepAxes(long pan, long tilt) {
  const int panStepPin = tiltIsX ? Y_STEP_PIN : X_STEP_PIN;
  const int panDirPin = tiltIsX ? Y_DIR_PIN : X_DIR_PIN;
  const int tiltStepPin = tiltIsX ? X_STEP_PIN : Y_STEP_PIN;
  const int tiltDirPin = tiltIsX ? X_DIR_PIN : Y_DIR_PIN;
  digitalWrite(panDirPin, pan >= 0 ? HIGH : LOW);
  digitalWrite(tiltDirPin, tilt >= 0 ? HIGH : LOW);
  delayMicroseconds(2);

  const long panSteps = labs(pan);
  const long tiltSteps = labs(tilt);
  const long steps = max(panSteps, tiltSteps);
  for (long i = 0; i < steps; i++) {
    if (i < panSteps) pulse(panStepPin);
    if (i < tiltSteps) pulse(tiltStepPin);
    delayMicroseconds(STEP_PERIOD_US);
  }
}

void handleMove(long pan, long tilt) {
  if (!motorsOn) {
    Serial.println("err off");
    return;
  }
  const long newTilt = tiltPos + tilt;
  if (newTilt < tiltMin || newTilt > tiltMax) {
    Serial.println("err limit");
    return;
  }
  stepAxes(pan, tilt);
  panPos += pan;
  tiltPos = newTilt;
  Serial.print("ok ");
  Serial.print(panPos);
  Serial.print(' ');
  Serial.println(tiltPos);
}

// Median, not mean: one wild reading from this sensor would skew an average.
void handleRead() {
  delay(SETTLE_MS);
  int readings[READINGS];
  for (int i = 0; i < READINGS; i++) {
    if (i > 0) delay(READING_GAP_MS);
    const int value = analogRead(SENSOR_PIN);
    int j = i;
    for (; j > 0 && readings[j - 1] > value; j--) readings[j] = readings[j - 1];
    readings[j] = value;
  }
  Serial.print("d ");
  Serial.println(readings[READINGS / 2]);
}

void handleLimits(long min, long max) {
  if (min > 0 || max < 0) {
    Serial.println("err cmd");
  } else if (tiltPos < min || tiltPos > max) {
    Serial.println("err limit");
  } else {
    tiltMin = min;
    tiltMax = max;
    Serial.println("ok");
  }
}

void handleLine() {
  long a, b;
  char extra;
  if (sscanf(line, "M %ld %ld%c", &a, &b, &extra) == 2) {
    handleMove(a, b);
  } else if (strcmp(line, "R") == 0) {
    handleRead();
  } else if (sscanf(line, "L %ld %ld%c", &a, &b, &extra) == 2) {
    handleLimits(a, b);
  } else if (strcmp(line, "A 0") == 0 || strcmp(line, "A 1") == 0) {
    tiltIsX = line[2] == '1';
    Serial.println("ok");
  } else if (strcmp(line, "Z") == 0) {
    panPos = 0;
    tiltPos = 0;
    Serial.println("ok");
  } else if (strcmp(line, "E") == 0) {
    setMotors(true);
    Serial.println("ok");
  } else if (strcmp(line, "D") == 0) {
    setMotors(false);
    Serial.println("ok");
  } else {
    Serial.println("err cmd");
  }
}

void loop() {
  while (Serial.available() > 0) {
    const char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') {
      if (lineLen < sizeof(line) - 1) {
        line[lineLen++] = c;
      } else {
        lineTooLong = true;
      }
      continue;
    }
    line[lineLen] = '\0';
    if (lineTooLong) {
      Serial.println("err cmd");
    } else {
      handleLine();
    }
    lineLen = 0;
    lineTooLong = false;
  }
}
