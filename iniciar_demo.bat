@echo off
cd /d "%~dp0"
start "SAT - Servidor" cmd /k py sat_servidor.py
start "SAT - Dashboard" /d frontend cmd /k npm run dev
timeout /t 3 /nobreak >nul
start "SAT - Sensor simulado" cmd /k py sensor_simulado.py --repetir
start http://localhost:5173
