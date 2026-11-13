
@echo off
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
rem The Modelfiles live in the repository root, not in models\ (models\ holds the trained PPO policy).
ollama create smc-brain -f Modelfile-final
ollama create smc-edge-doctor -f Modelfile-edge-doctor
ollama create smc-edge-specialist -f Modelfile-edge-specialist
echo.
echo ====================================================
echo   SETUP COMPLETE!
echo   To start the Frontend, run: uv run streamlit run app.py
echo ====================================================
pause
