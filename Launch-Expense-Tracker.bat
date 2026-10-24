@echo off
title Daily Budget & Expense Tracker Server
color 0B

echo ========================================================
echo    Starting Daily Expenses - Budget & Spending Tracker
echo ========================================================
echo.

cd /d "%~dp0"

IF NOT EXIST "node_modules" (
    echo [INFO] Installing required dependencies...
    call npm install
    echo.
)

echo [INFO] Launching Expense Tracker on http://localhost:4000 ...
start "" http://localhost:4000

node server.js
pause
