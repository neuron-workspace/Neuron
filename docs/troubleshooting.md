# Troubleshooting

## Electron opens before Vite is ready

Use `npm run dev`, not the individual Electron command. The launcher waits for port 5173 and `dist/main/main.js`. If it times out, inspect the renderer and main-process output earlier in the terminal.

## Port 5173 is already in use

Stop the older Vite process, then rerun `npm run dev`. The Vite configuration uses a strict port so Electron never connects to an unrelated server.

## Installed app cannot find the demo repository or icon

Run a fresh `npm run dist:dir`. Packaged resources are copied through Electron Builder and resolved from `process.resourcesPath`; stale unpacked builds may predate that configuration.

## Windows or macOS blocks a downloaded build

Current public artifacts are unsigned. Do not disable system security globally. Verify that the artifact came from the expected GitHub Release and use the operating system's per-application review flow. Maintainers should configure signing before promoting releases broadly.

## Linux AppImage: "Failed to move to new namespace"

Ubuntu 24.04+ and Debian 13 use AppArmor to block unprivileged user namespaces, which Electron's sandbox needs. The `.deb` installs an AppArmor profile that allows them, so it works as is: **install the `.deb` if you can.**

To keep the AppImage, give it a profile of its own. Save this as `/etc/apparmor.d/neuron-appimage`, with the path to your AppImage in place of the example:

```
abi <abi/4.0>,
include <tunables/global>

profile neuron-appimage /home/*/Applications/Neuron-*.AppImage flags=(unconfined) {
  userns,
}
```

Then load it with `sudo apparmor_parser -r /etc/apparmor.d/neuron-appimage` and start the AppImage again.

Last resort only: `./Neuron-*.AppImage --no-sandbox` starts it with Chromium's sandbox turned off. That is weaker: a compromised page or view is no longer contained by the sandbox. Prefer the `.deb` or the profile.

## Packaging cannot download Electron

Electron Builder downloads platform runtime files on first use. Check network, proxy, firewall, and GitHub access. CI runners normally perform this download automatically.

## `npm audit` reports Electron advisories

Update Electron to a patched supported release, rebuild, and test the desktop application. Do not use `npm audit fix --force` blindly because Electron major upgrades can change runtime behavior.

## GitHub Pages returns 404

Choose **GitHub Actions** as the Pages source and run the `Deploy download page` workflow. Pages hosts the website only; installers appear after a version tag successfully completes the release workflow.
