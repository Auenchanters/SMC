# AgriRover v1: design

A sensor module that bolts onto a small 4WD RC chassis and drives the lanes between tomato rows. It does two jobs:

1. **Soil moisture.** It stops and pushes a soil moisture probe into the ground, then cleans the probe before the next spot so one sample doesn't contaminate the next.
2. **Under-leaf imaging.** It reaches a low camera under the leaves of the rows on either side.

It is the physical counterpart of the `agrisim` simulator in this repository.

Status: **design targets, not built or tested.** Numbers marked [A] are assumptions or estimates to confirm on the bench. All soil numbers are placeholders, as in `configs/demo.yaml`.

Everything here comes from one parametric file, [`model.mjs`](model.mjs). Change a dimension there, then rebuild the drawings and figures (see [README.md](README.md)).

| View | File |
|---|---|
| Front, left side and plan (third-angle, 1:5), with parts list; phantom probe at depth and arms extended | [`drawings/rover-v1-views.svg`](drawings/rover-v1-views.svg) |
| Fig 1: the whole rover, interactive: probe cycle with cleaning; `A` slides the left camera arm | [`anatomy/rover-anatomy-light.html`](anatomy/rover-anatomy-light.html) ([dark](anatomy/rover-anatomy.html)) |
| Fig 2: the self-cleaning probe cartridge in section, interactive | [`anatomy/probe-cleaning-light.html`](anatomy/probe-cleaning-light.html) ([dark](anatomy/probe-cleaning.html)) |

## 1. What it has to do

From [context.md](../../context.md), Section 6:

- Drive the inter-row lanes of a planted tomato field without touching a plant, on uneven soil.
- Stop at chosen spots and measure soil moisture in the root zone, with each reading independent of the last.
- Know where it is, so readings land on the right cell of the map.
- Carry cameras that look at the undersides of leaves (Phase 3 software, hardware designed now).

The simulator's demo geometry is the design envelope:

- Row spacing is 1.2 m and canopy radius is up to 0.30 m, so the clear lane is 0.60 m wide.
- The simulator's rover is 0.40 m wide and 0.50 m long, with a 0.05 m safety margin.
- Headlands are 2 m.

## 2. Chassis: 4WD skid-steer, not an Ackermann crawler

The plan is to build the module and mount it on an RC car. Two RC chassis families fit uneven soil:

| | 4WD skid-steer (corner motors, independent suspension) | 1/10 rock crawler (Ackermann steering) |
|---|---|---|
| Turns | In place, about its centre | Needs a turning circle, roughly 0.6 to 1 m [A] |
| Matches agrisim's rover model | Yes: differential drive, turn in place, reverse in a lane | No: the planner and controller would need 3-point turns |
| Centre of the chassis | Free (four corner motors), so a probe can go straight down through the middle | Central driveshaft and transfer case in the way |
| Soft and uneven soil | Good with suspension; skids and scuffs soil when turning | Excellent articulation |
| Control | Two channels (left, right) | Steering servo plus ESC |

**Choice: a 4WD skid-steer chassis with independent suspension.** It matches the simulator's kinematics, so `agrisim` plans, paths and safety checks carry over. It also leaves the centre free for the probe (Section 4.3).

**Chassis requirements** (buy or build to these):

- Overall about 395 W x 500 L mm, including the front scan beam and rear bumper, so it fits the 0.40 x 0.50 m simulator footprint.
  - The footprint is 26 mm off-centre: 276 mm ahead of the axle midpoint, 224 mm behind it. Add that to the simulator's footprint if its margins get tight.
- Wheels 150 mm diameter, about 65 mm wide. Track 330 mm, wheelbase 300 mm.
- Belly at least 100 mm above the ground. Motor pods at least 56 mm.
- A central opening about 66 mm across through the chassis body, for the probe well. Cut one if the kit has none, keeping clear of the battery and the driver.
- Payload at least 4.5 kg for the module.
- 12 V gear-motors with hall encoders. Wheel odometry needs them.
- Top mounting points the module can bolt to. The module uses four M5 standoffs on a 300 x 170 mm pattern.
- Front-face mounting points for the two scan-beam struts.

## 3. Overall dimensions

| | mm |
|---|---|
| Length, scan beam to rear bumper | 500 |
| Width, over the tyres (arms in) | 395 |
| Height, to the top of the stepper | 448 |
| Wheelbase and track | 300 and 330 |
| Belly / scan beam / motor-pod clearance | 100 / 72 / 56 |
| Camera head reach, from the rover's centre line | 351 (each side) |
| Deck | 400 x 250, 3 mm aluminium, M5 hole grid at 25 mm pitch |

With the arms in, the tyres sit about 100 mm from the nearest canopy edge in the 0.60 m clear lane.

**Height risk:** the probe tower reaches 448 mm at the lane centre. Staked tomatoes are usually pruned of their lowest leaves [A], but leaves that droop into the lane centre could brush the tower top. A belt-driven or ball-screw axis would lower it by about 40 mm (v2).

## 4. Soil probe subsystem (the main feature)

### 4.1 Mechanism

- **Probe.** A 3-rod stainless FDR soil sensor with RS485 Modbus output. It measures volumetric water content (VWC), plus temperature and EC on most models [A]. The rods are 3 mm diameter and 70 mm long, in a line 12 mm apart.
  - Low-cost capacitive "v1.2" boards are not suitable: they are not built to be pushed into soil repeatedly.
- **Linear axis.** A NEMA 17 stepper on the tower's top plate drives a T8 lead screw (8 mm lead). The screw moves a carriage on two 10 mm guide rods with LM10UU bushings. A 16 mm extension tube carries the probe down through a well at the chassis centre.
- **Driver.** A TMC2209 driver. Its StallGuard load sensing detects hard soil or a stone, and the probe then stops instead of lifting the rover.
- **Ground detection.** A small downward time-of-flight sensor (VL53L1X class) on the probe head measures the gap to the soil. It is sized to pass the 30 mm well bore. The probe approaches fast and switches to slow insertion when the tips reach the surface, so the depth is measured from the real surface on uneven ground.
- **Parking.** The probe parks inside the cleaning cartridge, with its tips 107 mm above the ground, just above the brush seal. The bristles close the well mouth against mud and dust while driving.
- **Cable.** The probe cable runs as a service loop from the carriage to a gland on the electronics box.

### 4.2 Stroke and timing

| | Value |
|---|---|
| Tips parked | 107 mm above ground |
| Insertion depth | 60 mm (set in software) |
| Stroke | 167 mm |
| Approach speed / insertion speed | 25 mm/s / 6 mm/s [A] |
| Approach, insert, read 2 s, retract through the brushes | 23.0 s |
| Air blast 3 s, then air check 1 s | 4.0 s |
| **Full cycle** | **27.0 s** |

`configs/demo.yaml` uses `insertion_time_s: 10.0`, a placeholder. This design suggests about 27 s per probe. Update the config once the cycle is timed on real soil.

### 4.3 Insertion force: why the probe is in the middle

Pushing the probe down pushes the rover up, so the push is limited by how much of the rover's weight resists it. The probe sits at the wheelbase centre. The front scan beam puts the centre of mass about 30 mm ahead of the probe [A]. The rear wheels then unload first, at W(1 − 2 × 30 / 300) = 6.9 kg × 9.81 × 0.8 = **54 N**.

For comparison:
- **Behind the rear axle (100 mm), the obvious bolt-on spot:** the rear wheels lift at roughly **25 N**.
- **Beside the chassis, between the wheels on one side:** roughly 37 N.

Placing the battery toward the rear brings the centre of mass back over the probe and raises the limit toward the full 68 N weight.

Force needed, using a placeholder soil model:

- Tip resistance: 1.2 MPa [A] (moist irrigated loam) over 21.2 mm² of rod tips, which is 25 N.
- Sleeve friction: 10 kPa [A] over the rods' sides.
- Total at 60 mm depth: **about 42 N**.

That fits under 54 N with the probe at the centre and would not fit at the rear. Dry or compacted soil can reach 2 to 3 MPa [A] and would exceed it. In that case:

1. StallGuard detects the stall.
2. The probe retracts.
3. The reading is logged as failed and the rover tries 10 cm away.

This is the real-world counterpart of the simulator's `failure_prob`. Ballast on the deck raises the limit. Probing in the damp drip zone keeps the force low.

**Calibration:** factory VWC calibrations of low-cost probes are often off by several percent [A]. One study found installed sensors overestimated water content (context.md, Section 9). Calibrate each probe against oven-dry samples of the target soil before trusting the maps.

### 4.4 Keeping the probe clean between samples

**Why it matters.** A rod-type dielectric probe is most sensitive right next to its rods. A film of wet soil carried from one spot to the next sits exactly there, and biases the next reading toward the previous spot's moisture. A dry crust has the opposite effect. Packed soil also changes the insertion force and rod contact. Since the rover samples the whole field in sequence, a dirty probe would quietly blur the map. So every cycle ends with a cleaning step whose result is checked.

**The self-cleaning cartridge** (Fig 2) fills the bottom 40 mm of the probe well:

| Stage | What happens | Why this way |
|---|---|---|
| **Brush seal** at the well mouth (z 94 to 106 mm) | Two opposed nylon strip brushes meet on the line of the three rods. The rods are scraped on every pass, down and up. The probe head (36 mm) pushes the bristles apart and they close behind it. Scraped soil falls out of the open bottom of the well, back onto the spot it came from. | Passive, no extra motor, cleans while retracting so it adds no time. When parked, it also seals the well mouth against splash. |
| **Air-knife ring** above the brushes (z 118 mm) | Six 1 mm nozzles, angled down at the parked rods, fed by a 12 V diaphragm pump in the chassis through a barb on the manifold. A 3 s blast. | Air dries and lifts fines without leaving a water film. A water rinse would leave a film and bias the very reading it was meant to protect. |
| **Air check** (1 s) | With the rods parked in air, the probe takes a reading. It must be within 0.02 m³/m³ [A] of its stored clean-air baseline. | Cleaning is verified, not assumed. It also checks the sensor itself: a cracked rod or a drifting probe shows up here. |
| **If the check fails** | The probe strokes 30 mm down and back through the brushes; its tips stop 77 mm above the ground. Then it blasts again. After 2 failed retries [A], the next reading is flagged suspect and the operator is alerted. | Re-cleans without touching soil. A flagged reading maps to the simulator's invalid probe. |
| **Maintenance** | The cartridge drops out of the belly on a bayonet for washing and brush replacement. | Brushes are a wear part. |

**Limits, honestly:**
- Wet clay can smear rather than scrape. If the air check fails often in heavy soil, the next step is a short dry-wipe pad stroke, or electropolished rods (less adhesion). Don't use a coating on the rods: it changes the probe's calibration.
- The 0.02 m³/m³ threshold and brush life must be measured on real soil.

## 5. Under-leaf camera arms (front scan beam)

Under-leaf imaging needs the camera **low and beside the rover**, under the leaves of the row, looking up. A camera on the deck or a mast would look down onto the canopy instead. So the front bumper is replaced by a **scan beam**: an aluminium channel 42 x 40 mm spanning the rover's width at 72 to 112 mm height, ahead of the front wheels. It carries two independent telescopic arms, one per row:

- **Arms.** Each arm has two stages in its half of the beam: a middle stage (128 mm travel) and an inner stage (+70 mm). Each stage overlaps the one holding it by at least 50 mm, for stiffness. A small stepper on the beam drives each arm by belt [A].
- **Reach.** The camera head reaches **351 mm** from the rover's centre line, about 5 cm under the canopy edge. A wide upward camera (about 100° field of view) sees a leaf 20 cm above out to the stems, 0.6 m from the centre line. Reach is capped so the head stays 0.15 m from the stems (the simulator's `stem_keepout`).
- **Camera head** (34 x 64 x 22 mm, about 81 mm above the ground):
  - an upward camera behind a window, with an LED ring for even light (a polariser cuts glare)
  - a **sloped nose** that slides under low leaves and lifts them slightly instead of pushing them
  - a sideways distance sensor in the nose that stops the arm before it reaches a stem or stake
- **Window wiper.** A brush strip at each beam mouth wipes the camera window every time the head retracts. This is the same self-cleaning idea as the probe: dust and dew on the window would degrade every image after it.
- **Contact strip.** A pressure strip on the beam's front face replaces the front bumper switches.

**How it is used:**
- **Stop and scan:** extend, image, retract.
- **Crawl scan:** creep at about 0.1 m/s with the head under the canopy, taking position-tagged frames for a continuous strip of leaf undersides.

The lidar and the arm's distance sensor both watch for stems. The arm's stepper current limit stops it if it meets something.

**What the cameras can and cannot tell:**

- **Pests and diseases on leaf undersides** (leaf mold sporulation; mites, whiteflies, aphids, thrips: context.md, Section 5). Detectable only with models trained on real, expert-labelled field images. PlantVillage-style lab images do not transfer to field images.
- **"Water in the leaf" (plant water status).** An RGB camera cannot measure it. It needs a thermal camera (leaf temperature, which gives a crop water stress index) and/or near-infrared bands. A small radiometric thermal sensor (FLIR Lepton class) fits beside the camera in the head if this matters. Soil moisture from the probe stays the primary water signal.
- **Overall plant health.** Colour and texture cues, and NDVI if near-infrared is added. These are indicators only, to be confirmed by an agronomist.

**Safety rule.** The nose touches leaves on purpose, gently. Leaf contact by the head is a separate, force-limited category, kept apart from the "zero plant contacts" rule for the rover body. Contact with a stem or stake is still a fault.

## 6. Electronics and power

Inside the IP54 enclosure on the deck. The figure shows it with its near and front walls cut away.

| Block | Part (class) | Job |
|---|---|---|
| Computer | Raspberry Pi 5 (8 GB) with active cooler | Mission, mapping (agrisim), logging, camera capture, Wi-Fi telemetry; ROS 2 later |
| Real-time controller | Raspberry Pi Pico 2 on a carrier board | Motor PWM, encoders, contact strip and bumpers, probe and arm steppers, air pump (MOSFET), RS485, e-stop monitor; USB to the Pi |
| Stepper drivers | TMC2209 (probe), 2 x TMC2209 (arms) | Probe and arm axes, with stall detection |
| Probe interface | RS485 transceiver (MAX3485 class) | Modbus to the soil probe |
| Cleaning | 12 V diaphragm pump in the chassis, about 0.1 MPa [A] | Air-knife ring in the cartridge |
| Cameras | 2 under-leaf cameras (USB, global shutter or Pi Camera Module 3 Wide via a CSI extender) [A]; Pi Camera Module 3 Wide on the lidar mast | Leaf undersides; row images for logs and row vision |
| Power | 5 V 5 A buck converter; fuse block (4 blade fuses); terminal strip | Pi 5 supply and protected 12 V rails |
| Drive (in the chassis) | Dual DC motor driver, 10 A per channel | Left and right motor pairs |
| Battery (in the chassis) | Li-ion 3S2P, 18650 cells, with a BMS: 11.1 V, about 6 Ah, 67 Wh [A] | Shown through the open side hatch in the figure. Mount it toward the rear (Section 4.3). |
| Navigation | 2D lidar (DTOF, 360°) on a front mast; IMU (BNO085 class); wheel encoders; GNSS antenna on a rear mast | Row following, stem detection, heading, odometry, field position |
| Safety | E-stop mushroom that cuts motor power; RC receiver as manual override and kill switch; front contact strip and rear bumper switches | Body contacts count as plant contacts, the simulator's safety metric |

**Positioning.** A standard GNSS receiver gives about 2 m, which is coarser than the 0.5 m map cells. Inside a lane the rover's sideways position is fixed by the lane. Its position along the row comes from wheel odometry corrected by lidar stem counting. An RTK GNSS receiver (u-blox ZED-F9P class) is the upgrade if row-level tracking is not enough.

**Power budget** [A] for the simulator's seed-7 survey (466 m of driving, 60 probes, no leaf scanning):

| Load | Draw | Time | Energy |
|---|---|---|---|
| Drive, 4 motors while moving | about 48 W | 932 s at 0.5 m/s | 12.4 Wh |
| Electronics (Pi 5, MCU, lidar, camera) | about 9 W | about 2,550 s with 27 s probe cycles | 6.4 Wh |
| Probe axis while moving | about 6 W | 60 x 21 s | 2.1 Wh |
| Air pump | about 6 W | 60 x 3 s | 0.3 Wh |
| **Total** | | | **about 21 Wh**: about 3 surveys per charge |

A crawl scan adds the two arm steppers and cameras (about 6 W [A]) for its duration.

## 7. Mass budget [A]

| Item | kg |
|---|---|
| Chassis kit with motors, wheels and suspension | 2.60 |
| Battery pack with BMS | 0.35 |
| Deck plate (3 mm aluminium) | 0.81 |
| Probe tower (plates, rods, screw, carriage, stepper) | 0.90 |
| Soil probe with extension | 0.25 |
| Cleaning cartridge, pump and air line | 0.25 |
| Scan beam, two arms, two camera heads, two steppers | 0.75 |
| Enclosure and electronics | 0.55 |
| Lidar, camera, GNSS mast, e-stop, receiver | 0.25 |
| Cables, glands, fasteners | 0.19 |
| **Total** | **6.90** |

The heavy deck is useful here, because weight is what pushes the probe in.

## 8. Open questions and risks

1. **Which chassis to buy.** It must meet Section 2's requirements: a centre opening (or room to cut one), front mounting points for the beam, and 4.5 kg of payload. Confirm dimensions before cutting the deck.
2. **Real soil strength in the target field.** If it is above 2 MPa when dry, plan probing after irrigation or add ballast.
3. **Which probe model, and its rod length.** The stroke, the well and the brush positions depend on it.
4. **How well brushes and air clean in the real soil.** Measure the air-check failure rate. In heavy wet clay, add the dry-wipe stroke (Section 4.4).
5. **Real lower-canopy height and leaf density.** This sets whether the head's fixed 81 mm height and 351 mm reach are right. A lift stage on the head is the upgrade.
6. **Window fogging and dew** on the camera heads in the morning.
7. **Leaf brush at 448 mm height** in real staked rows (Section 3).
8. **Positioning accuracy along the row** without RTK. Test lidar stem counting early.
9. **Waterproofing.** The cable glands, the well seal, the beam mouths and the lidar in dust and mud.

## 9. How the figures were checked

Both figures were built with the [Anatomy](https://github.com/wheresryan22/anatomy) skill (MIT). Its geometry audit (`--audit`) checks the following:

- No cable or hose passes through anything.
- Every part rests on another part.
- Every overlap is drawn in true depth order.

Fig 1 passes parked, and in two sets of pose audits:
- the probe at six positions (`--pose=15,30,60,107,140,167`)
- the arm at four extensions (`--arm=0,0.25,0.5,0.75`)

Both sets run with `--rest-order`, which checks the paint order the page actually uses rather than re-solving it per pose. Fig 2 passes its own audit. The line-end check reports 0 floating lines in both themes, in every pose checked: Fig 1 parked and at full depth with the arm out, Fig 2 parked and during the air blast.

The audits found real design faults, now fixed in `model.mjs`:

- The probe flange clipped the lead-screw bearing at the start of the stroke, so the lead screw moved back.
- The tower base was narrower than the probe hole.
- The carriage hit the screw bearing at full stroke, so the tower was re-stacked.
- The lidar mast sat inside the electronics box.
- The front bumper cut into the tyres. It is now replaced by the scan beam, ahead of the wheels.
- The time-of-flight block was too big for the 30 mm well bore, so it was resized.

One crowding report is excused after inspection: the scan cable leaving the gland on the beam it is mounted to.
