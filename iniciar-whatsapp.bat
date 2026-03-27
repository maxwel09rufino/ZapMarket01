@echo off
setlocal
title Iniciando WhatsApp Service

cd /d "%~dp0"
set "WHATSAPP_HOST=localhost"
for /f %%I in ('powershell -NoProfile -Command "$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue ^| Where-Object { $_.IPAddress -notlike ''127.*'' -and $_.IPAddress -notlike ''169.254.*'' } ^| Select-Object -First 1 -ExpandProperty IPAddress; if ($ip) { $ip } else { ''localhost'' }"') do set "WHATSAPP_HOST=%%I"

set "PORT_PID="
for /f %%P in ('powershell -NoProfile -Command "$conn = Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($conn) { Write-Output $conn }"') do set "PORT_PID=%%P"

if defined PORT_PID (
  echo A porta 3001 ja esta em uso pelo PID %PORT_PID%.
  echo Se o servico do WhatsApp ja estiver rodando, consulte http://%WHATSAPP_HOST%:3001/status
  echo Para reiniciar, encerre o processo e execute este arquivo novamente.
  pause
  exit /b 0
)

echo Pasta acessada. Iniciando o servico do WhatsApp em http://%WHATSAPP_HOST%:3001/status ...
call npm.cmd run dev:whatsapp-service
pause
