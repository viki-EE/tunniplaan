@echo off
cd /d "%~dp0"
rem free port 3000 only if an old node server is holding it
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (tasklist /FI "PID eq %%a" ^| findstr /i node.exe >NUL && taskkill /F /PID %%a >NUL 2>&1)
start "" /b cmd /c "ping -n 4 127.0.0.1 >NUL & start firefox http://localhost:3000 || start http://localhost:3000"
node server.js
pause
