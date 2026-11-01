# Install and update

1. Download the current `OPlay-*-Windows.exe` from [GitHub Releases](https://github.com/Anshuu0046/OPlay/releases).
2. Compare the executable SHA-256 with `SHA256SUMS.txt` in the same release. In PowerShell: `Get-FileHash .\OPlay-2.2.0-Windows.exe -Algorithm SHA256`.
3. Run the portable executable on Windows x64. It extracts before the app opens. Windows SmartScreen may warn because this build is not code signed.
4. Let OPlay discover Steam, Epic and GOG entries. Use **Add a game** or **Scan a game folder** for other installations.

OPlay 2.1 keeps data in `%APPDATA%\Aether` and GPU recovery state in `%LOCALAPPDATA%\Aether` so upgrades from earlier Aether/OPlay builds keep the existing library and restore points. Do not delete those folders while a restore is pending. No installer service or kernel driver is added.

For an update, close OPlay normally, replace the portable executable with the newer release, and launch it. The app restores its temporary GPU tuning and process priorities during a normal close.
