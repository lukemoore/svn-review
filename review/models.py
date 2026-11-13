import uuid

from django.db import models


class Review(models.Model):
    title = models.CharField(max_length=200)
    working_copy = models.TextField()
    created = models.DateTimeField(auto_now_add=True)


class Snapshot(models.Model):
    review = models.ForeignKey(Review, on_delete=models.CASCADE)
    created = models.DateTimeField(auto_now_add=True)
    diff = models.TextField()
    files = models.JSONField()
    revision = models.TextField()
    digest = models.CharField(max_length=64)


class Comment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    snapshot = models.ForeignKey(Snapshot, on_delete=models.CASCADE)
    path = models.TextField(blank=True)
    start = models.PositiveIntegerField(null=True)
    end = models.PositiveIntegerField(null=True)
    resolved = models.BooleanField(default=False)
    created = models.DateTimeField(auto_now_add=True)


class Message(models.Model):
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE)
    author = models.CharField(max_length=10)
    body = models.TextField()
    needs_review = models.BooleanField(default=False)
    reviewed = models.BooleanField(default=False)
    created = models.DateTimeField(auto_now_add=True)


class Batch(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    snapshot = models.ForeignKey(Snapshot, on_delete=models.CASCADE)
    blocks = models.JSONField()
    created = models.DateTimeField(auto_now_add=True)
    imported = models.BooleanField(default=False)
    response_digest = models.CharField(max_length=64, blank=True)
