# Running a scan

**Never plug or unplug a motor while the 12V supply is on**, because it can destroy the A4988 drivers.

## 1. Flash the sketch

Close the Arduino IDE's Serial Monitor first, because only one program can use the port.

The easiest way is the page itself: open <https://kfidak13.github.io/RLK/> in Chrome or Edge, press **Update Arduino**, and pick the Uno. It uploads the current `firmware/scanner` sketch, checks it, and connects.

Or, from the repo root:

```bash
arduino-cli board list
```

```bash
arduino-cli compile --upload -p <port> --fqbn arduino:avr:uno firmware/scanner
```

## 2. Start the page

```bash
npm --prefix web run dev
```

Open <http://localhost:3000> in Chrome or Edge.

## 3. Position the scanner

With the 12V off, move Y (tilt) to its lower endpoint and X (pan) to the start of its sweep by hand. The sketch treats wherever it starts as zero.

## 4. Scan

1. Turn on the 12V and press **Connect**. Connecting restarts the Arduino, which locks the motors.
2. Press **Test reading** with something 20-60 cm in front of the sensor, to check the distance looks right.
3. Set **X sweep per row** (how far it pans across each row, up to 90°) and **Y per row** (how far it tilts between rows, in microsteps; smaller means more rows). The page shows how many rows and points that makes and roughly how long it takes. The defaults, 45° and 10, give 46 rows in about 10 minutes.
4. Press **Start**, which sends those settings to the Arduino and begins. Press **Stop** to end early.
5. Press **Save CSV** when it's done.

## 5. Set the tilt angle

Measure how many degrees the sensor tilts across the full Y travel, for example with a phone level at the bottom and top. Enter it in **Tilt across full Y travel**. The scan reshapes straight away, so you can do this after scanning.

## 6. Scan again

The sketch only scans once per restart. Move both axes back to their start positions by hand, with the 12V off, then press **New scan**.

## When you're finished

Turn off the 12V. The sketch keeps the motors locked as long as it's running, so they stay powered until you do.
