@echo off
setlocal
:: Packs install-drivers.bat + wdi-simple.exe into one self-extracting
:: Chords-USB-Driver-Installer.exe with IExpress (built into Windows).
:: Run on Windows from this folder; see README.md.

cd /d "%~dp0"
if not exist "wdi-simple.exe" (
    echo Put wdi-simple.exe in this folder first ^(see README.md^).
    exit /b 1
)

set "OUT=%~dp0Chords-USB-Driver-Installer.exe"
set "SED=%TEMP%\chords-usb-driver.sed"

> "%SED%" (
    echo [Version]
    echo Class=IEXPRESS
    echo SEDVersion=3
    echo [Options]
    echo PackagePurpose=InstallApp
    echo ShowInstallProgramWindow=0
    echo HideExtractAnimation=1
    echo UseLongFileName=1
    echo InsideCompressed=0
    echo CAB_FixedSize=0
    echo CAB_ResvCodeSigning=0
    echo RebootMode=N
    echo InstallPrompt=%%InstallPrompt%%
    echo DisplayLicense=%%DisplayLicense%%
    echo FinishMessage=%%FinishMessage%%
    echo TargetName=%%TargetName%%
    echo FriendlyName=%%FriendlyName%%
    echo AppLaunched=%%AppLaunched%%
    echo PostInstallCmd=%%PostInstallCmd%%
    echo AdminQuietInstCmd=%%AdminQuietInstCmd%%
    echo UserQuietInstCmd=%%UserQuietInstCmd%%
    echo SourceFiles=SourceFiles
    echo [Strings]
    echo InstallPrompt=
    echo DisplayLicense=
    echo FinishMessage=
    echo TargetName=%OUT%
    echo FriendlyName=Chords USB driver installer
    echo AppLaunched=cmd /c install-drivers.bat
    echo PostInstallCmd=^<None^>
    echo AdminQuietInstCmd=
    echo UserQuietInstCmd=
    echo FILE0="install-drivers.bat"
    echo FILE1="wdi-simple.exe"
    echo [SourceFiles]
    echo SourceFiles0=%~dp0
    echo [SourceFiles0]
    echo %%FILE0%%=
    echo %%FILE1%%=
)

iexpress /N /Q "%SED%"
if exist "%OUT%" (
    echo Built %OUT%
) else (
    echo IExpress failed to build the installer.
    exit /b 1
)
