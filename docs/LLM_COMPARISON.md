# 🤖 LLM Evaluation: AI Agronomist Performance

This document compares the performance of different Large Language Models (LLMs) in transforming raw robotic telemetry from `agrisim` into actionable agricultural debriefs.

## 📊 Final Model Comparison

| Metric | Qwen 2.5 (1.5B Local) | Llama 3.1 NatFarmer (8B Local) | Gemma 4 (31B Cloud) |
| :--- | :--- | :--- | :--- |
| **Data Extraction** | **Poor**. Missed coordinates; hallucinated "zero probes". | **Excellent**. Accurately extracted coordinates and VWC values. | **Excellent**. High precision in data extraction. |
| **Agronomic Logic** | **Basic**. Repeated numbers without interpretation. | **Good**. Understood moisture deficits and suggested targeted irrigation. | **Professional**. Linked telemetry to emitter clogs and systemic risk. |
| **Reasoning Depth** | **Low**. Failed to identify the "strategic failure" of random surveys. | **Moderate**. Noticed dry zones, but struggled with the "strategic" failure nuance. | **High**. Correctly identified a "Partial Success" due to low recall. |
| **Report Tone** | Generic / Descriptive. | Practical / Farmer-oriented. | Executive / Consultant-level. |
| **Speed / Cost** | Instant / Free. | Moderate / Free. | Slow / API Cost. |

---

## 🔍 Deep Dive into the Llama 3.1 (8B) Results

### The Good
- **Coordinate Precision**: Unlike Qwen, Llama actually looked at the hotspots data. In the failure case, it listed 10 specific coordinates for the irrigation team to check.
- **Practical Advice**: The tone is shifted toward "Farmer assistance." It speaks about "water stress" and "judicious use of resources," which fits the Natural Farmer fine-tuning.
- **Stability**: It didn't hallucinate the mission status as wildly as the 1.5B model.

### The Bad
- **The "Strategic" Blindspot**: In the failure case (random survey), Llama called the mission a "Success" simply because the rover didn't hit any plants. It failed to realize that a random survey is an agronomical failure because it misses too many dry zones.

---

## Update, 13 November 2026: Qwen 3.5 (4B) replaces Qwen 2.5 (3B)

One mission (demo field, `moisture_seeker`, 30 probes, seed 42; verdict PARTIAL), written up by both models on the same laptop (RTX 3050, 6 GB) with the same prompt. One run each, so this is an observation, not a benchmark.

| | Qwen 2.5 (3B) | Qwen 3.5 (4B) |
| :--- | :--- | :--- |
| Time | 29 s | 25 s |
| Reason for the verdict | Correct | Correct |
| Is the field healthy? | Says no. Wrong: 4.3% of it is dry | Says the field is not in general drought. Correct |
| Dry spots | Lists every probe back | Picks the lowest reading for the emitter check, but names a different spot as "most urgent" |
| Self-consistency | Says to treat the map "with a high degree of caution", then that it is "reliable enough" | Consistent: trust the driest spots, not field-wide decisions |
| Contradictions caught by the validator | 0 | 0 |

Two things mattered more than the choice of model:

- **Thinking must be off.** Qwen 3.5 is a thinking model. Left on, it ran for 7 minutes and returned no text at all. `ai_agronomist/write_debrief.py` now switches it off (the verdict and the numbers are computed in code) and treats an empty answer as an error.
- **The prompt must give the reason.** Told only "PARTIAL" and "plant contacts: 0", Qwen 3.5 blamed the rover for failing to make contact with plants, and Qwen 2.5 called a map over the error limit "quite accurate". With the reasons in the prompt, both got the status right.

Still true of both: the `smc-*` Modelfiles ask for nitrogen, phosphorus, potassium, pH and conductivity, which the rover does not measure.
