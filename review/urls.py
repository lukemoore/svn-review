from django.urls import path
from django.contrib.staticfiles.views import serve

from . import views

urlpatterns = [
    path('', views.index),
    path('api/<str:action>/', views.api),
    path('static/<path:path>', serve, {'insecure': True}),
]
