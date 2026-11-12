#include <math.h>

// CNC shield / A4988
const byte ENABLE_PIN = 8;
const byte X_STEP_PIN = 2;
const byte X_DIR_PIN = 5;
const byte Y_STEP_PIN = 3;
const byte Y_DIR_PIN = 6;

// Sharp GP2Y0A21YK0F output connected to CoolEn.
// Assumes standard CNC shield V3.0 mapping: CoolEn = A3.
const byte SENSOR_PIN = A3;

// Change HIGH to LOW if the direction is reversed.
const byte X_FORWARD = HIGH;
const byte Y_UP = HIGH;

// 200-step motor with 1/16 microstepping:
// 800 microsteps = 90 degrees of motor rotation.
const float X_DEG_PER_STEP = 90.0 / 800;
const long X_MAX_SWEEP_STEPS = 800;
const int X_SAMPLE_STEPS = 16;

// Tested Y travel: -90 to 360 = 450 microsteps.
// Starting at the lower endpoint is treated as zero.
const int Y_TRAVEL_STEPS = 450;

// How far X sweeps across each row, and how far Y moves between rows.
// Change them over serial with "x <microsteps>" and "y <microsteps>".
long xSweepSteps = 400;
int yRowSteps = 10;

int rowCount() {
  return Y_TRAVEL_STEPS / yRowSteps + 1;
}

const unsigned int STEP_DELAY_US = 10000;
const unsigned int SETTLE_MS = 150;

// Approximate Uno ADC reference voltage.
const float ADC_REFERENCE_V = 5.0;

long xPosition = 0;
long yPosition = 0;

bool stopRequested = false;
bool scanStarted = false;

bool checkStop() {
  while (Serial.available() > 0) {
    char command = Serial.read();

    if (command == 'q' || command == 'Q') {
      stopRequested = true;
    }
  }

  return stopRequested;
}

bool waitSafely(unsigned long durationMs) {
  unsigned long start = millis();

  while (millis() - start < durationMs) {
    if (checkStop()) return false;
    delay(1);
  }

  return true;
}

bool moveAxis(byte stepPin, byte dirPin,
              byte positiveDirection, int direction,
              long count, long &position) {
  digitalWrite(
    dirPin,
    direction > 0 ? positiveDirection : !positiveDirection
  );
  delayMicroseconds(5);

  for (long i = 0; i < count; i++) {
    if (checkStop()) return false;

    digitalWrite(stepPin, HIGH);
    delayMicroseconds(5);
    digitalWrite(stepPin, LOW);

    position += direction;
    delayMicroseconds(STEP_DELAY_US);
  }

  return true;
}

bool printDistance() {
  // Average several readings while the motors are stationary.
  long total = 0;
  const int samples = 5;

  for (int i = 0; i < samples; i++) {
    if (checkStop()) return false;

    total += analogRead(SENSOR_PIN);

    if (!waitSafely(40)) return false;
  }

  float raw = total / float(samples);
  float voltage = raw * ADC_REFERENCE_V / 1023.0;

  Serial.print("ADC: ");
  Serial.print(raw, 0);
  Serial.print(" | Voltage: ");
  Serial.print(voltage, 3);
  Serial.print(" V | Distance: ");

  if (voltage < 0.1 || raw >= 1020) {
    Serial.println("Invalid signal - check wiring/power");
    return true;
  }

  // Approximate curve fit, NOT a calibrated measurement.
  float distanceCm = 27.86 * pow(voltage, -1.15);

  if (distanceCm < 10.0 || distanceCm > 80.0) {
    Serial.println("Outside nominal measuring range");
  } else {
    Serial.print(distanceCm, 1);
    Serial.println(" cm (approx)");
  }

  return true;
}

bool recordPoint(int row) {
  if (!waitSafely(SETTLE_MS)) return false;

  float xAngle = xPosition * X_DEG_PER_STEP;

  Serial.print("Row ");
  Serial.print(row + 1);
  Serial.print("/");
  Serial.print(rowCount());

  Serial.print(" | X: ");
  Serial.print(xAngle, 1);
  Serial.print(" deg | Y: ");
  Serial.print(yPosition);
  Serial.print(" microsteps | ");

  return printDistance();
}

void runScan() {
  Serial.println("Scan started.");

  for (int row = 0; row < rowCount(); row++) {
    int direction = (row % 2 == 0) ? 1 : -1;

    if (!recordPoint(row)) return;

    long remaining = xSweepSteps;

    while (remaining > 0) {
      long amount = X_SAMPLE_STEPS;
      if (amount > remaining) amount = remaining;

      if (!moveAxis(
            X_STEP_PIN, X_DIR_PIN, X_FORWARD,
            direction, amount, xPosition)) {
        return;
      }

      remaining -= amount;

      if (!recordPoint(row)) return;
    }

    if (row < rowCount() - 1) {
      if (!moveAxis(
            Y_STEP_PIN, Y_DIR_PIN, Y_UP,
            1, yRowSteps, yPosition)) {
        return;
      }
    }
  }

  Serial.print("Scan complete: ");
  Serial.print(rowCount());
  Serial.println(" rows.");
}

void printSettings() {
  Serial.print("Settings: X sweep ");
  Serial.print(xSweepSteps);
  Serial.print(" microsteps (");
  Serial.print(xSweepSteps * X_DEG_PER_STEP, 1);
  Serial.print(" deg) | Y ");
  Serial.print(yRowSteps);
  Serial.print(" microsteps per row | ");
  Serial.print(rowCount());
  Serial.println(" rows");
}

void setup() {
  pinMode(ENABLE_PIN, OUTPUT);
  digitalWrite(ENABLE_PIN, HIGH);

  pinMode(X_STEP_PIN, OUTPUT);
  pinMode(X_DIR_PIN, OUTPUT);
  pinMode(Y_STEP_PIN, OUTPUT);
  pinMode(Y_DIR_PIN, OUTPUT);

  digitalWrite(X_STEP_PIN, LOW);
  digitalWrite(Y_STEP_PIN, LOW);
  digitalWrite(X_DIR_PIN, X_FORWARD);
  digitalWrite(Y_DIR_PIN, Y_UP);

  // Read CoolEn as an analog INPUT, not a coolant output.
  pinMode(SENSOR_PIN, INPUT);
  digitalWrite(SENSOR_PIN, LOW); // No internal pull-up
  analogReference(DEFAULT);

  Serial.begin(115200);
  digitalWrite(ENABLE_PIN, LOW);

  delay(250);

  Serial.println("Sharp IR scanner ready.");
  Serial.println("t = test distance without moving");
  Serial.println("s = start scan");
  Serial.println("q = stop scan");
  Serial.println("x <microsteps> = X sweep per row, y <microsteps> = Y per row");
  printSettings();
  Serial.println("Before scanning, set Y at its lower endpoint");
  Serial.println("and X at the beginning of its sweep.");
}

void loop() {
  if (!Serial.available()) return;

  char command = Serial.read();

  if (command == 't' || command == 'T') {
    stopRequested = false;
    printDistance();
  }

  if (command == 'x' || command == 'X') {
    long steps = Serial.parseInt();
    if (steps >= X_SAMPLE_STEPS && steps <= X_MAX_SWEEP_STEPS) {
      xSweepSteps = steps;
    }
    printSettings();
  }

  if (command == 'y' || command == 'Y') {
    long steps = Serial.parseInt();
    if (steps >= 1 && steps <= Y_TRAVEL_STEPS) {
      yRowSteps = steps;
    }
    printSettings();
  }

  if (command == 's' || command == 'S') {
    if (scanStarted) {
      Serial.println(
        "Reposition both axes and reset before scanning again."
      );
      return;
    }

    scanStarted = true;
    stopRequested = false;

    runScan();

    if (stopRequested) {
      Serial.println("Scan stopped. Motors remain holding.");
    }

    Serial.print("Final X microsteps: ");
    Serial.println(xPosition);
    Serial.print("Final Y microsteps: ");
    Serial.println(yPosition);
  }
}
