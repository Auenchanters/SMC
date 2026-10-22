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
