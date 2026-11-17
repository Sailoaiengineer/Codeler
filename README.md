# Codeler

Codeler is a desktop code editor built from [VSCodium](https://github.com/VSCodium/vscodium). I made it so my friends and I can edit the same files at the same time, see each other's cursors, chat next to the code and share a running preview. On your own, it works like a normal editor on a normal folder.

It's free and open source under the [MIT license](LICENSE).

## Download

Windows: get the installer from [Releases](https://github.com/Sailoaiengineer/Codeler/releases).
macOS and Linux: not yet.

The installer is not code-signed yet, so Windows may show "Windows protected your PC". Click **More info**, then **Run anyway**. If Smart App Control is on, Windows blocks unsigned apps with no way around it until the installer is signed.

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org) (applied for, not active yet).

- Committers and reviewers: [Sailoaiengineer](https://github.com/Sailoaiengineer)
- Approvers: [Sailoaiengineer](https://github.com/Sailoaiengineer)

Every signed release is built by GitHub Actions from this repository and approved by hand before it is signed.

## Privacy

Codeler sends nothing anywhere unless you sign in. Working alone on a folder stays on your computer.

When you sign in (with Google) and use a team, Codeler sends:
- your Google name, email address and profile photo, to show who you are to your team;
- the files, chat messages, cursor positions and activity of team projects, so your teammates see them live.

This goes to the Codeler backend on [Convex](https://www.convex.dev/legal/privacy/), and sign-in goes through [Google](https://policies.google.com/privacy). You can delete your account, which removes your user record.

The AI panel only contacts the AI provider you add a key for (Anthropic, OpenAI or Google), and the key stays on your computer. Extensions come from [Open VSX](https://open-vsx.org/) when you install them.

## Building

See `scripts/build-windows.sh` (local) and `.github/workflows/build.yml` (GitHub Actions). Codeler's changes to VS Code are in `patches/`; the Codeler features live in `extensions/codeler/`, and the sign-in site and backend in `web/`.
