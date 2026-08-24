# Distribution and releases

GitHub Pages cannot execute or install an Electron application. It hosts the public download page, while GitHub Releases stores the actual installers. Neuron's Pages button resolves the repository owner and name from the Pages URL and links to the newest release.

## First GitHub publication

1. Create an empty GitHub repository named `Neuron`.
2. Add the remote and push `main`.
3. In **Settings → Pages**, select **GitHub Actions** as the source.
4. Confirm Actions are enabled under **Settings → Actions → General**.
5. Enable private vulnerability reporting under **Settings → Security**.

```bash
git remote add origin https://github.com/YOUR_ACCOUNT/Neuron.git
git push -u origin main
```

The CI workflow validates pushes and pull requests. The Pages workflow deploys `docs/` after relevant changes to `main`.

## Publish a release

Create and install a local beta first:

```bash
npm run dist:test
```

This writes a **Neuron Test** installer under `release/test/`. It uses the same packaged runtime path as production while keeping a separate app id, installer name, and user data from the final app.

Update `package.json`, commit the version, and push a matching tag:

```bash
git tag v1.0.0
git push origin main --tags
```

`.github/workflows/release.yml` builds and uploads:

- Windows x64: NSIS and portable builds
- Linux x64: AppImage and Debian packages
- macOS: DMG and ZIP builds for x64 and arm64

The workflow uses the repository-provided `GITHUB_TOKEN`; no personal access token is required for normal release uploads.

## Signing, and what each kind of signing actually buys

It is worth separating three things that get called "signing", because they
solve different problems and only one of them is free.

### Proving a download is the build CI produced

This is the integrity question: did someone swap the installer between GitHub
and the user?

**A self-signed Authenticode certificate does not answer it.** It has no trust
anchor, so anyone who tampers with the installer can re-sign it with their own
certificate carrying the same subject name, and Windows presents the two
identically. It also does not remove the SmartScreen warning.

What does answer it, and costs nothing:

- **SHA-256 checksums** — `SHA256SUMS.txt` is attached to every release.
- **Build provenance** — the release workflow attests each installer with
  `actions/attest-build-provenance`, signed by GitHub's OIDC identity. The
  attestation names the exact workflow, commit and runner that produced the
  file, and cannot be forged by re-signing.

Anyone can verify a download:

```bash
gh attestation verify Neuron-0.4.3-win-x64.exe --repo shiv-khetan/Neuron
sha256sum -c SHA256SUMS.txt --ignore-missing
```

### Removing the "Unknown publisher" warning on direct downloads

Only an OV or EV certificate from a recognised CA does this, at roughly
$200-400 a year, and an OV certificate still needs to accumulate SmartScreen
reputation before the warning stops. Not currently purchased.

The pipeline is wired for it anyway: set the `WINDOWS_CERT_BASE64` and
`WINDOWS_CERT_PASSWORD` repository secrets and the release build signs. With no
secret set the build runs unchanged and produces unsigned installers, so this
never becomes a reason a release fails.

### Installing your own .appx before submitting it

Windows refuses to install an MSIX/APPX whose signature it cannot chain to a
trusted root, so a self-signed certificate is genuinely required here — you
cannot test your own Store package without one. **Partner Center re-signs the
package on submission**, so Store users never encounter it and never see a
SmartScreen warning.

```powershell
.\tools\make-signing-cert.ps1
```

The certificate subject must equal the appx `publisher` exactly, which is why
the script reads it from `package.json` rather than asking. `.pfx` and `.p12`
are gitignored; never commit key material or a base64 copy of it.

### macOS

Unsigned and un-notarized. macOS Gatekeeper blocks unsigned apps by default, so
mac users must right-click → Open on first launch. Fixing this needs an Apple
Developer account ($99/yr), a Developer ID Application certificate, and
notarization credentials. Not currently configured.

## Microsoft Store

The Partner Center identity is filled in, and verified against a real build:

| Partner Center field | `build.appx` key | Value |
| --- | --- | --- |
| Package/Identity/Name | `identityName` | `ShivamKhetan.NeuronDesktop` |
| Package/Identity/Publisher | `publisher` | `CN=7632F1A5-...` |
| Package/Properties/PublisherDisplayName | `publisherDisplayName` | `Shivam Khetan` |

**None of these are secrets.** They are written into the manifest of every MSIX
that ships, so anyone who installs the app can read all three, and they appear
in the Store listing anyway. The certificate private key is the secret; the
identity is a public name.

Two ways to get the package:

- **From CI.** Tagging a release builds it and attaches it to the workflow run
  as the `neuron-store-appx` artifact. It is deliberately *not* attached to the
  GitHub release: it is unsigned by design, and only Partner Center can do
  anything with it.
- **Locally.** `npm run dist:store` writes it to `release/prod/`.

Then test-install it (see the signing section above), upload it in Partner
Center, and submit.

`package.json`'s `build` block is the single source of truth.
`tools/electron-builder.env.cjs` spreads it and overrides only the test/prod
differences. Both are live -- the release workflow reads `package.json`, the
`dist:*` scripts read the cjs file -- and while they were maintained separately
they drifted: the identity was filled in on one side and still a
`REPLACE.WITH...` placeholder on the other, and the appx built happily with
placeholders in its manifest. If you change packaging, change `package.json`.

The package version must be plain numeric (`0.4.3`), with no prerelease
suffix. This is why the version is `0.4.3` rather than `0.4.3-beta.1`; the
GitHub release can still be marked as a prerelease independently.

## Linux

Direct downloads (AppImage and `.deb`) are attached to every GitHub release by
the existing matrix. No signing is required for either.

**Flathub** is the distribution channel worth adding: it is where Linux users
look for applications, it handles updates and sandboxing, and it is free.

`flatpak/io.github.shiv_khetan.Neuron.metainfo.xml` holds the AppStream
metadata Flathub requires — the listing text, screenshots, release history and
content rating.

Two things are not done and cannot be finished from here:

- **The Flatpak manifest itself.** Building an Electron app in a Flatpak sandbox
  needs an offline npm cache generated by `flatpak-node-generator`, and the
  manifest has to be iterated against `flatpak-builder` on a Linux machine.
  Writing one without that build loop produces a file that looks right and does
  not build.
- **The app id.** Flathub requires an id under a domain you control. For a
  GitHub-hosted project that is `io.github.<username>.<project>`, with hyphens
  in the username written as underscores — `io.github.shiv_khetan.Neuron`. The
  current electron-builder `appId` is `io.github.neuron.notes`, which maps to no
  real GitHub account and would be rejected. The Flatpak id can differ from the
  electron-builder `appId` without changing Windows or macOS behaviour, which is
  the lower-risk option; changing `appId` itself affects the Windows
  AppUserModelID and the upgrade path for existing installs.

Submission, once the manifest builds: fork `flathub/flathub`, add a branch named
for the app id containing the manifest and metainfo, and open a pull request.
Review is manual and typically takes days to weeks.

## Release checklist

- Run `npm ci`, `npm audit`, `npm run build`, and `npm run dist:dir`.
- Run `npm run dist:test`, install **Neuron Test**, and test the demo repository locally.
- Confirm version numbers and release notes.
- Run `npm run release` only when the build is ready to publish as production.
- Push the tag and watch every matrix job.
- Download-test each artifact from GitHub Releases.
- Check the Pages download button.
- Publish checksums or build provenance when the signing pipeline is introduced.
