@echo off
REM VOIDSTRIKE — Local Play Launcher (Windows)
REM Double-click this file to launch the game

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "PORT=3000"
if defined VOIDSTRIKE_PORT set "PORT=%VOIDSTRIKE_PORT%"
set "URL=http://localhost:%PORT%"

cd /d "%PROJECT_DIR%"

echo.
echo   ========================================
echo            V O I D S T R I K E
echo          Local Play Launcher
echo   ========================================
echo.

REM ============================================
REM Check Node.js
REM ============================================
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install it from https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v') do set "NODE_MAJOR=%%a"
REM node -v returns "v20.x.x" — strip the 'v' prefix
for /f "tokens=1 delims=." %%a in ('node -v') do set "NODE_VER=%%a"
set "NODE_VER=%NODE_VER:v=%"

if %NODE_VER% lss 18 (
    echo [ERROR] Node.js 18+ required
    pause
    exit /b 1
)

REM ============================================
REM Install dependencies if needed
REM ============================================
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

REM ============================================
REM Determine mode (dev or prod)
REM ============================================
set "MODE=dev"
if "%~1"=="build" set "MODE=build"
if "%~1"=="prod" set "MODE=build"

if "%MODE%"=="build" (
    echo Building for production...
    call npm run build
    echo.
    echo Starting production server on port %PORT%...
    start "VOIDSTRIKE Server" /b cmd /c "npx next start -p %PORT%"
) else (
    echo Starting dev server on port %PORT%...
    start "VOIDSTRIKE Server" /b cmd /c "npx next dev -p %PORT%"
)

REM ============================================
REM Wait for server to be ready
REM ============================================
echo Waiting for server...
set "RETRIES=0"
:wait_loop
timeout /t 1 /nobreak >nul
curl -s "%URL%" >nul 2>nul
if %errorlevel% equ 0 goto server_ready
set /a RETRIES+=1
if %RETRIES% geq 60 (
    echo [ERROR] Server failed to start after 60s
    pause
    exit /b 1
)
goto wait_loop

:server_ready
echo Server ready!
echo.

REM ============================================
REM Open browser in app mode
REM ============================================
echo Launching VOIDSTRIKE...

REM Try Chrome first (app mode for native-feeling window)
set "CHROME_PATH="
for %%p in (
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do (
    if exist %%p (
        set "CHROME_PATH=%%~p"
        goto found_chrome
    )
)

REM Try Edge (also supports app mode)
for %%p in (
    "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
    "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do (
    if exist %%p (
        set "CHROME_PATH=%%~p"
        goto found_chrome
    )
)

REM Fallback: open default browser
echo No Chrome/Edge found, opening default browser...
start "" "%URL%"
goto after_launch

:found_chrome
start "" "%CHROME_PATH%" --app="%URL%" --start-maximized

:after_launch
echo.
echo Game running at: %URL%
echo.
echo Press any key to stop the server and exit...
pause >nul

REM Kill the server
taskkill /fi "WINDOWTITLE eq VOIDSTRIKE Server" >nul 2>nul
taskkill /f /im node.exe >nul 2>nul

echo Shutting down.
exit /b 0
