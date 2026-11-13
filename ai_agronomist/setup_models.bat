@echo off
rem Run from anywhere: every path below is relative to the repository root.
cd /d "%~dp0.."
echo ====================================================
echo   SMC Rover Project - Auto Setup
echo ====================================================
echo.
echo [1/3] Installing Dependencies via UV...
uv sync
echo.
echo [2/3] Pulling Base Model...
ollama pull qwen3.5:4b
echo.
echo [3/3] Creating Specialized AI Doctors...
ollama create smc-brain -f ai_agronomist\modelfiles\smc-brain.Modelfile
ollama create smc-edge-doctor -f ai_agronomist\modelfiles\smc-edge-doctor.Modelfile
ollama create smc-edge-specialist -f ai_agronomist\modelfiles\smc-edge-specialist.Modelfile
echo.
echo ====================================================
echo   SETUP COMPLETE!
echo   To start the Frontend, run: uv run streamlit run ai_agronomist/control_centre_app.py
echo ====================================================
pause
