---
'hushpod': patch
---

Adopt Changesets for versioning and releases. Version bumps, `CHANGELOG.md`, git
tags, and GitHub Releases are now generated from changesets by the Release
workflow instead of hand-made release commits and manually pushed tags. No npm
publishing (the package stays private); the `v*` tag still triggers the Docker
image publish.
