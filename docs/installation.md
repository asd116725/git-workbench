# Installing on macOS

**English** | [简体中文](zh-CN/installation.md)

## Download and verify

The current stable release, `1.6.1`, is built for Apple Silicon (M-series chips). Its filename is `GitWorkbench_1.6.1_macos_arm64.dmg`. Check **About This Mac** for your chip type; this installer does not support Intel Macs.

Download the DMG and `SHA256SUMS.txt` from the [v1.6.1 release](https://github.com/asd116725/git-workbench/releases/tag/v1.6.1). Do not mix checksums from different releases. Open a terminal in the directory containing both files:

```sh
shasum -a 256 -c SHA256SUMS.txt
```

Continue when the output says `GitWorkbench_1.6.1_macos_arm64.dmg: OK`. If verification fails, download both files again from the same release; do not install the damaged file.

## Install

1. Double-click the DMG.
2. Drag **代码管理** (Git Workbench) to Applications on the right.
3. Wait for copying to finish, then eject the disk image.
4. Open **代码管理** from Applications. Do not keep running the app from inside the DMG.

The app uses your installed Git. Run `git --version` in a terminal; if macOS asks to install developer tools, follow the prompts to install Xcode Command Line Tools. Building from source requires Node.js, pnpm, and Rust, but you do not need them to use the installer.

## First launch

This installer uses **ad-hoc signing** to seal the local executable for integrity checks. It does not include an Apple Developer ID signature and has not been notarized by Apple, so Gatekeeper may still ask you to confirm its source. The stable `1.6.1` version number does not imply Apple signing or notarization.

If macOS says it cannot verify the developer:

1. Check the download source and SHA-256 checksum first.
2. Try opening the app once, then go to **System Settings → Privacy & Security**.
3. Click **Open Anyway** in the notice provided for this app and follow the system prompts.

The wording and location can vary between macOS versions. If a managed computer blocks unnotarized software, your device administrator must allow it. There is no need to disable system-wide security protections.

If the app still appears “damaged” or cannot open, download it again and verify its checksum. If the problem persists, report your macOS version, chip type, and full error message in [Issues](https://github.com/asd116725/git-workbench/issues). Do not include repository source code or sensitive paths.

## Update or uninstall

Before updating, save any commit drafts and quit the app completely with `⌘Q`; closing the window only hides it and leaves the process running. Download a new version from [Releases](https://github.com/asd116725/git-workbench/releases), verify it, then drag it into Applications and choose to replace the existing app. There is currently no in-app automatic updater.

To uninstall, quit the app and move **代码管理** from Applications to the Trash. Repositories are managed separately and are not deleted when the app is removed. Preferences such as font size and layout may remain in the WebView's local data.

## Compatibility

The minimum build target is macOS 12, and this release provides an arm64 package. Version 1.6.1 was checked on the maintainer's current macOS using a separate desktop instance and temporary repositories: first publication, retry after failure, upstream tracking setup, and subsequent outgoing commit counts passed verification. Compatibility with every older macOS version has not been established. Please include your system version and reproduction steps when reporting a compatibility issue.

See the [user manual](user-manual.md) for app usage and the [official Tauri macOS signing documentation](https://v2.tauri.app/distribute/sign/macos/) for signing details.
