@echo off
cd /d "%~dp0"
rem Same as start.bat, but your phone on the same Wi-Fi can open it too.
rem Windows may ask to let Node.js through the firewall: allow PRIVATE networks.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (tasklist /FI "PID eq %%a" ^| findstr /i node.exe >NUL && taskkill /F /PID %%a >NUL 2>&1)
set HOST=0.0.0.0
start "" /b cmd /c "ping -n 4 127.0.0.1 >NUL & start firefox http://localhost:3000 || start http://localhost:3000"
node server.js
pause
