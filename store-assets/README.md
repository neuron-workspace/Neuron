# Microsoft Store assets

**The images are not in the repository.** They are generated output, about
5.7 MB of it, uploaded to Partner Center by hand and never read by the build --
so they are gitignored and this README is all that is tracked. Run either script
below and the files appear beside it.

Generated, not drawn by hand. Regenerate either set at any time:

```bash
npm run build && npm run store:shots   # screenshots, from the running app
npm run store:logos                    # logo set, from the app icon
```

Both scripts verify their own output dimensions and fail rather than write a
file the Store would reject.

## Where each file goes in Partner Center

### Store listings → Screenshots (at least one required)

All four are 1600×1000, clearing the 1366×768 recommendation. Suggested
captions:

| File | Caption |
| --- | --- |
| `screenshots/01-notes-and-dashboards.png` | Notes are plain Markdown, with layout components and live tables |
| `screenshots/02-canvas.png` | Spatial boards in the open JSON Canvas format |
| `screenshots/03-database.png` | Typed databases stored as readable JSON |
| `screenshots/04-custom-views.png` | Custom HTML views, sandboxed and limited to the paths they declare |

### Store listings → Store logos

| Field | File |
| --- | --- |
| 9:16 Poster art, 720 × 1080 | `logos/poster-720x1080.png` |
| 9:16 Poster art, 1440 × 2160 | `logos/poster-1440x2160.png` |
| 1:1 Box art, 1080 × 1080 | `logos/box-1080x1080.png` |
| 1:1 Box art, 2160 × 2160 | `logos/box-2160x2160.png` |

Poster art is the one Microsoft calls highly recommended: it becomes the main
logo on Windows 10/11. Upload at least `poster-1440x2160.png` and
`box-1080x1080.png`.

### Store listings → Store display images

| Field | File |
| --- | --- |
| 1:1 App tile icon, 300 × 300 | `logos/tile-300x300.png` |
| 1:1, 150 × 150 | `logos/tile-150x150.png` |

These override the logos inside the package. They carry no wordmark — at 150px
the name is unreadable, and the Store prints it beside the tile anyway.

## Notes

The screenshots are real captures of the real application against the demo
workspace that ships with it, so they cannot promise a UI that does not exist.
The capture refuses to write a file if a local filesystem path is visible
anywhere on screen; the workspace terminal prints one, and that is the
capturing machine's username on a public listing.
