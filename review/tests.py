import json
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.test import Client, TestCase, override_settings

from .models import Batch, Comment, Message, Snapshot
from .views import parse_diff


class ReviewTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.directory = tempfile.TemporaryDirectory(prefix='svn-review-test-')
        cls.root = Path(cls.directory.name)
        cls.repository = cls.root / 'repository'
        cls.working_copy = cls.root / 'working copy'
        cls.command('svnadmin', 'create', str(cls.repository))
        cls.command('svn', 'checkout', cls.repository.as_uri(),
                    str(cls.working_copy))
        cls.source = cls.working_copy / 'sample.txt'
        cls.original = ''.join(f'line {n}\n' for n in range(1, 71))
        cls.source.write_text(cls.original)
        (cls.working_copy / 'removed.txt').write_text('removed\n')
        cls.command('svn', 'add', str(cls.source),
                    str(cls.working_copy / 'removed.txt'))
        cls.command('svn', 'commit', '-m', 'Test fixture',
                    str(cls.working_copy))

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()
        super().tearDownClass()

    @classmethod
    def command(cls, *args):
        return subprocess.run(args, check=True, capture_output=True).stdout

    def setUp(self):
        self.source.write_text(self.original.replace(
            'line 3\n', '<script>alert("source")</script>\n'))
        self.data_directory = tempfile.TemporaryDirectory(dir=self.root)
        self.addCleanup(self.data_directory.cleanup)
        self.override = override_settings(DATA_DIR=Path(self.data_directory.name))
        self.override.enable()
        self.addCleanup(self.override.disable)

    def post(self, action, data, status=200):
        response = self.client.post(
            f'/api/{action}/', json.dumps(data), content_type='application/json')
        self.assertEqual(response.status_code, status, response.content)
        return response.json()

    def create(self):
        result = self.post('create', {'path': str(self.working_copy)})
        return Snapshot.objects.get(pk=result['snapshot_id'])

    def comment(self, snapshot, body='Please explain this change.'):
        return self.post('comment', {
            'snapshot_id': snapshot.id, 'path': 'sample.txt',
            'start': 2, 'end': 4, 'body': body,
        })['comment_id']

    def response_file(self, handoff, responses):
        path = Path(handoff['response_path'])
        path.write_text(json.dumps({
            'batch_id': handoff['batch_id'], 'responses': responses,
        }))
        return path

    def test_capture_context_and_snapshot_preservation(self):
        first = self.create()
        comment_id = self.comment(first)
        self.assertIn('<script>', first.diff)
        rows = first.files[0]['rows']
        changed = next(row for row in rows if row['kind'] == 'add')
        self.assertEqual(changed['new'], 3)
        self.assertIsNone(changed['old'])
        self.assertTrue(any(row['kind'] == 'context' for row in rows))
        self.source.write_text(self.original.replace('line 3\n', 'revised\n'))
        second = self.post('refresh', {'review_id': first.review_id})
        self.assertNotEqual(second['snapshot_id'], first.id)
        first.refresh_from_db()
        self.assertIn('<script>', first.diff)
        self.assertEqual(Comment.objects.get(pk=comment_id).snapshot_id, first.id)
        response = self.client.get('/api/snapshot/', {'id': first.id}).json()
        self.assertEqual(len(response['snapshots']), 2)
        listing = self.client.get('/api/reviews/').json()['reviews']
        self.assertEqual(listing[0]['latest_snapshot'], second['snapshot_id'])

    def test_review_queue_spans_snapshots_and_can_be_acknowledged(self):
        first = self.create()
        comment_id = self.comment(first)
        fixed_id = self.comment(first, 'Fix this.')
        handoff = self.post('export', {'snapshot_id': first.id})
        self.assertIn('needs_review', handoff['prompt'])
        self.response_file(handoff, [
            {'comment_id': comment_id, 'reply': 'Which behavior do you want?',
             'needs_review': True},
            {'comment_id': fixed_id, 'reply': 'Fixed and checked.',
             'needs_review': False},
        ])
        self.source.write_text(self.original.replace('line 3\n', 'fixed\n'))
        result = self.post('import', {'snapshot_id': first.id})
        latest = result['snapshot_id']
        self.assertNotEqual(latest, first.id)
        message = Message.objects.get(comment_id=comment_id, author='codex')
        expected = [{'id': message.id, 'comment_id': comment_id,
                     'comment__snapshot_id': first.id}]
        for snapshot_id in (first.id, latest):
            data = self.client.get('/api/snapshot/', {
                'id': snapshot_id}).json()
            self.assertEqual(data['review_queue'], expected)
        other = self.create()
        self.assertEqual(self.client.get('/api/snapshot/', {
            'id': other.id}).json()['review_queue'], [])
        self.post('reviewed', {'message_id': message.id})
        self.assertEqual(self.client.get('/api/snapshot/', {
            'id': latest}).json()['review_queue'], [])
        self.assertFalse(Comment.objects.get(pk=comment_id).resolved)
        message.refresh_from_db()
        self.assertTrue(message.needs_review)
        self.assertTrue(message.reviewed)

    def test_review_flag_validation_is_atomic_and_legacy_replies_are_visible(self):
        snapshot = self.create()
        first = self.comment(snapshot)
        second = self.comment(snapshot, 'Another question')
        handoff = self.post('export', {'snapshot_id': snapshot.id})
        for invalid in ('false', 0, None, []):
            self.response_file(handoff, [
                {'comment_id': first, 'reply': 'Answer', 'needs_review': True},
                {'comment_id': second, 'reply': 'Answer',
                 'needs_review': invalid},
            ])
            result = self.post('import', {'snapshot_id': snapshot.id})
            self.assertTrue(result['errors'])
            self.assertFalse(Message.objects.filter(author='codex').exists())
            self.assertFalse(Batch.objects.get(pk=handoff['batch_id']).imported)
        self.response_file(handoff, [
            {'comment_id': c, 'reply': 'Legacy answer'} for c in (first, second)])
        self.post('import', {'snapshot_id': snapshot.id})
        self.assertEqual(Message.objects.filter(needs_review=True).count(), 2)
        self.post('import', {'snapshot_id': snapshot.id})
        self.assertEqual(Message.objects.filter(needs_review=True).count(), 2)
        self.post('resolve', {'comment_id': first, 'resolved': True})
        queue = self.client.get('/api/snapshot/', {
            'id': snapshot.id}).json()['review_queue']
        self.assertEqual([m['comment_id'] for m in queue], [second])
        self.post('reply', {'comment_id': second, 'body': 'Use option A.'})
        self.assertEqual(self.client.get('/api/snapshot/', {
            'id': snapshot.id}).json()['review_queue'], [])

    def test_fresh_session_handoff_import_and_followup(self):
        snapshot = self.create()
        comment_id = self.comment(snapshot)
        handoff = self.post('export', {'snapshot_id': snapshot.id})
        for required in (str(self.working_copy), 'context.json',
                         'snapshot.diff', 'response.json', comment_id):
            self.assertIn(required, handoff['prompt'])
        directory = Path(handoff['response_path']).parent
        context = json.loads((directory / 'context.json').read_text())
        self.assertEqual(context['blocks'][0]['messages'][0]['body'],
                         'Please explain this change.')
        self.assertEqual((directory / 'snapshot.diff').read_text(), snapshot.diff)
        self.response_file(handoff, [
            {'comment_id': comment_id, 'reply': 'This changes the sample.'}])
        imported = self.post('import', {'snapshot_id': snapshot.id})
        self.assertEqual(imported, {
            'imported': 1, 'errors': [], 'snapshot_id': snapshot.id,
            'snapshot_created': False})
        self.assertEqual(self.post('import', {'snapshot_id': snapshot.id})[
            'imported'], 0)
        self.assertEqual(Message.objects.filter(author='codex').count(), 1)
        self.post('resolve', {'comment_id': comment_id, 'resolved': True})
        self.post('export', {'snapshot_id': snapshot.id}, status=400)
        self.post('reply', {'comment_id': comment_id, 'body': 'Why this way?'})
        self.assertFalse(Comment.objects.get(pk=comment_id).resolved)
        followup = self.post('export', {'snapshot_id': snapshot.id})
        batch = Batch.objects.get(pk=followup['batch_id'])
        self.assertEqual([m['author'] for m in batch.blocks[0]['messages']],
                         ['user', 'codex', 'user'])
        self.assertEqual(Batch.objects.get(pk=handoff['batch_id']).blocks[0][
            'messages'][-1]['body'], 'Please explain this change.')

    def test_import_captures_changes_and_preserves_reviewed_snapshot(self):
        original = self.create()
        comment_id = self.comment(original)
        handoff = self.post('export', {'snapshot_id': original.id})
        self.source.write_text(self.original.replace('line 3\n', 'fixed\n'))
        waiting = self.post('import', {'snapshot_id': original.id})
        self.assertEqual(waiting['snapshot_id'], original.id)
        self.assertEqual(Snapshot.objects.count(), 1)
        self.response_file(handoff, [
            {'comment_id': comment_id, 'reply': 'Fixed the code.'}])
        result = self.post('import', {'snapshot_id': original.id})
        current = Snapshot.objects.get(pk=result['snapshot_id'])
        self.assertTrue(result['snapshot_created'])
        self.assertIn('+fixed', current.diff)
        original.refresh_from_db()
        self.assertIn('<script>', original.diff)
        self.assertEqual(Comment.objects.get(pk=comment_id).snapshot_id,
                         original.id)
        self.assertEqual(Message.objects.filter(author='codex').count(), 1)
        repeated = self.post('import', {'snapshot_id': original.id})
        self.assertEqual(repeated['snapshot_id'], current.id)
        self.assertFalse(repeated['snapshot_created'])
        self.assertEqual(Snapshot.objects.count(), 2)
        # A previously imported response can still refresh a stale review.
        self.source.write_text(self.original)
        refreshed = self.post('import', {'snapshot_id': original.id})
        self.assertTrue(refreshed['snapshot_created'])
        self.assertEqual(Snapshot.objects.get(pk=refreshed['snapshot_id']).diff,
                         '')
        self.assertEqual(Message.objects.filter(author='codex').count(), 1)

    def test_import_keeps_replies_when_diff_capture_fails(self):
        snapshot = self.create()
        comment_id = self.comment(snapshot)
        handoff = self.post('export', {'snapshot_id': snapshot.id})
        self.response_file(handoff, [
            {'comment_id': comment_id, 'reply': 'Answer saved.'}])
        with patch('review.views.capture_diff', side_effect=ValueError('Offline')):
            result = self.post('import', {'snapshot_id': snapshot.id})
        self.assertEqual(result['imported'], 1)
        self.assertIn('could not be refreshed', result['errors'][0])
        self.assertEqual(result['snapshot_id'], snapshot.id)
        self.assertEqual(Message.objects.filter(author='codex').count(), 1)

    def test_invalid_import_is_atomic_and_changed_import_is_rejected(self):
        snapshot = self.create()
        first = self.comment(snapshot)
        second = self.comment(snapshot, 'Another question')
        handoff = self.post('export', {'snapshot_id': snapshot.id})
        valid = [{'comment_id': c, 'reply': 'Answer'} for c in (first, second)]
        invalid_sets = [valid[:1], valid + valid[:1],
                        [valid[0], {'comment_id': 'unknown', 'reply': 'No'}],
                        [valid[0], {'comment_id': second, 'reply': ''}]]
        for responses in invalid_sets:
            self.response_file(handoff, responses)
            result = self.post('import', {'snapshot_id': snapshot.id})
            self.assertTrue(result['errors'])
            self.assertEqual(Message.objects.filter(author='codex').count(), 0)
        self.response_file(handoff, valid)
        self.assertEqual(self.post('import', {'snapshot_id': snapshot.id})[
            'imported'], 2)
        valid[0]['reply'] = 'Changed'
        self.response_file(handoff, valid)
        self.assertTrue(self.post('import', {'snapshot_id': snapshot.id})['errors'])
        self.assertEqual(Message.objects.filter(author='codex').count(), 2)

    def test_invalid_ranges_and_hunk_gaps(self):
        self.source.write_text(self.original.replace(
            'line 3\n', 'first change\n').replace('line 65\n', 'last change\n'))
        snapshot = self.create()
        for path, start, end in [('sample.txt', 1, 70), ('missing', 1, 1),
                                 ('sample.txt', 4, 2), ('', 1, 2),
                                 ('sample.txt', True, 2)]:
            self.post('comment', {
                'snapshot_id': snapshot.id, 'path': path,
                'start': start, 'end': end, 'body': 'Question',
            }, status=400)
        self.assertFalse(Comment.objects.exists())
        self.post('comment', {'snapshot_id': snapshot.id, 'body': 'General'})

    def test_add_delete_properties_and_no_final_newline(self):
        added = self.working_copy / 'added @ file.txt'
        added.write_text('new text without newline')
        self.command('svn', 'add', str(added) + '@')
        self.command('svn', 'delete', str(self.working_copy / 'removed.txt'))
        self.command('svn', 'propset', 'review:test', 'property text', str(self.source))
        try:
            snapshot = self.create()
            files = {f['path']: f['rows'] for f in snapshot.files}
            self.assertIn('added @ file.txt', files)
            self.assertTrue(any(r['kind'] == 'add' and r['new'] == 1
                                for r in files['added @ file.txt']))
            self.assertTrue(any(r['kind'] == 'remove' and r['old'] == 1
                                for r in files['removed.txt']))
            self.assertTrue(any('Property changes' in r['text']
                                for r in files['sample.txt']))
        finally:
            self.command('svn', 'revert', '-R', str(self.working_copy))
            added.unlink()

    def test_read_only_methods_csrf_and_invalid_directory(self):
        self.post('create', {'path': str(self.root / 'missing')}, status=400)
        self.post('create', {'path': str(self.root)}, status=400)
        client = Client(enforce_csrf_checks=True)
        response = client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('csrftoken', response.cookies)
        self.assertEqual(client.post('/api/create/', '{}',
            content_type='application/json').status_code, 403)
        self.assertEqual(client.get('/api/create/').status_code, 400)
        self.assertEqual(client.get('/static/review/app.js').status_code, 200)

    def test_parser_does_not_confuse_source_with_headers(self):
        diff = ('Index: tricky.txt\n===\n--- tricky.txt\n+++ tricky.txt\n'
                '@@ -1,2 +1,2 @@\n--- source\n+++ source\n Index: source\n'
                '\\ No newline at end of file\n')
        files = parse_diff(diff)
        self.assertEqual(len(files), 1)
        content = [r for r in files[0]['rows'] if r['kind'] in
                   ('add', 'remove', 'context')]
        self.assertEqual([(r['old'], r['new']) for r in content],
                         [(1, None), (None, 1), (2, 2)])
        self.assertEqual(content[1]['text'], '++ source')

    def test_folder_browser(self):
        response = self.client.get('/api/directories/', {
            'path': str(self.working_copy)})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['path'], str(self.working_copy))
        self.assertEqual(data['parent'], str(self.root))
        self.assertIn('.svn', [child['name'] for child in data['directories']])
        self.assertNotIn('sample.txt', [child['name'] for child in
                                     data['directories']])
        for path in (self.source, self.root / 'missing'):
            self.assertEqual(self.client.get('/api/directories/', {
                'path': str(path)}).status_code, 400)
