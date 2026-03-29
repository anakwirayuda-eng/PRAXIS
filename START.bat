@echo off
title MedCase Pro - PRAXIS
echo.
echo  ========================================
echo   PRAXIS - Clinical Case Simulator
echo   Starting dev server...
echo  ========================================
echo.
cd /d "%~dp0"
start "" http://localhost:5173
npm run dev
