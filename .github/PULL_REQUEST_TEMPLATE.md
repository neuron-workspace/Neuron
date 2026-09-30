<!--
  Is this pull request targeting `dev`? GitHub offers `main` by default.
  Change the base branch to `dev` before submitting.
-->

## Summary

<!-- What problem does this pull request solve, and why is this change shaped this way? -->

## User-visible behavior

<!-- Describe every behavior or interface change a Neuron user will notice. Write "None" if there is no user-visible change. -->

## Testing

<!--
  Tick only what you ran yourself, on your own machine, and saw pass.
  "CI will run it" does not count: if you could not run a check, say which one and why, and open this pull request as a draft.
  For a new or changed test, confirm you saw it fail without your change.
-->

Operating system:

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e` (needs a desktop session; on headless Linux use `xvfb-run --auto-servernum npm run test:e2e`). Playwright summary line:
- [ ] New or changed tests fail without this change, or no tests changed.

<!-- The desktop scenarios you exercised by hand: -->

## Screenshots

<!--
  Required for any change a user can see: before and after, same window size.
  Add light and dark theme shots when colour, contrast, borders or icons change, and a GIF or video for interactions.
  Use the demo workspace, never your own notes. Write "No visible change" otherwise.
-->

| Before | After |
| --- | --- |
|  |  |

## Change checklist

- [ ] The change is focused and follows [CONTRIBUTING.md](CONTRIBUTING.md).
- [ ] I tested affected desktop interactions on the relevant operating system, or explained why this is not applicable.
- [ ] I included before and after screenshots for visible interface changes, or this is not applicable.
- [ ] I preserved the context-isolated preload bridge and did not enable `nodeIntegration`.
- [ ] I documented any new or changed plugin capability or network behavior, or this is not applicable.
- [ ] I added or updated tests where behavior changed, or explained why no test is needed.
- [ ] I did not include personal notes, workspace paths, credentials, API keys, or other sensitive data.
- [ ] This pull request targets `dev`, not `main`.

## AI assistance

<!-- If an AI tool materially wrote, rewrote, or reviewed part of this change, name the tool and the part. Write "None" otherwise. See the AI-assisted contributions section of CONTRIBUTING.md. -->

None

## Data and compatibility risk

<!-- Could this affect files on disk, migrations, autosave, recovery, workspace compatibility, or existing user settings? If yes, explain the safeguards and rollback path. -->

## Related issue

<!-- For example: Closes #123 -->
