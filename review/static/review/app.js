'use strict';

const $ = (selector) => document.querySelector(selector);
let snapshot = null;
let selection = null;
let busy = false;
let selectedText = null;
let folder = null;
let folderRequest = 0;
let handoffSnapshotId = null;
let importedSnapshotId = null;
let handoffPosition = null;
let reviewMessageId = null;
const snapshotPositions = new Map();
let positionTimer;
let actionPosition = null;

function rememberPosition(position = readingPosition()) {
  if (!snapshot) return;
  snapshotPositions.set(snapshot.id, position);
  try {
    localStorage.setItem(`svn-review-position-${snapshot.id}`, JSON.stringify(position));
  } catch { /* Navigation still works when browser storage is unavailable. */ }
}

function savedPosition(id) {
  if (!snapshotPositions.has(id)) {
    try {
      const position = JSON.parse(localStorage.getItem(`svn-review-position-${id}`));
      if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
        snapshotPositions.set(id, position);
      }
    } catch { /* Ignore missing or unreadable saved positions. */ }
  }
  return snapshotPositions.get(id);
}

window.addEventListener('scroll', () => {
  clearTimeout(positionTimer);
  positionTimer = setTimeout(() => {
    if (!busy && !$('#handoff-dialog').open) rememberPosition();
  }, 150);
}, {passive: true});
window.addEventListener('pagehide', () => {
  if (!busy) rememberPosition($('#handoff-dialog').open ? handoffPosition : readingPosition());
});

// Notice text and wrapped toolbar buttons can change height on small screens.
function updateStickySizes() {
  document.documentElement.style.setProperty('--notice-height', `${$('#notice').offsetHeight}px`);
  document.documentElement.style.setProperty('--toolbar-height', `${$('.toolbar').offsetHeight}px`);
}
const stickySizes = new ResizeObserver(updateStickySizes);
stickySizes.observe($('#notice'));
stickySizes.observe($('.toolbar'));

function readingPosition() {
  const top = Math.max(0, $('.toolbar').getBoundingClientRect().bottom);
  const row = [...document.querySelectorAll('#diff tr[data-line]')].find(
    row => row.getBoundingClientRect().top >= top);
  return {x: window.scrollX, y: window.scrollY, path: row?.dataset.path,
    line: Number(row?.dataset.line), offset: row?.getBoundingClientRect().top - top};
}

async function restoreReadingPosition(position) {
  // Wait for dialog focus restoration and the notice's new sticky height.
  updateStickySizes();
  await new Promise(requestAnimationFrame);
  const rows = [...document.querySelectorAll('#diff tr[data-line]')].filter(
    row => row.dataset.path === position.path);
  const row = rows.reduce((nearest, row) => !nearest ||
    Math.abs(Number(row.dataset.line) - position.line) <
    Math.abs(Number(nearest.dataset.line) - position.line) ? row : nearest, null);
  const top = $('#notice').offsetHeight + $('.toolbar').offsetHeight;
  const y = row && position.y > 0 ?
    window.scrollY + row.getBoundingClientRect().top - top - position.offset : position.y;
  window.scrollTo({left: position.x, top: Math.max(0, y), behavior: 'instant'});
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function notice(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').className = error ? 'error' : '';
  $('#notice').hidden = !message;
}

async function api(action, data) {
  const token = document.cookie.split('; ').find(c => c.startsWith('csrftoken='));
  const options = data === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json',
      'X-CSRFToken': token ? decodeURIComponent(token.split('=')[1]) : ''},
    body: JSON.stringify(data),
  };
  const response = await fetch(`/api/${action}`, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

async function act(callback) {
  if (busy) return;
  actionPosition = snapshot ? {id: snapshot.id,
    position: $('#handoff-dialog').open ? handoffPosition : readingPosition()} : null;
  busy = true;
  document.body.classList.add('busy');
  notice('');
  $('#create-error').hidden = true;
  try { await callback(); }
  catch (error) {
    notice(error.message, true);
    if ($('#handoff-dialog').open) {
      $('#handoff-status').textContent = error.message;
      $('#handoff-status').hidden = false;
    }
    if ($('#create-dialog').open) {
      $('#create-error').textContent = error.message;
      $('#create-error').hidden = false;
    }
  }
  finally { busy = false; document.body.classList.remove('busy'); }
}

async function loadReviews() {
  const data = await api('reviews/');
  $('#reviews').replaceChildren(node('option', '', 'Choose a review'));
  $('#reviews').firstChild.value = '';
  for (const review of data.reviews) {
    const option = node('option', '', review.title);
    option.value = review.latest_snapshot;
    option.dataset.review = review.id;
    $('#reviews').append(option);
  }
  if (snapshot) selectReview();
}

function selectReview() {
  for (const option of $('#reviews').options) {
    option.selected = Number(option.dataset.review) === snapshot.review_id;
  }
}

async function loadSnapshot(id) {
  const previous = snapshot;
  const position = actionPosition && actionPosition.id === previous?.id ? actionPosition.position :
    ($('#handoff-dialog').open ? handoffPosition : readingPosition());
  if (previous) rememberPosition(position);
  const next = await api(`snapshot/?id=${encodeURIComponent(id)}`);
  snapshot = next;
  history.replaceState(null, '', `?snapshot=${snapshot.id}`);
  closeComposer();
  render();
  const target = savedPosition(snapshot.id) ||
    (previous?.review_id === snapshot.review_id ? position : {x: 0, y: 0});
  await restoreReadingPosition(target);
  rememberPosition(target);
}

function renderReviewNavigation() {
  const queue = snapshot.review_queue;
  const index = queue.findIndex(message => message.id === reviewMessageId);
  const count = queue.length === 1 ? '1 reply needs review' : `${queue.length} replies need review`;
  $('#review-progress').textContent = index < 0 ? count :
    `Reply ${index + 1} of ${queue.length} needing review`;
  $('#review-previous').disabled = $('#review-next').disabled = !queue.length;
  $('#latest-snapshot').disabled = snapshot.id === snapshot.snapshots[0].id;
}

async function jumpToReview(direction) {
  const queue = snapshot.review_queue;
  if (!queue.length) return;
  const index = queue.findIndex(message => message.id === reviewMessageId);
  const next = index < 0 ? (direction > 0 ? 0 : queue.length - 1) :
    (index + direction + queue.length) % queue.length;
  const message = queue[next];
  reviewMessageId = message.id;
  await loadSnapshot(message.comment__snapshot_id);
  const entry = document.getElementById(`message-${message.id}`);
  if (entry) {
    entry.scrollIntoView({block: 'start', behavior: 'instant'});
    entry.focus({preventScroll: true});
    rememberPosition();
  }
}

$('#review-previous').onclick = () => act(() => jumpToReview(-1));
$('#review-next').onclick = () => act(() => jumpToReview(1));
$('#latest-snapshot').onclick = () => act(() => loadSnapshot(snapshot.snapshots[0].id));

function render() {
  $('#welcome').hidden = true;
  $('#review').hidden = false;
  $('#title').textContent = snapshot.title;
  $('#path').textContent = snapshot.working_copy;
  selectReview();
  $('#snapshots').replaceChildren();
  snapshot.snapshots.forEach((item, index) => {
    const option = node('option', '', `#${item.id} · ${new Date(item.created).toLocaleString()}${index === 0 ? ' · latest' : ''}`);
    option.value = item.id;
    option.selected = item.id === snapshot.id;
    $('#snapshots').append(option);
  });
  renderReviewNavigation();
  $('#files').replaceChildren();
  $('#threads').replaceChildren();
  $('#diff').replaceChildren();
  $('#general-threads').replaceChildren();
  $('#file-count').textContent = snapshot.files.length;
  $('#thread-count').textContent = snapshot.comments.filter(c => !c.resolved).length;
  const pending = snapshot.batches.filter(b => !b.imported).length;
  $('#batch-info').textContent = pending ? `${pending} handoff(s) awaiting replies. Import replies checks their local response files.` : '';
  snapshot.comments.forEach(comment => {
    const link = node('a', comment.resolved ? 'resolved-link' : '',
      `${comment.resolved ? '✓ ' : ''}${comment.path || 'General'}${comment.start ? `:${comment.start}` : ''}`);
    link.href = `#comment-${comment.id}`;
    link.title = comment.messages[0].body;
    $('#threads').append(link);
    if (!comment.path) $('#general-threads').append(thread(comment));
  });
  if (!snapshot.files.length) {
    $('#diff').append(node('p', 'empty', 'No tracked changes in this snapshot. Add files or edit the working copy, then capture a new snapshot.'));
  }
  snapshot.files.forEach((file, index) => {
    const fileId = `file-${index}`;
    const link = node('a', '', file.path);
    link.href = `#${fileId}`;
    $('#files').append(link);
    const section = node('section', 'file');
    section.id = fileId;
    const header = node('h2', 'file-header', file.path);
    const added = file.rows.filter(r => r.kind === 'add').length;
    const removed = file.rows.filter(r => r.kind === 'remove').length;
    header.append(node('span', 'stats', `+${added}  −${removed}`));
    section.append(header);
    const table = node('table', 'diff-table');
    table.setAttribute('aria-label', `Diff for ${file.path}`);
    const tbody = node('tbody');
    const shown = new Set();
    file.rows.forEach(row => {
      const tr = node('tr', row.kind);
      const oldCell = node('td', 'line-number', row.old ?? '');
      const newCell = node('td', 'line-number');
      if (row.new !== null) {
        tr.dataset.path = file.path;
        tr.dataset.line = row.new;
        const button = node('button', 'line-select', row.new);
        button.type = 'button';
        button.setAttribute('aria-label', `Comment on ${file.path} line ${row.new}`);
        button.addEventListener('click', event => selectLine(file.path, row.new, event.shiftKey));
        newCell.append(button);
      }
      const code = node('td', 'source');
      code.append(node('span', 'marker', row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '));
      code.append(document.createTextNode(row.text));
      tr.append(oldCell, newCell, code);
      tbody.append(tr);
      snapshot.comments.filter(c => c.path === file.path && c.end === row.new).forEach(comment => {
        const commentRow = node('tr', 'thread-row');
        const cell = node('td');
        cell.colSpan = 3;
        cell.append(thread(comment));
        commentRow.append(cell);
        tbody.append(commentRow);
        shown.add(comment.id);
      });
    });
    table.append(tbody);
    const scroll = node('div', 'table-scroll');
    scroll.append(table);
    section.append(scroll);
    snapshot.comments.filter(c => c.path === file.path && !shown.has(c.id)).forEach(c => section.append(thread(c)));
    $('#diff').append(section);
  });
}

function thread(comment) {
  const box = node('section', `thread${comment.resolved ? ' resolved' : ''}`);
  box.id = `comment-${comment.id}`;
  const heading = node('div', 'thread-heading');
  const label = node('strong', '', comment.path ? `Lines ${comment.start}–${comment.end}` : 'General comment');
  if (comment.path) {
    label.className = 'line-range';
    label.tabIndex = 0;
    label.title = 'Highlight these lines';
    let hovered = false;
    let focused = false;
    const highlight = () => {
      box.closest('.file')?.querySelectorAll('tr[data-line]').forEach(row => {
        const line = Number(row.dataset.line);
        if (row.dataset.path === comment.path && line >= comment.start && line <= comment.end) {
          row.classList.toggle('thread-highlight', hovered || focused);
        }
      });
    };
    label.addEventListener('mouseenter', () => { hovered = true; highlight(); });
    label.addEventListener('mouseleave', () => { hovered = false; highlight(); });
    label.addEventListener('focus', () => { focused = true; highlight(); });
    label.addEventListener('blur', () => { focused = false; highlight(); });
  }
  heading.append(label);
  const resolve = node('button', '', comment.resolved ? 'Reopen' : 'Resolve');
  resolve.addEventListener('click', () => act(async () => {
    await api('resolve/', {comment_id: comment.id, resolved: !comment.resolved});
    await loadSnapshot(snapshot.id);
  }));
  heading.append(resolve);
  box.append(heading);
  comment.messages.forEach(message => {
    const entry = node('div', `message ${message.author}`);
    entry.id = `message-${message.id}`;
    entry.tabIndex = -1;
    entry.append(node('div', 'author', message.author === 'user' ? 'You' : 'Codex'));
    entry.append(node('div', 'message-body', message.body));
    if (message.author === 'codex' && message.needs_review && !message.reviewed && !comment.resolved) {
      entry.classList.add('needs-review');
      const reviewed = node('button', 'review-message', 'Mark reviewed');
      reviewed.type = 'button';
      reviewed.onclick = () => act(async () => {
        await api('reviewed/', {message_id: message.id});
        await loadSnapshot(snapshot.id);
      });
      entry.append(reviewed);
    }
    box.append(entry);
  });
  const form = node('form', 'reply-form');
  const input = node('textarea');
  input.rows = 2;
  input.required = true;
  input.maxLength = 50000;
  input.placeholder = 'Reply or ask a follow-up…';
  input.setAttribute('aria-label', 'Reply to this thread');
  const submit = node('button', '', 'Add reply');
  form.append(input, submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    act(async () => {
      await api('reply/', {comment_id: comment.id, body: input.value});
      await loadSnapshot(snapshot.id);
      document.getElementById(`comment-${comment.id}`).scrollIntoView({block: 'center'});
    });
  });
  box.append(form);
  return box;
}

function selectLine(path, line, extend) {
  const anchor = extend && selection?.path === path ? selection.anchor : line;
  selection = {path, anchor, start: Math.min(anchor, line), end: Math.max(anchor, line)};
  $('#selection-label').textContent = `${path} · lines ${selection.start}–${selection.end}`;
  $('#composer').hidden = false;
  document.body.classList.add('composing');
  document.querySelectorAll('tr[data-line]').forEach(row => {
    row.classList.toggle('selected', row.dataset.path === path &&
      Number(row.dataset.line) >= selection.start && Number(row.dataset.line) <= selection.end);
  });
}

function closeComposer() {
  hideSelectionButton();
  selection = null;
  $('#composer').hidden = true;
  $('#comment-body').value = '';
  document.body.classList.remove('composing');
  document.querySelectorAll('tr.selected').forEach(row => row.classList.remove('selected'));
}

function hideSelectionButton() {
  selectedText = null;
  $('#selection-comment').hidden = true;
}

function showSelectionButton() {
  const text = window.getSelection();
  hideSelectionButton();
  if (!text.rangeCount || text.isCollapsed || !text.toString().trim()) return;
  const range = text.getRangeAt(0);
  const sourceRow = container => {
    const element = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
    return element.closest('#diff .source')?.closest('tr[data-line]');
  };
  const first = sourceRow(range.startContainer);
  const last = sourceRow(range.endContainer);
  if (!first || !last || first.dataset.path !== last.dataset.path) return;
  const start = Number(first.dataset.line);
  const end = Number(last.dataset.line);
  const file = snapshot.files.find(file => file.path === first.dataset.path);
  const lines = new Set(file.rows.filter(row => row.new !== null).map(row => row.new));
  for (let line = start; line <= end; line++) {
    if (!lines.has(line)) return;
  }
  const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
  const rect = rects.at(-1);
  if (!rect || rect.bottom < 0 || rect.top > innerHeight) return;
  selectedText = {path: first.dataset.path, start, end};
  const button = $('#selection-comment');
  button.hidden = false;
  button.style.left = `${Math.max(8, Math.min(rect.right, innerWidth - button.offsetWidth - 8))}px`;
  const top = rect.bottom + 6;
  button.style.top = `${Math.max(8, top + button.offsetHeight < innerHeight ? top : rect.top - button.offsetHeight - 6)}px`;
}

// Selection changes cover mouse drags, keyboard selection, and touch handles.
document.addEventListener('selectionchange', () => {
  if (document.activeElement === $('#selection-comment')) return;
  showSelectionButton();
});
document.addEventListener('scroll', hideSelectionButton, true);
window.addEventListener('resize', hideSelectionButton);
$('#selection-comment').onpointerdown = event => event.preventDefault();
$('#selection-comment').onclick = () => {
  if (!selectedText) return;
  const {path, start, end} = selectedText;
  selectLine(path, start, false);
  selectLine(path, end, true);
  hideSelectionButton();
  window.getSelection().removeAllRanges();
  $('#comment-body').focus({preventScroll: true});
};

async function browseFolder(path) {
  const request = ++folderRequest;
  $('#folder-error').hidden = true;
  $('#folder-select').disabled = true;
  try {
    const result = await api(`directories/?${path ? `path=${encodeURIComponent(path)}` : ''}`);
    if (request !== folderRequest) return;
    folder = result;
    $('#folder-location').value = folder.path;
    $('#folder-up').disabled = folder.path === folder.parent;
    renderFolders();
    $('#folder-select').disabled = false;
  } catch (error) {
    if (request !== folderRequest) return;
    $('#folder-error').textContent = error.message;
    $('#folder-error').hidden = false;
  }
}

function renderFolders() {
  $('#folder-list').replaceChildren();
  if (!folder) return;
  const visible = folder.directories.filter(child => $('#folder-hidden').checked || !child.name.startsWith('.'));
  for (const child of visible) {
    const button = node('button', '', child.name);
    button.type = 'button';
    button.onclick = () => browseFolder(child.path);
    $('#folder-list').append(button);
  }
  if (!visible.length) $('#folder-list').append(node('p', 'hint', 'No subfolders to show. You can select this folder.'));
}

$('#browse').onclick = () => {
  $('#folder-dialog').showModal();
  browseFolder($('#wc-path').value.trim());
};
$('#folder-location-form').onsubmit = event => {
  event.preventDefault();
  browseFolder($('#folder-location').value.trim());
};
$('#folder-home').onclick = () => browseFolder();
$('#folder-up').onclick = () => { if (folder) browseFolder(folder.parent); };
$('#folder-hidden').onchange = renderFolders;
$('#folder-cancel').onclick = () => $('#folder-dialog').close();
$('#folder-select').onclick = () => {
  $('#wc-path').value = folder.path;
  $('#folder-dialog').close();
};

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText($('#prompt').value);
    promptCopied();
  } catch {
    $('#handoff-title').textContent = 'Select and copy the prompt';
    $('#prompt').focus();
    $('#prompt').select();
  }
}

function promptCopied() {
  $('#handoff-title').textContent = 'Prompt copied';
  $('#copy-again').classList.remove('primary');
  $('#handoff-import').hidden = false;
  $('#handoff-import').focus({preventScroll: true});
}

// Manual copying is also available when clipboard access is blocked.
$('#prompt').addEventListener('copy', () => setTimeout(promptCopied, 0));

$('#new-review').onclick = $('#start-review').onclick = () => $('#create-dialog').showModal();
$('#cancel-create').onclick = () => $('#create-dialog').close();
$('#create-form').onsubmit = event => {
  event.preventDefault();
  act(async () => {
    const result = await api('create/', {path: $('#wc-path').value, title: $('#review-title').value});
    $('#create-dialog').close();
    await loadReviews();
    await loadSnapshot(result.snapshot_id);
  });
};
$('#reviews').onchange = event => {
  if (event.target.value) act(() => loadSnapshot(event.target.value));
};
$('#snapshots').onchange = event => act(() => loadSnapshot(event.target.value));
$('#refresh').onclick = () => act(async () => {
  const result = await api('refresh/', {review_id: snapshot.review_id});
  await loadSnapshot(result.snapshot_id);
  await loadReviews();
  notice('New snapshot captured. Earlier comments remain on their original snapshot.');
});
$('#general').onclick = () => {
  closeComposer();
  selection = {path: '', start: null, end: null};
  $('#selection-label').textContent = 'General comment';
  $('#composer').hidden = false;
  document.body.classList.add('composing');
  $('#comment-body').focus();
};
$('#cancel-comment').onclick = closeComposer;
$('#composer').onsubmit = event => {
  event.preventDefault();
  act(async () => {
    await api('comment/', {snapshot_id: snapshot.id, ...selection, body: $('#comment-body').value});
    await loadSnapshot(snapshot.id);
  });
};
$('#export').onclick = () => act(async () => {
  const result = await api('export/', {snapshot_id: snapshot.id});
  handoffSnapshotId = snapshot.id;
  importedSnapshotId = null;
  $('#handoff-status').hidden = true;
  $('#handoff-results').hidden = true;
  $('#handoff-title').textContent = 'Prompt ready';
  $('#handoff-import').hidden = true;
  $('#copy-again').classList.add('primary');
  $('#prompt').value = result.prompt;
  $('#response-path').textContent = `Response file: ${result.response_path}`;
  handoffPosition = actionPosition.position;
  $('#handoff-dialog').showModal();
  $('#copy-again').focus({preventScroll: true});
  // Keep draft replies intact while refreshing handoff metadata.
  snapshot.batches.push({id: result.batch_id, imported: false});
  $('#batch-info').textContent = 'Handoff ready. Import replies after Codex writes its response file.';
});
async function importReplies(snapshotId) {
  const position = $('#handoff-dialog').open ? handoffPosition : readingPosition();
  const result = await api('import/', {snapshot_id: snapshotId});
  importedSnapshotId = result.snapshot_id;
  await loadSnapshot(result.snapshot_id);
  await loadReviews();
  const updated = result.snapshot_id !== snapshotId;
  const message = `${result.imported} replies imported.${result.imported ? '' : ' No new completed response files found.'}` +
    (updated ? ` Showing current code in snapshot #${result.snapshot_id}. Replies remain on snapshot #${snapshotId}.` : '') +
    (result.errors.length ? ` ${result.errors.join(' ')}` : '');
  if (result.imported > 0 && !result.errors.length) {
    $('#handoff-dialog').close();
  }
  notice(message, !!result.errors.length);
  if ($('#handoff-dialog').open) {
    $('#handoff-status').textContent = message;
    $('#handoff-status').hidden = false;
    $('#handoff-results').hidden = false;
  } else if (updated) {
    const replies = node('button', '', 'View replies');
    replies.onclick = () => act(() => loadSnapshot(snapshotId));
    $('#notice').append(document.createTextNode(' '), replies);
  }
  if (!$('#handoff-dialog').open && position) {
    await restoreReadingPosition(position);
    rememberPosition();
  }
}
$('#import').onclick = () => act(() => importReplies(snapshot.id));
$('#handoff-import').onclick = () => act(() => importReplies(handoffSnapshotId));
$('#view-replies').onclick = () => act(async () => {
  await loadSnapshot(handoffSnapshotId);
  $('#handoff-dialog').close();
  await restoreReadingPosition(savedPosition(snapshot.id));
});
$('#view-code').onclick = () => act(async () => {
  await loadSnapshot(importedSnapshotId);
  $('#handoff-dialog').close();
  await restoreReadingPosition(savedPosition(snapshot.id));
});
$('#close-handoff').onclick = () => $('#handoff-dialog').close();
$('#copy-again').onclick = copyPrompt;

act(async () => {
  await loadReviews();
  const id = new URLSearchParams(location.search).get('snapshot');
  if (id) await loadSnapshot(id);
});
