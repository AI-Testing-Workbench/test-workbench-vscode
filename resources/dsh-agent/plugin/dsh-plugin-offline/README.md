# dsh-plugin-offline

Move an installed DSH plugin (and everything it needs) to a machine that has **no
registry access**, as one tarball.

- **Export** packs one plugin bundle from the current profile *plus its whole dependency
  closure* into a single `.tgz` — a valid npm tarball whose `bundleDependencies` make
  `pnpm` install it without fetching anything.
- **Import** installs that tarball into the current profile through the profile's own
  plugin manager, so the dependency, the bundle selection, the lockfile and the live
  composition behave exactly like a normal `plugin_manager` install — offline.
- `list` shows the profile's exportable bundles; `inspect` reads an artifact (target DSH
  version, platform, bundled packages, inserted rows) without installing it; `verify` audits an
  artifact's dependency completeness.
- **Web UI**: the built-in Plugins page gains an **Import & Export** tab that lists installed
  plugins with one export button per row (the folder is picked for each export) and an
  offline-import entry (pick a `.tgz`, confirm, upload); every installed plugin's detail page
  gets an **Export offline** button next to its enable switch and uninstall action.

The tool is a Host plugin for DSH: one bundle row, no browser UI, no runtime npm
dependencies. It drives the existing mechanisms (`ctx.pluginManager`, pnpm
`bundleDependencies`, the standard tarball install path) — see
[`docs/DESIGN.md`](docs/DESIGN.md) for the verified mechanics.

## Install

From this checkout (a profile-wide change; needs danger-full-access or approval):

```
plugin_manager { action: "install_bundle", target: "/absolute/path/to/dsh-plugin-offline" }
```

or from a terminal:

```
dsh plugin --profile <name> add /absolute/path/to/dsh-plugin-offline
```

After installation the profile lists a **Offline Plugin Transfer** bundle and the agent
gains the `plugin_offline` tool.

## Use

### Export on the connected machine

```
plugin_offline { action: "list" }
plugin_offline { action: "export", plugin: "dshmarket" }
plugin_offline { action: "export", plugin: "dshmarket", output: "/tmp/transfer" }
```

- `plugin` is the exact bundle name shown by `list` (a disabled-but-installed bundle is
  exportable too).
- `output` is an absolute `.tgz` path or a directory; the default is
  `<DSH_HOME>/offline-artifacts/<name>-<version>-offline.tgz`.
- The result lists the artifact path, size, target DSH runtime, bundled packages and
  warnings (for example: optional dependencies for other platforms that were skipped,
  or a dependency that could not be resolved and was therefore not bundled).

Copy the artifact to the isolated machine with whatever medium you have (USB stick,
internal file share, ticket attachment). Keeping the artifact is part of installing it:
the profile records the artifact path as the dependency's source.

### Export from the Web UI

Open **Plugins** in the sidebar:

- **Import & Export** tab: the profile's exportable plugins, each with an
  **Export offline** button, plus a refresh button.
  - **Export folder is chosen per export**: clicking **Export offline** opens the Host's native
    directory picker first; confirm a folder and the artifact is written there (the picker is
    the only destination control — cancelling it aborts that export). When the Host offers no
    folder picker, the export falls back to `<DSH_HOME>/offline-artifacts` and says so in the
    result line.
  - **Import an offline plugin**: **Choose .tgz file** → the picked file is shown with its
    size → **Import into this profile** uploads it with a progress readout and installs it,
    then offers **View plugin details**. Only `dsh-plugin-offline` artifacts are accepted; the
    file is first copied to `<DSH_HOME>/offline-artifacts/imports/` because the profile
    records that path as the dependency source (1 GB upload limit).

**Why an import never needs the registry (and what changed for intranet profiles).**
pnpm's `autoInstallPeers` is on by default outside this Desktop profile, so installing a
plugin tarball used to make pnpm fetch every declared peer as a direct dependency of the
profile — on an isolated Artifactory that failed with `ERR_PNPM_FETCH_404 ... @deepseek-ai/cordis`.
Artifacts now mark every peer dependency `optional` in the staged manifest: the peers stay
declared (DSH still checks `@deepseek-ai/dsh-*` ranges at load, and every peer that resolved on
the source machine is already bundled), but pnpm no longer installs or fetches them. If pnpm
still cannot reach a registry for another reason (for example the profile's own dependencies
need resolution), `import` falls back to installing the artifact **without pnpm**: the bundled
tree is materialized into `node_modules/<name>`, the profile manifest records the dependency
and selects the bundle, and the result notes that the lockfile was not updated (restart DSH if
the plugin does not appear). Compatibility refusals are never bypassed. Artifacts exported
before this fix may still make pnpm try the old peer fetch once; the fallback then completes
the install, or re-export on the connected machine for a clean artifact.
- **Any installed plugin's detail page**: **Export offline** beside the enable switch and
  uninstall action; it asks for the folder the same way.

Both export entry points run the same pipeline as the agent tool. The export route validates
the picked folder (absolute path, must already exist and be a directory) before writing there.
The UI import is the human's own action from the Plugins page — the same authority the
shipped plugin manager page uses for its install button — so it installs directly through
the profile manager; agent-initiated imports remain on the approval-gated `plugin_offline`
tool. The client half is discovered when the Host starts; a fresh install appears after the
normal live reload, while adding it to an already-running Host (upgrade) needs one DSH
restart before the tab and button show up.

### Import on the isolated machine

```
plugin_offline { action: "inspect", artifact: "/media/usb/dshmarket-1.66.45-offline.tgz" }
plugin_offline { action: "verify",  artifact: "/media/usb/dshmarket-1.66.45-offline.tgz" }
plugin_offline { action: "import",  artifact: "/media/usb/dshmarket-1.66.45-offline.tgz" }
```

`inspect` warns when the artifact was built for another DSH version or another
platform/CPU. `import` then:

1. validates the artifact (offline manifest, package name/version, bundle patch),
2. calls the profile plugin manager's `installBundle` with the tarball — the same code
   path as a normal install, including the DSH peer compatibility check, the profile
   manifest/lockfile update and the bundle selection,
3. reports the manager's `ChangeResult` (`application: "applied"` means the row is live
   in a live profile).

`import` changes the profile, so it asks for approval unless the session already runs
with danger-full-access.

If you only want DSH's built-in tarball path without this plugin, an artifact is a plain
npm package tarball: `plugin_manager { action: "install_bundle", target: "<artifact>.tgz" }`
also works — this plugin exists for producing that artifact and for the offline
validation/guidance around it.

## Artifact format

```
package/
  package.json            # the plugin manifest + bundleDependencies
  dsh-offline.json        # offline manifest (target DSH version, platform, packages…)
  node_modules/<dep>/…    # the whole closure, flat, with nested copies on version conflicts
  …                       # every other file of the installed plugin package
```

- `package.json` gains `bundleDependencies` for everything physically under
  `package/node_modules` (version conflicts are nested under the package that needs them,
  whose own manifest declares the nested bundle). Declared dependencies that could not be
  resolved are removed from the staged manifest and reported instead of being left for
  pnpm to fetch.
- Packages supplied by the DSH installation (`@deepseek-ai/*`) are **not** bundled: the
  target DSH runtime serves them at import time. The manifest lists them under
  `runtimeProvided`.
- `dsh-offline.json` (`schemaVersion: 1`) records the source profile, the DSH runtime
  version, `platform`/`arch`/`node`, the bundle patch and inserted rows, every bundled
  package with its version/placement/size, and warnings.
- Install-time lifecycle scripts (`preinstall`, `install`, `postinstall`) are removed from
  the artifact manifest and reported: pnpm 11 refuses a dependency whose build scripts it
  may not run, the artifact already carries prebuilt files, and those scripts cannot work
  offline. A plugin with `binding.gyp` (a native build) is reported as a warning because a
  build may be required on import.

Because pnpm extracts the declared bundled tree *nested inside the installed package*,
Node's resolution — and DSH's own runtime resolution — find those exact copies even when
the profile root already has a different version. Native addons are copied prebuilt, no
build scripts run during import.

### Is everything bundled?

Export walks the installed plugin's dependency graph recursively — `dependencies`,
`optionalDependencies`, and every `peerDependencies` entry that resolves in the source
profile — and copies each package's files, including nested copies created for version
conflicts (`node_modules/<a>/node_modules/<b>`). On top of the package it copies, the
artifact's manifest declares exactly what is physically present through
`bundleDependencies` (pnpm only installs what that field names).

Deliberately *not* bundled, with the reason recorded in `dsh-offline.json`:

| Not bundled | Why it still works on the isolated machine |
|---|---|
| `@deepseek-ai/*` packages | supplied by that machine's own DSH installation at load time (listed under `runtimeProvided`) |
| optional dependencies that were not installed on the source machine (e.g. other-platform native binaries) | they were not needed there either; listed under `notBundled` |
| peers that did not resolve on the source machine | recorded as optional peers; the target runtime or another bundle provides them |
| install-time lifecycle scripts (`preinstall`/`install`/`postinstall`) | prebuilt files are already in the artifact; pnpm must not run builds offline |
| a plugin with `binding.gyp` (needs a native build at install time) | reported as a warning — such a plugin may need another distribution method |

Export runs this audit on the staged tree before packing and reports `complete: true` plus
any `auditErrors`/`auditWarnings`. Any artifact can be re-audited later, offline:

```
plugin_offline { action: "verify", artifact: "/path/to/x-offline.tgz" }
```

`verify` extracts the tarball to a temp directory and checks, from the plugin outward, that
every declared dependency resolves **inside the artifact** (nested copies included) or is a
runtime-provided `@deepseek-ai/*` package; that each `bundleDependencies` claim has files and
that every physical nested bundle is claimed; that the bundle patch file and the
`dsh-offline.json` marker agree with `package.json`. Real examples from this repo:

- `dshmarket` artifact: `complete: true`, 4 packages (plugin + `js-yaml`, `undici`, `argparse`),
  440 files / 7.7 MB unpacked, 3 runtime-provided peers.
- `dsh-univer-office` artifact: `complete: true`, 35 packages, 2,781 files / 334 MB unpacked,
  9 runtime-provided peers, 16 other-platform optional binaries listed as absent (expected).

## Limits worth knowing

- **Platform-specific.** Native modules and prebuilt binaries are copied for the
  exporting host's `platform`/`arch` (recorded in the artifact, warned about on import).
  Build the artifact on the same OS/CPU family as the isolated machine.
- **DSH runtime version.** The artifact records the exporting runtime. The target profile
  manager still enforces the plugin's declared `@deepseek-ai/dsh-*` peer ranges; use the
  same DSH major, and grant a version exemption only if you accept the risk.
- **Keep the artifact.** The profile's dependency spec points at the artifact file
  (`file:/…/x.tgz`); deleting or moving it breaks later `pnpm install` runs.
- **Workspace-linked plugins.** A plugin installed with `link:` resolves its own
  dependencies from its real location. Export bundles what resolves from that location;
  anything only present in the profile root cannot be captured.
- **Trust.** An artifact contains executable code. Only import artifacts you built or can
  verify; an import installs Host code outside the workspace sandbox.
- **Build scripts are not re-run.** Install-time lifecycle scripts are stripped from the
  artifact; a plugin that truly needs a build step at install time (for example a native
  `binding.gyp`) is reported as a warning and may need another distribution method.
- Artifacts of large plugins are large (the bundled DSH×Univer integration is ~75 MB).

## Verification performed

- Unit tests: `node --test test/*.test.mjs` — 50 passing (tar engine, closure/staging,
  export→inspect→import pipeline with a synthetic profile, browser endpoint routes including
  chosen-folder export and uploaded-artifact import/refusals, plus a no-browser render smoke
  test that applies the Client half and walks both Plugins-page seats, artifact peers marked
  optional, the pnpm-free import fallback, and the completeness audit (clean artifact,
  missing dependency, phantom bundle declaration, marker mismatch, optional absence)).
- Offline integration: an artifact installed with
  `pnpm add --offline --store-dir <empty> --registry http://127.0.0.1:1/ <artifact>` in a
  fresh hoisted project, then loaded and resolved its bundled dependencies
  (`test/integration/offline-install.test.mjs`). A second integration test reproduces the
  intranet peer case: a plugin declaring `@deepseek-ai/cordis` as a peer installs with pnpm's
  default `autoInstallPeers` behavior, an empty store and no registry, and no
  `node_modules/@deepseek-ai` appears (`test/integration/peer-optional.test.mjs`).
- Completeness audit: `plugin_offline verify` reported `complete: true` for both the
  `dshmarket` and `dsh-univer-office` artifacts (numbers above); broken hand-made artifacts are
  rejected with `missing-dependency` / `declared-bundle-missing` / `marker-mismatch` errors.
- End-to-end on a live DSH Desktop profile: installed `examples/fixture-plugin` (a Host
  tool that imports `semver`), exported it, removed it, then imported the artifact with
  `plugin_offline`; the bundle row remounted live and `semver` resolved only from the
  artifact's nested `node_modules`. `dshmarket` and `dsh-univer-office` artifacts were also
  produced and offline-installed; the heavier one bundles 34 packages including native
  bindings and version-conflict nesting.
- Web UI: with the Client half loaded, `Slots.listSubTree` reported the plugin's live
  occupants in the shipped plugin-manager slots (`plugins.tab` → `dsh-offline-export-tab`,
  `plugins.detail.actions` → `dsh-offline-export`). The same routes the page calls answered on
  the live web server: bundle listing; `POST .../export` into a chosen folder
  (`/tmp/dsh-offline-picked/dsh-plugin-offline-0.1.0-offline.tgz`, 75 KB) and with a relative
  folder refused as `invalid-output`; `POST .../import` of a synthetic artifact installed it
  live (`application: "applied"`, bundle row mounted, its tool registered), while a corrupt
  upload was refused with 400 `invalid-artifact` and a plain npm tarball with 400
  `not-offline-artifact`.
- No registry traffic is needed after export: verified with an empty pnpm store.

## Development

```
node --test test/*.test.mjs            # unit tests (no network)
node --test test/integration/*.test.mjs  # pnpm offline installs (needs pnpm, no network)
```

Layout: `index.js` (bundle entry), `src/tool.mjs` (tool schema/approval), `src/http.mjs`
(browser endpoints behind the Plugins page buttons), `client.js` (the browser half: the
Import & Export tab with per-export folder picking and the import entry, plus the
detail-page export button),
`src/export.mjs`, `src/import.mjs`, `src/verify.mjs` (artifact completeness audit),
`src/profile.mjs` (profile discovery, manager access), `src/closure.mjs` (dependency
closure + bundled staging), `src/tar.mjs` (streaming gzip+tar), `examples/fixture-plugin`
(the self-test bundle used for the live end-to-end run).

## License

MIT
