# Install and update

1. Download the current `OPlay-*-Windows.exe` from [GitHub Releases](https://github.com/Anshuu0046/OPlay/releases).
2. Compare the executable SHA-256 with `SHA256SUMS.txt` in the same release. In PowerShell: `Get-FileHash .\OPlay-2.3.0-Windows.exe -Algorithm SHA256`.
3. Run the portable executable on Windows x64. It extracts before the app opens. Windows SmartScreen may warn because this build is not code signed.
4. Let OPlay discover Steam, Epic and GOG entries. Use **Add a game** or **Scan a game folder** for other installations.

Open a game card to choose **Latest MFG**, **DLSS neural rendering**, **FSR frame generation**, or an **FSR 4 route**. The MFG and neural actions install the same DLSS Unlocked community bundle. FSR routes use OptiScaler; the actual FSR DLL version depends on the downloaded package. If a launcher entry has no executable path, OPlay asks you to choose the actual game executable inside its installation folder. Use **Graphics Studio → Runtime library** to download the packages separately before installing, and **Graphics Studio → Your restore points** to undo a file installation. Close the game before installing graphics files.

OPlay keeps data in `%APPDATA%\Aether` and GPU recovery state in `%LOCALAPPDATA%\Aether` so upgrades from earlier Aether/OPlay builds keep the existing library and restore points. Do not delete those folders while a restore is pending. No installer service or kernel driver is added.

For an update, close OPlay normally, replace the portable executable with the newer release, and launch it. The app restores its temporary GPU tuning and process priorities during a normal close.
