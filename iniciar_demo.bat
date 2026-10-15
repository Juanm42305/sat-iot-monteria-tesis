@echo off
cd /d "%~dp0"
start "SAT - Servidor y dashboard" cmd /k py sat_servidor.py
timeout /t 2 /nobreak >nul
start "SAT - Sensor simulado" cmd /k py sensor_simulado.py --repetir
start http://localhost:8000
