# AgriRover v1: design

A soil-probe module that bolts onto a small 4WD RC chassis, drives the lanes between tomato rows, stops, and pushes a soil moisture probe into the ground. It is the physical counterpart of the `agrisim` simulator in this repository. The same module has a reserved mount for the Phase 3 under-leaf camera arm.

Status: **design targets, not built or tested.** Numbers marked [A] are assumptions or estimates to confirm on the bench. All soil numbers are placeholders, as in `configs/demo.yaml`.

Everything here is generated from one parametric file, [`model.mjs`](model.mjs). Change a dimension there, then rebuild the drawings and the anatomy figure (see [README.md](README.md)).

| View | File |
|---|---|
| Front, left side and plan (third-angle, 1:5), with parts list | [`drawings/rover-v1-views.svg`](drawings/rover-v1-views.svg) |
| Isometric anatomy, interactive (probe cycle, light theme) | [`anatomy/rover-anatomy-light.html`](anatomy/rover-anatomy-light.html) |
| The same, dark theme | [`anatomy/rover-anatomy.html`](anatomy/rover-anatomy.html) |

## 1. What it has to do

From [context.md](../../context.md), Section 6:

- Drive the inter-row lanes of a planted tomato field without touching a plant, on uneven soil.
- Stop at chosen spots and measure soil moisture in the root zone.
- Know where it is, so readings land on the right cell of the map.
- Later, carry a camera that looks under leaves (Phase 3).

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

**Choice: a 4WD skid-steer chassis with independent suspension.** It matches the simulator's kinematics, so `agrisim` plans, paths and safety checks carry over. It also leaves the centre free for the probe, which matters for the reason in Section 4.3. A crawler stays possible, but the simulator would then need an Ackermann model and headland 3-point turns.

**Chassis requirements** (buy or build to these):

- Overall about 395 W x 448 L mm, including bumpers, so it fits the 0.40 x 0.50 m simulator footprint.
- Wheels 150 mm diameter, about 65 mm wide. Track 330 mm, wheelbase 300 mm.
- Belly at least 100 mm above the ground. Motor pods at least 56 mm.
- A central opening about 66 mm across through the chassis body, for the probe well. Cut one if the kit has none, keeping clear of the battery and the driver.
- Payload at least 3.5 kg for the module.
- 12 V gear-motors with hall encoders. Wheel odometry needs them.
- Top mounting points the module can bolt to. The module uses four M5 standoffs on a 300 x 170 mm pattern.

## 3. Overall dimensions

| | mm |
|---|---|
| Length, bumper to bumper | 448 |
| Width, over the tyres | 395 |
| Height, to the top of the stepper | 448 |
| Wheelbase and track | 300 and 330 |
| Belly clearance and motor-pod clearance | 100 and 56 |
| Deck | 400 x 250, 3 mm aluminium, M5 hole grid at 25 mm pitch |

In the 0.60 m clear lane this leaves about 100 mm each side between the tyres and the nearest canopy edge.

**Height risk:** the probe tower reaches 448 mm at the lane centre. Staked tomatoes are usually pruned of their lowest leaves [A], but leaves that droop into the lane centre could brush the tower top. A belt-driven or ball-screw axis would lower it by about 40 mm (v2).

## 4. Soil probe subsystem (the main feature)

### 4.1 Mechanism

- **Probe.** A 3-rod stainless FDR soil sensor with RS485 Modbus output. It measures volumetric water content (VWC), plus temperature and EC on most models [A]. The rods are 3 mm diameter and 70 mm long, in a line 12 mm apart.
  - Low-cost capacitive "v1.2" boards are not suitable: they are not built to be pushed into soil repeatedly.
- **Linear axis.** A NEMA 17 stepper on the tower's top plate drives a T8 lead screw (8 mm lead). The screw moves a carriage on two 10 mm guide rods with LM10UU bushings. A 16 mm extension tube carries the probe down through a well at the chassis centre.
- **Driver.** A TMC2209 driver. Its StallGuard load sensing detects hard soil or a stone, and the probe then stops instead of lifting the rover.
- **Ground detection.** A downward time-of-flight sensor on the probe head (VL53L1X class) measures the gap to the soil. The probe approaches fast and switches to slow insertion when the tips reach the surface, so the depth is measured from the real surface on uneven ground.
- **Protection and cleaning.** The probe parks inside the well, with its tips 107 mm above the ground and above the 100 mm belly, so it is protected while driving. A rubber wiper ring at the bottom of the well cleans the rods on the way up.
- **Cable.** The probe cable runs as a service loop from the carriage to a gland on the electronics box.

### 4.2 Stroke and timing

| | Value |
|---|---|
| Tips parked | 107 mm above ground |
| Insertion depth | 60 mm (set in software) |
| Stroke | 167 mm |
| Approach speed / insertion speed | 25 mm/s / 6 mm/s [A] |
| One cycle: approach, insert, read 2 s, retract | **23.0 s** |

`configs/demo.yaml` uses `insertion_time_s: 10.0`, a placeholder. This design suggests about 23 s per probe. Update the config once the cycle is timed on real soil.

### 4.3 Insertion force: why the probe is in the middle

Pushing the probe down pushes the rover up, so the push is limited by how much of the rover's weight resists it:

- **Probe at the centre of mass, between the axles:** the whole weight resists, which is 5.9 kg x 9.81 = **58 N**.
- **Probe behind the rear axle (100 mm), the obvious bolt-on spot:** the rear wheels lift at about 0.37 x the weight, roughly **21 N**.
- **Probe beside the chassis, between the wheels on one side:** about 0.55 x the weight, roughly 32 N.

Force needed, using a placeholder soil model:

- Tip resistance: 1.2 MPa [A] (moist irrigated loam) over 21.2 mm² of rod tips, which is 25 N.
- Sleeve friction: 10 kPa [A] over the rods' sides.
- Total at 60 mm depth: **about 42 N**.

That fits under 58 N with the probe at the centre and would not fit at the rear. Dry or compacted soil can reach 2 to 3 MPa [A] and would exceed it. In that case:

1. StallGuard detects the stall.
2. The probe retracts.
3. The reading is logged as failed and the rover tries 10 cm away.

This is the real-world counterpart of the simulator's `failure_prob`. Ballast on the deck raises the limit. Probing in the damp drip zone keeps the force low.

**Calibration:** factory VWC calibrations of low-cost probes are often off by several percent [A]. One study found installed sensors overestimated water content (context.md, Section 9). Calibrate each probe against oven-dry samples of the target soil before trusting the maps.

## 5. Electronics and power

Inside the IP54 enclosure on the deck. The figure shows it with its near and front walls cut away.

| Block | Part (class) | Job |
|---|---|---|
| Computer | Raspberry Pi 5 (8 GB) with active cooler | Mission, mapping (agrisim), logging, Wi-Fi telemetry; ROS 2 later |
| Real-time controller | Raspberry Pi Pico 2 on a carrier board | Motor PWM, encoders, bumpers, stepper, RS485, e-stop monitor; USB to the Pi |
| Stepper driver | TMC2209 | Probe axis, with stall detection |
| Probe interface | RS485 transceiver (MAX3485 class) | Modbus to the soil probe |
| Power | 5 V 5 A buck converter; fuse block (4 blade fuses); terminal strip | Pi 5 supply and protected 12 V rails |
| Drive (in the chassis) | Dual DC motor driver, 10 A per channel | Left and right motor pairs |
| Battery (in the chassis) | Li-ion 3S2P, 18650 cells, with a BMS: 11.1 V, about 6 Ah, 67 Wh [A] | Shown through the open side hatch in the figure |
| Navigation | 2D lidar (DTOF, 360°) on a front mast; IMU (BNO085 class); wheel encoders; GNSS antenna on a rear mast | Row following, stem detection, heading, odometry, field position |
| Camera | Pi Camera Module 3 Wide on the lidar mast | Row images for logs and future row vision |
| Safety | E-stop mushroom that cuts motor power; RC receiver as manual override and kill switch; front and rear bumper switches | Bumper hits count as plant contacts, the simulator's safety metric |

**Positioning.** A standard GNSS receiver gives about 2 m, which is coarser than the 0.5 m map cells. Inside a lane the rover's sideways position is fixed by the lane. Its position along the row comes from wheel odometry corrected by lidar stem counting. An RTK GNSS receiver (u-blox ZED-F9P class) is the upgrade if row-level tracking is not enough.

**Power budget** [A] for the simulator's seed-7 survey (466 m of driving, 60 probes):

| Load | Draw | Time | Energy |
|---|---|---|---|
| Drive, 4 motors while moving | about 48 W | 932 s at 0.5 m/s | 12.4 Wh |
| Electronics (Pi 5, MCU, lidar, camera) | about 9 W | about 2,300 s with 23 s probe cycles | 5.8 Wh |
| Probe axis while moving | about 6 W | 60 x 21 s | 2.1 Wh |
| **Total** | | | **about 20 Wh**: about 3 surveys per charge |

## 6. Mass budget [A]

| Item | kg |
|---|---|
| Chassis kit with motors, wheels and suspension | 2.60 |
| Battery pack with BMS | 0.35 |
| Deck plate (3 mm aluminium) | 0.81 |
| Probe tower (plates, rods, screw, carriage, stepper) | 0.90 |
| Soil probe with extension | 0.25 |
| Enclosure and electronics | 0.55 |
| Lidar, camera, GNSS mast, e-stop, receiver | 0.25 |
| Cables, glands, fasteners | 0.19 |
| **Total** | **5.90** |

The heavy deck is useful here, because weight is what pushes the probe in.

## 7. Phase 3: under-leaf camera module (reserved, not built)

The deck has a T-slot accessory rail on its left edge and a capped AUX port (power plus USB) on the enclosure. The planned module, which is not in the figure:

- **Arm.** A low 2-DOF arm (slide out plus lift) that reaches sideways from the lane into the canopy at 5 to 25 cm height.
- **Leaf lifter.** A soft silicone-tipped fork that lifts a leaf 2 to 4 cm to expose its underside.
- **Imaging.** An upward camera (global-shutter class) with a ring light, imaging the underside at a fixed distance.

What it can and cannot tell, honestly:

- **Pests and diseases on leaf undersides** (leaf mold sporulation; mites, whiteflies, aphids, thrips: context.md, Section 5). Detectable only with models trained on real, expert-labelled field images. PlantVillage-style lab images do not transfer to field images (context.md, Section 5).
- **"Water in the leaf" (plant water status).** An RGB camera cannot measure it. It needs a thermal camera (leaf temperature, which gives a crop water stress index) and/or near-infrared bands. Add a small radiometric thermal sensor (FLIR Lepton class) to the head if this matters. Soil moisture from the probe stays the primary water signal.
- **Overall plant health.** Colour and texture cues, and NDVI if near-infrared is added. These are indicators only, to be confirmed by an agronomist.

**Safety rule change.** The leaf lifter touches plants on purpose. It must be a separate, force-limited contact category, kept apart from the "zero plant contacts" rule for the rover body.

## 8. Open questions and risks

1. **Which chassis to buy.** It must meet Section 2's requirements, with a centre opening (or room to cut one) and 3.5 kg of payload. Confirm dimensions before cutting the deck.
2. **Real soil strength in the target field.** If it is above 2 MPa when dry, plan probing after irrigation or add ballast.
3. **Which probe model, and its rod length.** The stroke and the well depend on it.
4. **Leaf brush at 448 mm height** in real staked rows (Section 3).
5. **Positioning accuracy along the row** without RTK. Test lidar stem counting early.
6. **Waterproofing.** The cable glands, the well seal and the lidar in dust and mud.

## 9. How the figure was checked

The isometric figure was built with the [Anatomy](https://github.com/wheresryan22/anatomy) skill (MIT). Its geometry audit (`node anatomy/build.mjs --audit`) checks the following:

- No cable passes through anything.
- Every part rests on another part.
- Every overlap is drawn in true depth order.

It passes with the probe parked and at six probe positions through the stroke (`--pose=15, 30, 60, 107, 140, 167`). That audit found real design faults, which are fixed in `model.mjs`:

- The probe flange clipped the lead-screw bearing at the start of the stroke, so the lead screw moved back.
- The tower base was narrower than the probe hole.
- The carriage hit the screw bearing at full stroke, so the tower was re-stacked.
- The lidar mast sat inside the electronics box.
- The front bumper cut into the tyres, so it was narrowed to fit between them.

The line-end check reports 0 floating lines in both themes, parked and at full depth.
