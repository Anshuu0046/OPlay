# OPlay 1.0.0

[Download OPlay for Windows](https://github.com/Anshuu0046/OPlay/releases/download/v1.0.0/OPlay-1.0.0-Windows.exe) · [SHA-256 checksums](https://github.com/Anshuu0046/OPlay/releases/download/v1.0.0/SHA256SUMS.txt) · [Installation guide](https://github.com/Anshuu0046/OPlay/blob/main/docs/INSTALL.md)

OPlay is a local Windows game library with graphics runtime management, live hardware telemetry, reversible optimization settings, and supported NVIDIA GPU tuning. This is a portable x64 executable; no separate installer is needed.

## What's new

- **A redesigned desktop app.** The library and workspaces now use AMOLED black, restrained red accents, a horizontal glass navigation bar, real game artwork, and clearer controls. The game picker, download tray, installed-state badges, restore points, and top-edge window controls were refined.
- **A corrected MFG package route.** The DLSS Unlocked Ampere MFG loader is paired with a signed DLSS-G 310.x runtime from the verified DLL catalog in one reversible transaction. The package's neural-rendering profile is enabled before installation.
- **Clearer graphics status.** OPlay checks installed files against its saved hashes and distinguishes a loaded MFG module from a neural runtime that failed to load. Download progress shows transferred bytes and a percentage when the server provides a total.
- **Better crash recovery.** After a graphics install, OPlay launches the game, checks startup, reads matching Windows crash reports, and records the faulting module and nearby driver or graphics-log hints. It watches for later crashes while open and can restore its unchanged files. Mod-edited INI files are saved to a recovery folder before rollback.

## What OPlay can do

- **Bring games together:** discover Steam, Epic Games, GOG, and available Ubisoft Connect, Battle.net, and EA installations; add other accessible game executables or folders manually.
- **Manage graphics files:** download verified DLSS, FSR, and XeSS runtime DLLs, inspect installed versions, swap versions, or place a downloaded DLL beside a selected game's executable. Download the community DLSS Unlocked MFG/neural package or install an OptiScaler upscaling and FSR/XeSS frame-generation route. Original files are backed up for restore.
- **Optimize Windows settings:** view live CPU, memory, GPU, and temperature telemetry; apply reversible Game Mode, capture, CPU power, and per-game GPU preferences; use the live game-priority guard while OPlay is open.
- **Tune supported NVIDIA GPUs:** apply session GPU/VRAM frequency offsets or a voltage-frequency curve with read-back checks, temperature limits, a watchdog, and restoration of original settings. NVIDIA's own automatic tuning scan is available through its Performance panel.
- **Keep a local record:** review restore points, launch diagnoses, and automatically rotated error logs in Activity.

## Verification and limits

The 33 automated app tests, source and packaged UI tests, an isolated 63-file install/restore fixture, and portable EXE startup test passed. A Ghost of Tsushima launch loaded the community MFG module with DLSS-G 310.9.16. Generated frames and neural rendering were **not** independently confirmed in gameplay; the last neural-runtime log reported a load error. A successful startup check does not prove long-session stability or feature activation.

Graphics DLLs and community packages are downloaded only when requested; they are not bundled in the EXE. Compatibility depends on each game, driver, and package. OPlay does not bypass anti-cheat, add a kernel driver, or expose CPU multiplier/system-RAM frequency overclocking on the examined hardware. The EXE is unsigned, so Windows may show a SmartScreen prompt.

**SHA-256:** `bf174db8da2a090cde8ad5225e7eedc56b93caea1d700ee03719451111b09d61` for `OPlay-1.0.0-Windows.exe`.
