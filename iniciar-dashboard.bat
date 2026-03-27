@echo off
setlocal

cd /d "%~dp0"
set "DASHBOARD_HOST=localhost"
for /f %%I in ('powershell -NoProfile -Command "$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue ^| Where-Object { $_.IPAddress -notlike ''127.*'' -and $_.IPAddress -notlike ''169.254.*'' } ^| Select-Object -First 1 -ExpandProperty IPAddress; if ($ip) { $ip } else { ''localhost'' }"') do set "DASHBOARD_HOST=%%I"

set "PORT_PID="
for /f %%P in ('powershell -NoProfile -Command "$conn = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($conn) { Write-Output $conn }"') do set "PORT_PID=%%P"

if defined PORT_PID (
  echo A porta 3000 ja esta em uso pelo PID %PORT_PID%.
  echo Se este dashboard ja estiver aberto, acesse http://%DASHBOARD_HOST%:3000/dashboard
  echo Para reiniciar, encerre o processo e execute este arquivo novamente.
  pause
  exit /b 0
)

echo Iniciando dashboard em http://%DASHBOARD_HOST%:3000/dashboard ...
call npm.cmd run dev
pause
