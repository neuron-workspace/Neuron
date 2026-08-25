const packageJson = require('../package.json');

/**
 * Per-environment electron-builder config.
 *
 * `package.json`'s `build` block is the single source of truth. This file
 * layers the test/prod differences on top of it and overrides nothing else.
 *
 * That matters because both are live: the release workflow runs
 * `npx electron-builder` with no `--config`, which reads `package.json`, while
 * `npm run dist:*` routes through this file. When the two were written out
 * separately they drifted -- the Store identity was filled in on one side and
 * left as REPLACE.WITH placeholders on the other, and the appx built happily
 * with the placeholders in its manifest. Spreading the base makes that class of
 * mistake impossible rather than merely unlikely.
 */
const base = packageJson.build;

/*
 * A note on macOS signing, because the obvious "improvement" here breaks the
 * app and the breakage does not look like signing.
 *
 * `mac.identity` is "-", so the finished bundle is ad-hoc signed. Without it
 * electron-builder signs nothing, Electron's own prebuilt signature survives
 * claiming resources that packaging has replaced, and every download reports
 * "Neuron is damaged and can't be opened".
 *
 * There is no `entitlements` key here, and that is deliberate. electron-builder
 * enables the hardened runtime by default on macOS and supplies its own
 * entitlements to match -- `allow-jit` among them, without which V8 cannot
 * allocate executable memory.
 *
 * An entitlements file REPLACES that default set rather than adding to it.
 * Pointing this config at a file containing only
 * `com.apple.security.cs.disable-library-validation` -- the single key the
 * build warning names -- therefore removed `allow-jit`, and the app died at
 * startup reporting nothing more useful than "Process failed to launch".
 *
 * The build still prints that warning. It is advisory: electron-builder ad-hoc
 * signs the nested frameworks in the same pass as the app, so there is no Team
 * ID mismatch for library validation to reject, and the packaged app is
 * verified and launched on a real macOS runner by tools/smoke-packaged.mjs on
 * every CI run.
 *
 * If the warning is ever acted on, the file has to carry electron-builder's
 * full default set plus that key, not that key alone.
 */

const env = process.env.NEURON_BUILD_ENV === 'test' ? 'test' : 'prod';
const isTest = env === 'test';
const productName = isTest ? 'Neuron Test' : 'Neuron';
const appId = isTest ? `${base.appId}.test` : base.appId;
const version = isTest ? `${packageJson.version}-beta.0` : packageJson.version;
const output = isTest ? 'release/test' : 'release/prod';
const artifactProduct = productName.replace(/\s+/g, '-');

module.exports = {
  ...base,
  appId,
  productName,
  artifactName: `${artifactProduct}-${version}-${'${os}'}-${'${arch}'}.${'${ext}'}`,
  directories: { output },
  extraMetadata: {
    name: isTest ? 'neuron-test' : packageJson.name,
    version,
  },
  win: {
    ...base.win,
    // A test build is never signed; signing it would only produce warnings
    // about a certificate nobody should trust.
    signAndEditExecutable: !isTest,
  },
  nsis: {
    ...base.nsis,
    differentialPackage: !isTest,
    shortcutName: productName,
    uninstallDisplayName: productName,
  },
  appx: {
    ...base.appx,
    // Identity comes from package.json. Only the pieces that must differ
    // between a side-loaded test package and the Store one are touched, so a
    // Partner Center value can never be present on one path and missing on the
    // other.
    applicationId: isTest ? 'NeuronTest' : base.appx.applicationId,
    // NOT productName. Package/Properties/DisplayName must exactly match a name
    // reserved in Partner Center, and the product's own name has no bearing on
    // what that reservation says. Tying the two together is what got the first
    // upload rejected: "uses a display name that you have not reserved".
    displayName: isTest ? `${base.appx.displayName} Test` : base.appx.displayName,
    identityName: isTest ? `${base.appx.identityName}.Test` : base.appx.identityName,
  },
  portable: {
    ...base.portable,
    artifactName: `${artifactProduct}-${version}-${'${os}'}-${'${arch}'}-portable.${'${ext}'}`,
  },
  publish: isTest ? null : base.publish,
};
