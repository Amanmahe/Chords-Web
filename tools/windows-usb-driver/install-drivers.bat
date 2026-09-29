@echo off
setlocal
:: Chords USB driver installer (Windows).
::
:: Installs the WinUSB driver for the USB bootloaders Chords Web flashes
:: through WebUSB. Windows only lets the browser see a device that uses WinUSB,
:: and a website can't install drivers, so this runs once per PC.
:: Uses wdi-simple.exe (libwdi, the engine behind Zadig); see README.md.

:: Ask for administrator rights once (installing a driver needs them). -Wait so
:: the self-extracting installer keeps its files until we're done.
net session >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs -Wait"
    exit /b
)

cd /d "%~dp0"
if not exist "wdi-simple.exe" (
    echo wdi-simple.exe is missing next to this script.
    pause
    exit /b 1
)

set "DEST=%TEMP%\chords-usb-driver"
set FAILED=0

echo.
echo  Chords USB driver installer
echo  ---------------------------
echo  Installing the USB driver for the Chords board bootloaders.
echo  This takes a few seconds per board type. The boards don't need to be plugged in.
echo.

call :install 0x2341 0x0369 ""  "Arduino UNO R4 Minima bootloader"
call :install 0x0483 0xDF11 ""  "STM32 BOOTLOADER"
call :install 0x2341 0x0366 ""  "Arduino GIGA R1 bootloader"
call :install 0x2341 0x0266 ""  "Arduino GIGA R1 bootloader"
call :install 0x2E8A 0x0003 "1" "RP2 Boot (Interface 1)"

echo.
if "%FAILED%"=="0" (
    echo  Done. Go back to Chords Web and press Flash.
) else (
    echo  Some drivers could not be installed. Replug the board, put it in
    echo  bootloader mode and run this installer again.
)
echo.
pause
exit /b 0

:: :install <vid> <pid> <interface or ""> <name>
:install
echo  - %~4 (%~1:%~2)
if "%~3"=="" (
    wdi-simple.exe --vid %~1 --pid %~2 --type 0 --name "%~4" --dest "%DEST%\%~1_%~2" --stealth-cert --log 4
) else (
    wdi-simple.exe --vid %~1 --pid %~2 --iid %~3 --type 0 --name "%~4" --dest "%DEST%\%~1_%~2_%~3" --stealth-cert --log 4
)
if errorlevel 1 (
    echo      failed ^(code %errorlevel%^)
    set FAILED=1
) else (
    echo      ok
)
exit /b 0
