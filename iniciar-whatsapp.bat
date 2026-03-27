@echo off
setlocal
title Iniciando WhatsApp Service

cd /d "%~dp0"

set "PORT_PID="
for /f %%P in ('powershell -NoProfile -Command "$conn = Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($conn) { Write-Output $conn }"') do set "PORT_PID=%%P"

if defined PORT_PID (
  echo A porta 3001 ja esta em uso pelo PID %PORT_PID%.
  echo Se o servico do WhatsApp ja estiver rodando, consulte http://127.0.0.1:3001/status
  echo Para reiniciar, encerre o processo e execute este arquivo novamente.
  pause
  exit /b 0
)

echo Pasta acessada. Iniciando o servico do WhatsApp...
call npm.cmd run dev:whatsapp-service
pause
