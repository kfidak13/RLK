# Hardware checklist

Work through this in order the first time you use the scanner. **Never plug or unplug a motor while the 12V supply is on**, because it can destroy the A4988 drivers.

Everything up to this point has been tested without hardware: the firmware has only been compiled, and the page has only talked to a simulated Uno. These steps are the first real test, so go slowly and keep a hand near the 12V supply.

## 1. Flash the firmware

Close any serial monitor, and disconnect in the page if it's open. Find the Uno's port, then upload:

```bash
arduino-cli board list
```

```bash
arduino-cli upload -p <port> --fqbn arduino:avr:uno firmware/scanner
```

## 2. Open the page

Run this from the repo root, then open <http://localhost:3000> in Chrome or Edge:

```bash
npm --prefix web run dev
```

Before connecting, make a mark on the linkage where tilt sits now. This is your tilt reference mark. Scans are safest if you start from around the middle of the travel, so move it there by hand first, with the 12V supply off.

## 3. Connect and enable

1. Turn on the 12V supply.
2. Press Connect and choose the Uno. The Uno resets, which takes a moment.
3. Tick the checklist and press Enable motors. The motors should now resist being turned by hand.

If nothing holds, check the 12V supply. The software can't detect whether motor power is on.

## 4. Find out which motor is which

Press **Pan +1** and watch which axis moves. If tilt moves, change Tilt motor to X driver and try again. Do this before anything else, because the tilt limit only protects the driver chosen as tilt.

## 5. Check the tilt protection

Press **Tilt +5** four times, stopping sooner if the linkage nears the end of its travel. A fifth press should be refused with a message. Press **Tilt -5** to come back to zero.

## 6. Measure the tilt limits

Jog tilt in small steps towards each end of its travel, stopping **before** the linkage binds, and note the position shown on the page. If you hit a limit first, raise it in small amounts. Enter the lowest and highest positions as the tilt limits. Leave a margin.

If the motor ever skips or the linkage jams, the position shown is no longer true. Release the motors, move tilt back to the mark by hand, enable the motors and press Set zero.

## 7. Measure degrees per step

**Tilt:** jog a known number of steps, for example 10, measure how far the sensor's angle changed with a phone level, and divide. Enter it as Tilt degrees per step. The Start button stays disabled until this is set.

**Pan:** the default of 1.8 is right if the motor drives the base directly. Otherwise measure it the same way.

## 8. Scan a flat wall

Face a flat wall about 40 cm away and scan with the default ranges, which takes about 6 minutes. In the 3D view, the white dot is the scanner.

- **Distance:** the wall should appear at the distance you measured. If it's off, adjust Curve A and Sensor offset.
- **Flatness:** the wall should look flat from the side. A curve across it usually means a degrees-per-step value is wrong, and a shift in the bottom row means slack in the screw.

The calibration boxes update the existing scan straight away, so you can adjust without rescanning.

## 9. Check for mirroring

Put an object to the scanner's right and scan. View the result from behind the scanner, looking the way the sensor faces. If the object appears on the wrong side, make Pan degrees per step negative. Check up and down the same way for tilt.

## 10. Scan an object

Place it 20-60 cm away, and never closer than 10 cm. Up close, this sensor reads as if the object were far away, and the software can't detect that. Aim with the jog buttons, then start the scan. Save it when it's done, because scans aren't kept when you close the page.

"0 of N samples in range" means the sensor saw nothing between 10 and 80 cm. Check the sensor's wiring and how far away the object is.
