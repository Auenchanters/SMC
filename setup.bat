
@echo off
echo ====================================================
echo   SMC Rover Project - Auto Setup
echo ====================================================
echo.
echo [1/3] Installing Dependencies via UV...
uv sync
echo.
echo [2/3] Pulling Base Model...
ollama pull qwen2.5:3b
echo.
echo [3/3] Creating Specialized AI Doctors...
ollama create smc-brain -f models/Modelfile-final
ollama create smc-edge-doctor -f models/Modelfile-edge-doctor
ollama create smc-edge-specialist -f models/Modelfile-smc-final
echo.
echo ====================================================
echo   SETUP COMPLETE!
echo   To start the Frontend, run: uv run streamlit run app.py
echo ====================================================
pause
