# Chords USB driver installer (Windows)

Some boards are flashed through a USB bootloader over WebUSB: UNO R4 Minima,
STM32 (G4 / F4), GIGA R1 and Raspberry Pi Pico. On Windows, Chrome only sees a
USB device that uses the **WinUSB** driver, and a website can't install drivers.
A new PC therefore shows no device in the flasher's picker.

This folder builds a one-click installer that sets up WinUSB for all those
bootloaders at once. Chords Web offers it in the firmware-update popup on
Windows ("Download USB driver installer"). The user runs it once per PC and
clicks **Yes** on the admin prompt.

It covers:

| USB ID            | Bootloader                      |
|-------------------|---------------------------------|
| `2341:0369`       | Arduino UNO R4 Minima           |
| `0483:DF11`       | STM32 ROM bootloader (DFU)      |
| `2341:0366`, `2341:0266` | Arduino GIGA R1          |
| `2E8A:0003` MI 1  | Raspberry Pi Pico (PICOBOOT)    |

To add a board, add a `call :install ...` line to `install-drivers.bat`.

## Build (on Windows)

1. **Get `wdi-simple.exe`.** It's the command-line example of
   [libwdi](https://github.com/pbatard/libwdi), the library behind Zadig.
   Build it from source: clone libwdi, follow its build instructions
   (Visual Studio: open `libwdi.sln`, set the WinUSB/WDK options in
   `msvc/config.h` as described there, build the `wdi-simple` project,
   Release, x64). Copy the resulting `wdi-simple.exe` into this folder.
2. Run `build.bat` from this folder. It packs `install-drivers.bat` and
   `wdi-simple.exe` into one self-extracting installer with IExpress (built
   into Windows) and writes it to
   **`public/downloads/Chords-USB-Driver-Installer.exe`** in Chords Web.

## Test (before publishing)

On a Windows PC that has never had Zadig, the Arduino IDE or ST's tools:

1. Run `Chords-USB-Driver-Installer.exe` and click **Yes**. Every line should
   end in `ok`.
2. Test **with the board unplugged** during install, then plug it in bootloader
   mode. Device Manager should list it under *Universal Serial Bus devices*,
   and its driver (Properties, Driver tab) should be WinUSB.
3. In Chords Web, press Flash: the board's bootloader should now appear in the
   browser's picker and flash.

If a board only works when it was plugged in during the install, note it in the
popup text. libwdi can pre-install for absent devices, but check it on the
Windows versions you support.

## Publish

Commit `public/downloads/Chords-USB-Driver-Installer.exe` and deploy Chords
Web as usual. The site serves it itself at `/downloads/Chords-USB-Driver-Installer.exe`
(no release or Worker involved). The link is `USB_DRIVER_INSTALLER_URL` in
`src/lib/flasher/chords.ts`.

## Windows SmartScreen

An unsigned `.exe` downloaded from the internet shows "Windows protected your
PC" the first time (**More info → Run anyway**). Signing it with a code-signing
certificate removes that warning.
