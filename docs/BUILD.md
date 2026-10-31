# Build from source

Requirements: Windows x64, Node.js 22.12 or newer, npm, PowerShell and the Windows SDK/runtime available to Electron Builder.

```powershell
npm ci
npm test
node test/ui.cjs
npm run dist
node test/ui.cjs ../../outputs/build/win-unpacked/OPlay.exe
node test/portable.cjs ../../outputs/build/OPlay-2.1.0-Windows.exe
```

The portable output goes to `../../outputs/build/`. The app uses Electron and built-in Node modules; vendor graphics DLLs are downloaded only when a user chooses a runtime. Build artifacts are not committed to Git. The official release binary is unsigned.

Hardware write tests in `test/` are separate from the default suite and can trigger Windows UAC or alter temporary settings. Run them only on a machine you own and have prepared for recovery.
