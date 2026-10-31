# What OPlay changes

OPlay reads local launcher manifests and hardware telemetry. A selected optimization can change Windows Game Mode, background capture, GPU preferences and CPU power policy. It records original values before supported changes and checks written values. The process priority guard applies while OPlay is running.

Graphics Studio changes only the selected, supported game runtime DLL or a selected OptiScaler profile. Close the game first and use only offline or single-player installations. OPlay backs up original files, verifies staged writes and supports an explicit restore. Game updates after installation can conflict with restoration; OPlay preserves externally changed files and keeps the original backup.

GPU offset and V/F curve sessions require Windows administrator approval for the small helper. The helper journals initial values and uses a heartbeat and thermal rollback. This is not proof that a clock is stable under every game. Start with small changes and test your own games. CPU multiplier and RAM timing/frequency overclocking are unavailable on the examined machine.

DLSS/FSR/XeSS DLL swaps cannot add game-engine support. OptiScaler FSR/XeSS frame-generation routes depend on the game, GPU and runtime. OPlay does not ship a universal DLSS 5/MFG unlock, ReShade or Live Flow screen processing. No measured FPS uplift is claimed for the public release.

Errors are logged locally to `%APPDATA%\Aether\logs\errors.jsonl`. Logs may contain local paths. Inspect them before sharing. See the main [README](../README.md) for technical details.
