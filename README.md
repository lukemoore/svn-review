# Local Code Review

Review local Git or SVN changes in your browser. Send questions or change
requests to **Codex, Claude Code, Pi, or another coding agent** in a new or
existing session with access to your local files. Replies return to the
original comment threads through a JSON file. No API keys or model calls are used.

## Install with your coding agent

Paste this into Claude Code, Codex, or another agent that can run local commands:

```text
Install and run Local Code Review from
https://github.com/lukemoore/local-code-review.
Clone it into a local-code-review folder, or use an existing checkout if
one is already present. Read its README, check that Python 3.10+ and Git
are available (and SVN if I want to review SVN changes), then run
python3 start.py from the checkout (py start.py on Windows).
Keep the server running. The launcher opens my browser automatically.
If that fails, give me the local URL to open manually.
```

The launcher creates a virtual environment and installs the app's dependencies.
To set it up yourself, follow the steps below.

## Start

Requires Python 3.10 or later and the `git` or `svn` command for your working copy.

Clone the project and start it:

```sh
git clone https://github.com/lukemoore/local-code-review.git
cd local-code-review
python3 start.py
```

The launcher sets up the Python environment, installs dependencies, updates
your local database, and opens <http://127.0.0.1:8765> in your default browser.
The first run needs internet access to install dependencies. Later starts only
install dependencies when `requirements.txt` changes.

Keep the terminal open while using the app. Press **Ctrl+C** to stop it.
Next time, run `python3 start.py` again. You can also run the script by its full
path from any directory. On Windows, use `py start.py` instead.
If the browser does not open, open the URL shown in the terminal.

The server listens only on your own computer. This is a
single-user local tool with access to your local working copies, without login
or remote access support.

The launcher runs `migrate` to create an empty `var/reviews.sqlite3` on first
setup. On later runs, it applies database updates and keeps existing reviews.
No example reviews or personal data are included in the repository.

## Update and keep your data

Stop the server and back up the whole `var/` directory outside this checkout.
Then run:

```sh
git pull --ff-only
python3 start.py
```

Git ignores `var/`, so normal pulls do not replace your database or handoffs.
Keep your backup: deleting the checkout or running `git clean -x` can delete
ignored files. To restore, stop the server and copy your saved `var/` directory
back into the checkout.

## Credentials and private files

The app needs no API keys. It generates a temporary Django signing key each
time it starts. There are no login sessions or persistent signed values.
SVN uses your computer's existing SVN configuration and credentials.

`.gitignore` excludes local data, virtual environments, `.env` files, and common
key files. Before publishing changes, inspect `git diff --cached` and
`git status --short`. Ignore rules cannot detect secrets pasted into source
files. Never force-add private files.

## Review and respond

1. Select **New review** at the top or **＋ New review…** in the review
   menu, then **Browse…** to choose a local folder in the
   folder browser. You can also enter a Git or SVN working-copy directory.
   Use a subdirectory to limit the review. The app detects the repository
   type and saves your changes for review. Git captures staged and unstaged
   tracked changes together against HEAD (or an empty tree before the first
   commit). SVN uses
   `svn diff --internal-diff`.
2. Select code text on the new side, then click **Add comment** beside the
   selection. The comment box stays visible at the bottom of the screen.
   Alternatively, select a line number and Shift-click a second line number to
   select a range within the same hunk. Write a question or change request and
   select **Save comment**. Use **Add general comment** for deleted files,
   properties, binary files, or broader questions.
   A new comment shows **Edit** instead of a reply box. Use **Save changes**
   or **Cancel** after editing. Once a thread has replies, use the reply box
   for follow-ups. Edits do not change prompts you already copied.
3. Select **Send comments to agent**. Paste it into a new or existing coding-agent session
   with access to these local files, preferably opened in the reviewed working
   copy. The prompt includes
   absolute paths to the saved context and diff, the working-copy path, stable
   comment IDs, and an exact response-file format. A manual-copy fallback is
   shown if the browser cannot write to the clipboard.
4. Your agent implements requests or answers questions and writes the response file.
   If its sandbox needs permission to write outside the working copy, it asks
   for that permission. The prompt also explains how to return JSON for you to
   save manually when a file write is unavailable.
5. When your agent finishes, select **Import replies** in the prompt dialog or the page toolbar. Replies
   stay under their original comments. After a response has been imported, the
   app also checks the working copy and captures a new snapshot if the diff has
   changed. A successful import closes the dialog and shows the current code.
   Use **View replies** to return to the reviewed snapshot. The dialog stays
   open if there are errors or no new replies. Repeated imports duplicate
   neither replies nor unchanged snapshots.
   Invalid files produce an error and do not partially import. A handoff must
   contain one reply for every block.
6. Add follow-up replies and copy a new prompt. Each handoff includes the full
   thread for every unresolved comment in the selected snapshot. Use **Resolve**
   to exclude completed threads. Imported replies never resolve threads for you.
7. On the latest snapshot, use **Reload from disk** in the snapshot toolbar
   for code changes made outside the reply-import flow. The agent does not capture snapshots itself. If the code has not changed, the latest snapshot is reused. Earlier diffs
   and threads stay intact. Snapshot numbers start at 1 in each review. Use the snapshot menu to return to them and import their replies.

The file list uses compact status badges: **M** for modified, **A** for added,
and **D** for removed. Hover over a file for the full status. These describe
the saved snapshot. A **?** means the saved diff lacks status information,
such as an SVN binary diff without file headers.

Use the review menu to switch between projects. Each saved review opens its
latest snapshot and restores its reading position. Creating a new review keeps
your existing reviews and comments.

## Find comments in the diff

The bar on the right maps comments in the selected snapshot. Blue bands mark
open threads. Muted green bands mark resolved threads. Each thin band marks one
comment section. Nearby bands are spaced apart so they remain distinct in
large diffs. General comments appear at the top. The outlined area shows the
visible part of the review.

Click a band to jump to its thread. Thin lines mark the start and end of each
file. Use the stacked up and down buttons above the bar to visit all threads
in page order, including resolved threads. Navigation wraps at either
end. When comments overlap, the buttons let you visit each thread. Hover over
a band to see its location, status, and first comment.

## Review replies and resume reading

Each model reply includes `needs_review: true` or `needs_review: false` in its
output JSON. Explanations, questions, decisions, and blocked or unsafe requests
need your review. A straightforward fix that was completed and checked can use
`false` when you do not need to respond. Both kinds of reply remain in the thread.

The sticky toolbar shows a red badge with the number of replies needing review
across all snapshots of the current review. Use **Next reply needing review**
to visit them. This button opens the reply's original snapshot, scrolls to the
reply, and marks it as reviewed. The count decreases automatically. After the
last reply, the badge disappears and the button is disabled. Use **Latest
snapshot** when you finish reading. For replies you open manually, **Mark
reviewed** removes them from the queue without resolving the thread.
Adding a follow-up acknowledges the earlier replies in that thread. Resolving
a thread also removes its replies from the queue.

Use **Latest snapshot** to return to the current code at your saved reading
position. Each snapshot has its own position, including after jumping to a
reply. Positions are saved in this browser and survive a page reload. If browser
storage is unavailable, they last until the page closes. When code moves, the
app returns to the nearest available line in the same file, or to the previous
scroll offset if that file is no longer in the diff.

Replies imported before this feature remain in their threads. New imports of
older response files without `needs_review` enter the queue by default. New
response files should always include the boolean flag.

## Scope and storage

- Displays unified diffs with old and new line numbers. Binary/property notices
  are displayed as text. Line comments apply to text on the new side.
- Shows tracked Git or SVN changes, including added and deleted files.
  Untracked files do not appear until you add them with Git or SVN. SVN
  externals and Git submodules need their own review for file-level changes.
  Git renames appear as a deletion and an addition. No commit, update, add,
  or revert is run by the app.
- A snapshot is a saved diff, not a lock on your working copy. Avoid editing
  files during capture. The agent is told to inspect the current files and map old
  anchors before editing. For SVN, the root revision does not describe every
  file in a mixed-revision working copy; the saved diff has file revision headers.
- Diff capture has a 60-second timeout and a 20 MB output limit. Non-UTF-8 text
  is displayed with replacement characters. It is never written back to source.
- `var/reviews.sqlite3` stores reviews, snapshots, and threads.
- `var/handoffs/<batch-id>/` stores `prompt.txt`, `context.json`, `snapshot.diff`,
  and the agent-written `response.json`. Keep these files private: they contain
  source code and review comments. Back up the whole `var/` directory to keep
  both the review history and handoffs. Stop the server before copying it.
- Once a response file is imported, do not edit it. Add a follow-up and create a
  new handoff instead. Replies from older handoffs remain attached to their
  original snapshot and thread.
- The app uses Django, SQLite, and plain JavaScript. No frontend build step,
  worker, external database, or connection to the existing Django sites is used.
- The Git repository contains the app and database migrations. Local data and
  Python environments are excluded by `.gitignore`.

## Verify

```sh
.venv/bin/python manage.py check
.venv/bin/python manage.py test review
```

The tests use isolated local Git and SVN repositories (`git`, `svn`, and
`svnadmin` must be installed), temporary files, and a test database. They do not call a coding agent or any paid API.
