# What OPlay changes

OPlay reads local launcher manifests and hardware telemetry. A selected optimization can change Windows Game Mode, background capture, GPU preferences and CPU power policy. It records original values before supported changes and checks written values. The process priority guard applies while OPlay is running.

Graphics Studio can swap an existing DLL, directly add a downloaded DLL, install an OptiScaler profile or install a current DLSS Unlocked community package. Close the game first; OPlay blocks writes while it detects the game's process. Use community mods in offline or single-player games. OPlay does not bypass anti-cheat, although it no longer blocks file installation based on anti-cheat indicators. Modifying protected or online titles can cause account consequences. OPlay backs up original files, verifies staged writes and supports an explicit restore. Game updates after installation can conflict with restoration; OPlay preserves externally changed files and keeps the original backup.

GPU offset and V/F curve sessions require Windows administrator approval for the small helper. The helper journals initial values and uses a heartbeat and thermal rollback. This is not proof that a clock is stable under every game. Start with small changes and test your own games. CPU multiplier and RAM timing/frequency overclocking are unavailable on the examined machine.

File installation is not proof that a game loads a DLL or enables frame generation. OPlay does not ship the upstream DLLs in its EXE; the user-selected community package is downloaded from its release and SHA-256 checked. Its own documented requirements include game DLSS/FG inputs. OPlay does not provide a universal engine integration, ReShade or Live Flow screen processing. No measured FPS uplift is claimed for the public release.

Errors are logged locally to `%APPDATA%\Aether\logs\errors.jsonl`. Logs may contain local paths. Inspect them before sharing. See the main [README](../README.md) for technical details.
