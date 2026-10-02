# Margin Notes

A local macOS screen-edge notebook with Markdown, Alfred quick capture, and a built-in MCP server for coding assistants.

## Download

Download the latest [Margin Notes release for Apple Silicon](https://github.com/cxrobx/Margin/releases/latest). Margin requires macOS 13 or newer. Open the disk image and drag **Margin Notes** to Applications, or unzip the app and move it there. No Node.js installation is needed to run the packaged app. The release also includes the optional Alfred 5 quick-capture workflow. The app and disk image are Developer ID signed and notarized by Apple, so they open without a warning. You can also [build from source](#develop-and-verify).

From 0.1.1, Margin Notes updates itself. It checks for a new release shortly after launch and once a day, asks before downloading one, and asks again before restarting. **Check for Updates…** in the menu bar icon's menu or the app menu checks right away. macOS installs an update only if it is signed with the same Developer ID as the running app. Version 0.1.0 has no updater, so install 0.1.1 or later by hand once.

## Use the app

Open **Margin Notes** from Applications. If you build it locally, the packaged app is in `release/mac-arm64/Margin Notes.app`:

```sh
open "release/mac-arm64/Margin Notes.app"
```

Margin runs as a macOS menu-bar utility. Launching it leaves a small tab at the screen edge; it does not open a document window or appear in the Dock or ⌘ Tab app switcher. Click the tab, click the menu bar icon, or press **⌘ ⇧ Space** to reveal the native floating panel. The panel has no titlebar, traffic lights, resize handles, or draggable app toolbar. It stays available across Spaces and full-screen apps.

Use the header’s edge arrow or **Escape** to hide the panel. Right-click the menu bar icon for **Quit Margin** and clipboard capture. You can choose the left or right edge and optional hover activation in Preferences. A tab appears on each connected display while the panel is hidden. Turn off **Preferences → Show screen-edge tab** to hide it; the keyboard shortcut, menu bar icon, and optional edge hover still work.

The whole panel slides in from its configured edge and slides out when dismissed, using a short eased transition. Rapid shortcut presses reverse the current movement. The animation stays within its own display and follows macOS **Reduce Motion**.

Double-click a note’s title, body, or empty card area to edit directly inside that card. The notebook and neighbouring notes stay visible. New notes also start as inline cards. Press **⌘ N** or choose **File → New Note** to start one. The shortcut saves any note you are editing before opening the new card, and also works from Preferences and other app screens. Drag the grip along the bottom edge of a note to make it taller or shorter, in reading or editing mode. Each note remembers its height, including after folding and reopening it. Double-click the grip to restore automatic sizing. With the grip focused, use ↑/↓ to resize or Enter to restore automatic sizing. Single clicks keep the note in reading mode; links, tasks, and attachments keep their own actions. Press Enter on a focused note or use **Edit note** in its menu to edit from the keyboard.

Markdown renders as you type: headings, lists, checklists, quotes, bold, italic, links, and code appear directly in the note. Select text to open a floating formatting toolbar with headings, lists, checklists, quotes, bold, italic, highlight, strikethrough, underline, links, inline code, code blocks, copy, and clear formatting. Hover or focus any toolbar item to see its name and keyboard shortcut. **⌘ B**, **⌘ I**, and **⌘ U** toggle bold, italic, and underline; **⌘ K** adds or edits a link, including at the caret, and **⇧ ⌘ K** removes it. Enter applies a link; Escape dismisses its field and returns to the note. **⌘ E** toggles inline code, **⌥ ⌘ C** toggles a code block, and **⌘ \\** clears formatting. Use **⇧ ⌘ H** for highlight, **⇧ ⌘ S** for strikethrough, **⇧ ⌘ B** for a quote, and **⇧ ⌘ 7/8/9** for numbered lists, bullet lists, and checklists. **⌥ ⌘ 1–6** selects a heading level; **⌥ ⌘ 0** returns to a paragraph. **⌘ Z** undoes typing and formatting; **⇧ ⌘ Z** redoes them. Notes save automatically after a brief pause, with a status in the card footer. Click outside the card, press **Escape** or **⌘ Enter**, or click **Done editing** to finish and flush the final keystrokes. Press Enter in the title to start writing in the body. The card’s **Note settings** menu holds its type, folder, pin, attachments, and colour. Notes stay in Markdown for assistant access; underline and highlight use safe inline `<u>` and `<mark>` tags. Undo history lasts for the current editing session.

The panel includes Markdown notes, interactive tasks, folders, six note colors, pinning and folding, search, code blocks, links, image/file attachments, recoverable Trash, recent activity, light/dark/system themes, and optional screen-edge activation. Drag a note by its header, title, or card edge to reorder it; drop it onto a folder or subfolder tab to move it there. The destination folder lights up, and a subfolder row’s All tab moves the note into that parent folder. Drag folder tabs (including All) to rearrange them. A line marks the insertion point, and both orders are saved locally. Editing a note keeps its manual position; pinning still brings it to the top. With a card or tab focused, Option + arrow keys also reorder it (up/down for notes, left/right for tabs). Drag files onto an existing note to attach them. Attachments are copied locally, up to 25 MB each.

Folders nest up to three levels. Choose **New folder inside…** from **Notebook options**, or the **+** at the end of a sub-tab row; **Rename or move folder…** changes where a folder sits. Selecting a folder shows its own notes and every folder inside it, with a row of sub-tabs (**All** plus each child) for each level. Each parent remembers the sub-tab you chose last, **All** or a child, so clicking it returns you there. Removing a subfolder moves its notes and folders up into its parent; removing a top-level folder moves its notes to the Inbox.

Right-click free space among the notes and choose **Add section here** to place a divider at that spot. Name it, or leave it as a plain line; double-click or right-click a section to rename or remove it, and drag it (or focus it and press Option ↑/↓) like a note. A section belongs to the view it was added in and steps aside during search, Pinned, and Trash.

Choose **Icon & color…** from a note’s menu or the section’s **Notebook options** menu, or right-click a folder tab. The note editor also has an **Icon & color** button. Like CXTasks, the compact picker saves each choice immediately: built-in glyphs, an imported PNG/JPEG, a separate icon color, and **Reset to default**. Image icons keep their own colors; imports are trimmed and stored locally as 64-pixel PNGs, with an optional background-free variant. Folder tabs and headings share their appearance; All, Pinned, and Trash can each have their own icon too. Note types and card colors stay independent. Icons survive reopening and stay separate in demo mode.

Copy a picture or screenshot, edit a note, and press **⌘ V** in its body to paste the image at the caret. This also works in a blank new note. Pasted images save locally as PNG attachments, up to 25 MB each, and stay in place when you reopen, undo/redo, back up, or export the note as Markdown.

## Linking documents and tasks

Paste a local Markdown, text, HTML, or PDF path into a note to make it clickable in the reading view. Paths on their own line can contain spaces; quote paths that appear within a sentence. `file://` links and local Onyx reader URLs work too. Clicking opens Onyx when installed, with Obsidian as the fallback. Right-click a document link to choose **Open in Onyx**, **Open in Obsidian**, copy its path, or reveal it in Finder. Obsidian opens documents inside one of its registered vaults; its copied `obsidian://open` links also work directly.

CXTasks links are off by default. Margin checks whether CXTasks is installed before showing **Preferences → Integrations → Enable CXTasks links**. After you opt in, an uppercase `T` followed by a task number, such as `T42`, opens the matching task in CXTasks. Plain numbers, `task 42`, `#42`, lowercase `t42`, and references within code stay plain text. Existing `cxtasks://task/T42` links work. The formatting toolbar's link field accepts document paths and `T42` task references as well as web links.

References point to the original document or task. They are recognized when rendering, so Margin does not copy the file or rewrite the stored note. Missing files and uninstalled apps show a useful error.

## Demo mode and an empty notebook

New notebooks start empty. In **Preferences → Demo & reset**, **Start demo mode** opens six sample notes covering notes, checklists, links, code, pinning, and folders. Your regular notes, Trash, activity, attachments, ordering, and unfinished draft stay separate. A **Demo** badge and **Exit demo** banner identify the demo notebook. Demo mode survives app restarts; exiting discards demo changes and restores your regular notebook. Each activation starts a fresh demo. Assistants connected over MCP use the active notebook, and `list_notes` and `list_folders` report `demoMode`.

**Reset to default** clears all notes, including Trash, and activity, and restores the default Inbox, Work, and Personal folders. It keeps your theme, saved themes, MCP connection, and app preferences. It saves a backup first and rejects the reset if the notebook changes after the confirmation opens. Exit demo mode before resetting your regular notebook. Reset also gives the notebook a new identity so old unfinished drafts do not reappear. Attachment files stay locally available to older backups.

## Themes

Open **Preferences → Themes**. **Default** preserves Margin’s original cream-and-sage design, with **Light**, **Dark**, and **System** modes. System follows your Mac’s appearance.

**Glass** matches CXTasks’ built-in palette in Light, Dark, and System modes: independently translucent chrome and content, soft frosted cards, blue controls, and coloured folder icons and section headings. Note colours fill the entire card with a readable background colour, including on hover; the colour picker previews the same fill. The Glass transparency slider saves its position; zero is fully opaque. Margin follows macOS **Reduce Transparency** without changing your saved preference. Default remains available.

On macOS the optional Node-API bridge uses the same dynamically resolved desktop blur as CXTasks, with native vibrancy as a fallback if the blur is unavailable. Desktop blur stays active throughout the slide and follows the moving panel, so the glass background does not change on arrival. The vibrancy fallback and native shadow return when the panel arrives. Building the bridge requires Xcode Command Line Tools and Node headers (`MARGIN_NODE_HEADERS` can specify their directory); packaged apps include the bridge.

**Match vault** uses the same measured Obsidian palette as Onyx and CXTasks, including the vault’s interface font. It also reads Onyx’s measured heading and folder colours: titles and labels stay neutral. Folder icons, Markdown headings, links, and folder dots wear the vault colours exactly as Obsidian renders them, in light and dark mode alike; dark mode also fills note colour swatches, and note cards get gentle tints. Saved copies preserve those colours offline. Missing older snapshots get colourful defaults; community-theme CSS is never injected. Run Onyx and Obsidian with the Onyx plugin enabled and Onyx’s **Match vault appearance** setting on. Margin reads Onyx’s local `/api/vault-look` endpoint (default `http://127.0.0.1:8899`); **Onyx connection** lets you change the local address. It refreshes on focus and once a minute while matching the vault or viewing Themes. The vault controls its own light/dark mode. Only validated palette values are applied; community-theme CSS is not loaded into Margin.

**Save a copy** gives the captured vault appearance a name in Saved themes. Copies stay independent of live vault changes and work with Onyx closed. Margin retains the last vault palette for offline use as well. Light and dark vault palettes are captured as they are seen; **Update from vault** can add the other mode to an existing copy. If a copy has no palette for the chosen mode, Margin uses Default for that mode and explains this in Themes. Default is always available and cannot be removed. Vault appearances use an opaque background to preserve their measured text contrast.

## Alfred 5 quick capture

Install `integrations/alfred/Margin Quick Capture.alfredworkflow` in Alfred 5. The workflow adds:

- **`n your text`**: save that text to Inbox.
- **`n`**: save the current text clipboard to Inbox.
- **Save to Margin** in Universal Text Actions: save selected text or a URL to Inbox.

Captures preserve multiline text and Markdown, show a brief confirmation, and work while Margin is closed. They use the packaged app’s bundled runtime and the same local notebook and locking as the app and MCP server. No separate Node installation is needed. An optional **Margin app path** workflow setting locates a copy outside Applications or the project’s release folder. During demo mode, captures go to the temporary demo notebook and the confirmation identifies it. Build the distributable workflow with `npm run alfred`.

## Connect Codex or Claude

Open **Preferences → Assistants** under Integrations. The connection screen generates the correct paths for this running copy of Margin and its notebook. Its back button or Escape returns to Preferences.

- **Codex:** Copy and run the generated `codex mcp add` command, then start a fresh conversation.
- **Claude Code:** Copy and run the generated `claude mcp add` command, then restart Claude Code.
- **Claude Desktop:** Merge the generated `margin` entry into the `mcpServers` object in `~/Library/Application Support/Claude/claude_desktop_config.json`, then restart Claude Desktop. Preserve other server entries.

The packaged app uses its bundled Electron executable as the Node runtime with `ELECTRON_RUN_AS_NODE=1`, so connecting the installed app does not require a separate Node installation. Connect **after moving the app to its permanent location**; moving it later requires updating the generated paths. The server runs independently of the panel, so assistants can write notes while Margin is closed.

Try:

> Add a note to Margin titled “Project decisions” with the key decisions from this conversation. Set the source to Codex.

> Add a checklist of the next steps to my Project decisions note in Margin.

> Create a Work folder in Margin, and save this useful code snippet there.

Connection references: [official Codex MCP documentation](https://developers.openai.com/codex/mcp), [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp), and the [MCP SDK server guide](https://ts.sdk.modelcontextprotocol.io/server).

## MCP tools

| Tool | Purpose |
| --- | --- |
| `list_folders` / `create_folder` | Find or create folders, including folders inside folders (`parentId`) |
| `list_notes` | Search content, with folder, pinned, Trash, and pagination filters |
| `read_note` | Get the full body, attachments, and current revision |
| `duplicate_note` / `note_link` | Copy a note or get its app link |
| `note_history` / `read_note_version` / `restore_note_version` | Preview and recover saved writing |
| `create_note` | Save Markdown, color, folder, type, and source attribution |
| `update_note` | Change supplied fields, with optional revision checks |
| `append_note` | Append without losing concurrent changes |
| `add_input` | Add text, tasks, links, or fenced code |
| `toggle_task` | Complete/reopen a task with a revision check |
| `attach_file` | Copy a local file or image into the notebook |
| `trash_note` / `restore_note` | Remove and restore notes |

Resources expose `margin://folders` and `margin://notes/{id}`. Communication uses standard **stdio MCP**; no public listener, login, cloud account, or API key is needed. The MCP client's own approval settings govern assistant access. A connected assistant can read this notebook and write to it.

## Data and backups

The packaged app stores data in `~/Library/Application Support/Margin Notes/`. Development mode uses `.margin-data/` in this repository. Set `MARGIN_DATA_DIR` to an absolute path to override either. Use the same path for the app and MCP clients. The app's connection screen does this automatically; a bare `npm run mcp` uses the standard user data directory unless the environment variable is set.

- `notes.json`: notes, folders, preferences, saved vault themes, cached vault appearance, and activity.
- `attachments/`: local copies of attached files.
- `backups/`: the last 40 versions of `notes.json`, saved before each change.

Writes are serialized across processes and saved using an atomic replacement. Automatic editor saves and task updates use revisions to detect concurrent edits. Conflicting drafts stay available; reload the latest note or save the draft as a new note. Unsaved writing is retained in the app's local draft storage across restarts.

**Export notes and attachments** in Preferences produces a portable JSON backup with embedded attachments. **Backups & import** lets you preview an exported backup or one of the last 40 automatic snapshots. Add its notes as separate copies, combining folders with the same name, or explicitly confirm restoring the entire notebook. Restore preserves your appearance and preferences, saves a rollback backup, and rejects a preview if your notebook has changed. Automatic snapshots use attachment files already in your data folder; exported archives carry their own files. Demo snapshots cannot replace your regular notebook.

Choose **Note history…** from a note’s menu to preview and restore an earlier version. Margin keeps up to 100 earlier content versions per note, separately for each notebook, and also finds versions in older automatic backups. User and assistant edits both appear. Restoring keeps the current content in history and restores the selected version’s attachments. A concurrent edit blocks the restore until you reload the history.

**Duplicate note** creates an independent copy with the same formatting, colour, and attachments. **Copy link to note** gives you a `margin://note/…` URL that opens and focuses the card from another app, including notes in Trash. Links also work inside Margin Markdown. The packaged app registers the URL scheme.

Search defaults to **All notes** while a query is entered. Use the scope buttons to search just the selected folder or section; Trash search stays in Trash. Matches are highlighted in titles, formatted text, and code. **Jump to next match** scrolls to each highlighted occurrence, including inside a folded or resized note. Clearing search restores normal folder filtering and folding.

Import Markdown or text files from Preferences, a folder’s options menu, or by dropping files onto the notebook background. A file’s leading level-one heading becomes its title; the remaining Markdown is preserved. Importing a folder recreates its top-level folders. Export a note, folder, or the whole notebook as ordinary `.md` files with copied attachments. Margin exports include a small folder manifest and an `attachments/` directory; importing an export brings those local attachments back as well. Dropping files onto an existing card still attaches them.

This version provides local storage. iCloud sync, mobile apps, and a system-wide Share extension are outside this implementation.

## Develop and verify

Requires Node.js 22+ and macOS (the packaged build targets this Mac's Apple Silicon architecture).

```sh
npm install
npm run dev
npm test
npm run build
npm run package
```

The application icon uses the approved cream-and-sage paper design. `assets/icon.png` is the transparent 1024-pixel master; `assets/icon.icns` is used by macOS packaging and the Alfred workflow. Run `npm run icon` to regenerate the macOS icon sizes from the master, then `npm run alfred` to refresh the workflow icon.

`npm start` runs the production renderer in the desktop shell. `npm run connections` prints development connection commands that use this repository's `.margin-data` notebook. `npm run mcp` starts the stdio server directly. Avoid writing diagnostic text to its stdout, which is reserved for MCP messages.

The tests exercise actual stdio MCP requests, multiprocess writes, task handling, revision conflicts, Trash, search, persistence, backups, and attachments. A desktop smoke test additionally runs the real renderer and bundled runtime:

```sh
MARGIN_SMOKE_TEST=1 MARGIN_DATA_DIR=/private/tmp/margin-electron-smoke node_modules/.bin/electron .
```

Add `MARGIN_FOLDERS_SMOKE_TEST=1` to drive nested folders, remembered sub-tabs, and sections instead (`MARGIN_FEATURE_SMOKE_TEST=1` and `MARGIN_LINK_SMOKE_TEST=1` select the other suites). `MARGIN_IMAGE_SMOKE_TEST=1` checks native clipboard image paste, inline placement, undo/redo, and reopening.

Use a fresh directory for each smoke run. Screenshots are written to `artifacts/`. Development profiles, local notes, output bundles, and dependencies are ignored by Git.

To release, bump `version` in `package.json`, commit, and run `npm run release -- X.Y.Z` from a clean tree. It builds the disk image and zip, signs, notarizes and staples both, writes `latest-mac.yml`, verifies the result, and prints the `gh release create` commands; it publishes only with `--publish`. After a release, `npm run verify:update-feed` checks the live update feed the way an installed copy reads it.

## License

Copyright © 2026 CX Ventures LLC. Margin Notes uses the [Business Source License 1.1](LICENSE), matching Onyx and the other CX Ventures apps. Personal use and internal use within your own organisation are permitted. Selling the app, offering it as a hosted or managed service, or including it in a product or service you sell requires a commercial licence from CX Ventures LLC.

The Change Date is **September 30, 2030**, and the Change License is **Apache License 2.0**. This is source-available software; the Business Source License is not an open-source licence. See [LICENSE](LICENSE) for the full terms and [cxventures.io](https://cxventures.io) for commercial licensing.
