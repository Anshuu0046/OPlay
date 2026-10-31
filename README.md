# OPlay 2.1 for Windows

OPlay is a local Windows game library with graphics runtime management, live telemetry and reversible system profiles. Download `OPlay-2.1.0-Windows.exe` from the [official releases](https://github.com/Anshuu0046/OPlay/releases). Run the portable executable; it extracts before opening. Windows x64; verified on Windows 11. The executable is unsigned, so Windows SmartScreen may ask for confirmation. Check the release SHA-256 before running it.

The [public download site](https://oplay-windows-library.anshumantripathy0056.chatgpt.site/) provides the latest verified release link. The source and documentation are in this repository. OPlay is independent from DLSS Swapper, DLSS 5 Manager and OptiScaler.

![OPlay 2.1 library](website/oplay-library.png)

## Interface

The interface uses one glass navigation rail, widescreen game artwork, a cover grid and dark/light themes. Steam hero artwork is read separately from portrait covers. Windows 11 22H2+ uses native DWM Acrylic; older Windows has a fallback. System transparency preferences are preserved. The initial window fits the monitor work area. Keyboard navigation, drag selection, reduced motion, visible focus states and 1040-pixel layouts are tested.

## Graphics Studio

- **Game profiles:** inspect an actual installation for DLSS, FSR and XeSS runtime DLLs, their versions and signatures.
- **Runtime library:** refresh the upstream DLSS Swapper catalog, select a release and download it. Only curated, non-development entries marked signed are listed. Downloaded DLLs must match the catalog hash, contain an x64 PE image and have a valid Windows NVIDIA/AMD/Intel publisher signature. A SHA-256 is recorded locally. Swapping replaces a matching existing component; it does not add missing game-engine integration.
- **OptiScaler profiles:** download pinned upstream OptiScaler 0.9.4, check its SHA-256, and install a DX12 x64 profile beside the selected game executable. Choose automatic/DLSS/FSR/XeSS upscaling and off/FSR/XeSS frame generation. The profile selects a native DLSSG input when found, otherwise the existing upscaler input. Compatibility and overlay configuration still need checking in the game. Runtime binaries and license files come from upstream; OPlay does not run the upstream batch installer.
- **Restore points:** original files are backed up before writes. Staged files are checked and renamed into place. A failure rolls back earlier writes. Restore verifies hashes and preserves later changes made by a game updater or another mod. Added mod files are removed only when unchanged. Unfinished profiles block OPlay's game launch until restored. Original DLLs remain in the component backup folder even after a successful restore.

Close the game and confirm it is offline/single-player before installing a profile. Detected anti-cheat/online title indicators block modifications. Detection is not exhaustive: unknown games still need a compatibility check. Existing proxy mods are not silently overwritten. Protected WindowsApps permissions are never changed. Only the supported named runtime DLLs are replaced; game configuration and unrelated files are preserved. OptiScaler has its own generated INI, backed up if one existed.

### Technology support is explicit

| Feature | OPlay behavior |
|---|---|
| DLSS Super Resolution / Ray Reconstruction | Manage existing compatible game runtimes. |
| Native NVIDIA frame generation / MFG | Show hardware requirements; DLL replacement does not create support. |
| Community frame generation | Install supported OptiScaler FSR/XeSS profiles; verify in-game operation. |
| DLSS 5 neural rendering | Show vendor/game requirements. Experimental neural-rendering models and screen-wide processing are not bundled or claimed as working. |
| FSR 4 | Show matching GPU/runtime requirements; no universal unlock claim. |
| ReShade / Live Flow / additional MFG plugins | Researched, not implemented in this release. |

No FPS gain, artifact-free output, or compatibility in every game is promised. DLL swaps can prevent a game from launching; restore its originals if needed.

## Source research

Reviewed the available upstream source directly; no executable decompilation was needed. OPlay's component manager is an independent implementation; upstream app source/assets are not bundled.

- [DLSS Swapper](https://github.com/beeradmoore/dlss-swapper), commit `53b1ecc9d9ae59a23bb3e6194a55ba6243426d9c`: inspected game/runtime discovery, catalog records, downloads and restoration. Its public catalog supplies release metadata. Its code is GPL-3.0; no app code was copied into OPlay.
- [DLSS 5 Manager](https://github.com/NODIX-TECH/DLSS-5-MANAGER), commit `4610db5cf8fffe8d571d9284870cfd07a22bf140`: reviewed game analysis, installation tracking, component routes and separate screen-processing assets. Its original-code copyright notice does not grant a blanket reuse license. Its app code/assets/private cloud payloads were not copied.
- [OptiScaler installation](https://github.com/optiscaler/OptiScaler/wiki/Installation) and [frame-generation options](https://github.com/optiscaler/OptiScaler/wiki/Frame-Generation-Options): used documented profile keys and game requirements. In-game restart/overlay verification remains necessary.
- [NVIDIA DLSS technology matrix](https://www.nvidia.com/en-us/geforce/technologies/dlss/) and [DLSS 5 FAQ](https://www.nvidia.com/en-us/geforce/forums/nvidia-app/129/583738/dlss-5-faq-932026/): hardware claims are separate from experimental community routes. The examined RTX 3050 supports DLSS SR; it is not native DLSS 5/MFG hardware.

OptiScaler package pinned for this build: `Optiscaler_0.9.4-final.20260718._MM.7z`, SHA-256 `575cb4df866116093df75af607e37fd70e10f5163e0f23fd5c804142e80ef0ad`, obtained from its official GitHub release. No vendor runtime binaries are included in the OPlay executable or source archive.

## Library and existing controls

Steam, Epic and GOG manifests are read locally. Registry-backed Ubisoft Connect, Battle.net and EA game folders are also discovered where available. Other games can be imported through Add game / Scan folder. Xbox protected package discovery/modification is not implemented; accessible game executables can be added manually. Offline saved entries remain visible, with availability checked before launch.

Existing Windows optimization, CPU power profiles, process priority guard, manual NVIDIA GPU/VRAM offsets, V/F curve editing, telemetry and automatic error logging remain available. Global optimization changes Windows Game Mode, background capture and per-game GPU preferences with backups and read-back checks. In-game graphics files are preserved. Keep OPlay open/minimized for the priority guard.

GPU/VRAM and V/F curve sessions use the elevated small helper. Original settings are journaled and restored on exit, disconnect, lost heartbeat or thermal threshold. Curve writes currently use private NVAPI Ampere layouts; future drivers can reject them. A flat V/F curve is not a hard voltage cap. CPU multiplier and system-RAM timing/frequency writes remain unavailable on the examined ASUS G513IC / Ryzen 4800H firmware. Windows power profiles are not CPU frequency overclocking. No kernel driver, firmware patch, security bypass or startup service is installed.

## Data and logs

The existing `%APPDATA%/Aether` profile is deliberately retained through the rename so existing games, backups and recovery records remain accessible. Component cache and write-ahead records are under its `components` subfolder. GPU helper recovery remains under `%LOCALAPPDATA%/Aether`. Do not discard recovery records while changes remain.

Activity > Open error logs opens local `logs/errors.jsonl`. App operations, helper failures, renderer errors and crashes are recorded automatically. Logs rotate at 1 MiB with three backups and suppress identical repeats for one minute. Common credential patterns are redacted. Logs can contain local paths; inspect before sharing. No logs are uploaded. Unwritable/full storage cannot prevent recovery but can prevent logging.

## Verification and development

```
npm ci
npm test
node test/ui.cjs
node test/components-live.cjs
powershell -NoProfile -File test/curve-plan.ps1
powershell -NoProfile -File test/nvidia-sensor.ps1
node test/windows-live.cjs
npm run dist
node test/ui.cjs ../../outputs/build/win-unpacked/OPlay.exe
node test/portable.cjs ../../outputs/build/OPlay-2.1.0-Windows.exe
```

`components-live` uses a generated fixture with real signed upstream runtimes; it never launches the fixture or modifies a user game. It verifies download/signature checks, DLL swap/restore, upstream OptiScaler extraction/profile installation and exact restoration of the initial folder. Unit tests cover tampered catalogs, traversal/links, preservation of external changes, restart recovery and rollback after an injected locked-file failure. UI tests use isolated profiles, disable OS/game mutations, and check library interactions, both themes, Graphics Studio, native Acrylic, keyboard/drag/reduced-motion behavior, layouts, sandboxing and automatic error logs.

The existing hardware-test evidence distinguishes driver read-back/watchdog results from game stability/FPS benchmarks. Hardware-write tests require UAC and must not be confused with the isolated UI suite. This release's component workflow is verified at the file-management layer; no actual user's game was launched to claim DLSS/FG/MFG performance.

The 2.1 interface revision was designed directly from the supplied feedback without UI/UX Pro Max. Runtime npm dependencies have no advisories in the checked tree; development packaging dependencies have moderate transitive advisories and are not shipped as runtime dependencies.

The final log review also reproduced an older NVIDIA UI temperature-format failure. The shared numeric parser now treats unavailable/non-finite labels as missing data while preserving the hot-CPU calibration gate; the dedicated sensor test passes without starting calibration.
