@echo off
setlocal
title Instalar dependencias do ZapMarket

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado neste PC.
  echo Instale o Node.js e tente novamente.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm nao foi encontrado neste PC.
  echo Instale o Node.js com o npm e tente novamente.
  pause
  exit /b 1
)

echo Pasta do projeto: %cd%
echo.
echo Instalando dependencias...
call npm.cmd install

if errorlevel 1 (
  echo.
  echo Falha ao instalar as dependencias.
  pause
  exit /b 1
)

echo.
echo Dependencias instaladas com sucesso.
pause
