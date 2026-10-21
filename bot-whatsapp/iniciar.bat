@echo off
REM Doble clic para encender el asistente de WhatsApp. Cerrá la ventana para apagarlo.
cd /d "%~dp0"
title Venutto - Asistente de WhatsApp
where node >nul 2>nul || (echo Falta instalar Node.js: https://nodejs.org ^(boton LTS^) & pause & exit /b)
if not exist .env (echo Falta el archivo .env: mira LEEME.md & pause & exit /b)
if not exist node_modules (echo Instalando por unica vez... & call npm install --omit=dev)
:inicio
node --env-file=.env bot.mjs
echo.
echo El asistente se detuvo. Se vuelve a iniciar en 10 segundos (cerra esta ventana para apagarlo del todo).
timeout /t 10 >nul
goto inicio
