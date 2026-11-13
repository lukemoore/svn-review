# SVN Review

Review local SVN changes in your browser and send questions or change requests
to a **fresh Codex session on the same computer**. Replies return to the original
comment threads through a JSON file. No API keys or model calls are used.

## Start

Requires Python 3.10 or later and the `svn` command.

Clone the project and start it:

```sh
git clone https://github.com/lukemoore/svn-review.git
cd svn-review
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

1. Select **New review**, then **Browse…** to choose a local folder in the
   folder browser. You can also enter an SVN working-copy directory. You can use a
   subdirectory to limit the review. The app runs `svn diff --internal-diff`
   with 12 context lines and saves the result.
2. Select code text on the new side, then click **Add comment** beside the
   selection. The comment box stays visible at the bottom of the screen.
   Alternatively, select a line number and Shift-click a second line number to
   select a range within the same hunk. Write a question or change request and
   select **Save comment**. Use **Add general comment** for deleted files,
   properties, binary files, or broader questions.
3. Select **Copy Codex prompt**. Paste it into a new Codex session on this
   computer, preferably opened in the reviewed working copy. The prompt includes
   absolute paths to the saved context and diff, the working-copy path, stable
   comment IDs, and an exact response-file format. A manual-copy fallback is
   shown if the browser cannot write to the clipboard.
4. Codex implements requests or answers questions and writes the response file.
   If its sandbox needs permission to write outside the working copy, it asks
   for that permission. The prompt also explains how to return JSON for you to
   save manually when a file write is unavailable.
5. Select **Import replies** in the prompt dialog or the page toolbar. Replies
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
7. Use **Capture new snapshot** for code changes made outside the reply-import
   flow. Codex does not capture snapshots itself. Earlier diffs and threads
   stay intact. Use the snapshot menu to return to them and import their replies.

## Review replies and resume reading

Each model reply includes `needs_review: true` or `needs_review: false` in its
output JSON. Explanations, questions, decisions, and blocked or unsafe requests
need your review. A straightforward fix that was completed and checked can use
`false` when you do not need to respond. Both kinds of reply remain in the thread.

The sticky toolbar shows how many replies need review across all snapshots of
the current review. Use **Next reply** and **Previous reply** to visit them.
These buttons open the reply's original snapshot and scroll to the reply.
Use **Mark reviewed** to remove it from the queue without resolving the thread.
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
- Shows tracked SVN changes, including added and deleted files. Unversioned
  files do not appear until you add them with SVN. External working copies need
  their own review. No commit, update, add, or revert is run by the app.
- A snapshot is a saved diff, not a lock on your working copy. Avoid editing
  files during capture. Codex is told to inspect the current files and map old
  anchors before editing. The displayed root revision does not describe every
  file in a mixed-revision working copy; the saved diff has file revision headers.
- Diff capture has a 60-second timeout and a 20 MB output limit. Non-UTF-8 text
  is displayed with replacement characters. It is never written back to source.
- `var/reviews.sqlite3` stores reviews, snapshots, and threads.
- `var/handoffs/<batch-id>/` stores `prompt.txt`, `context.json`, `snapshot.diff`,
  and the Codex-written `response.json`. Keep these files private: they contain
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

The tests use an isolated local SVN repository (`svnadmin` must be installed),
temporary files, and a test database. They do not call Codex or any paid API.
