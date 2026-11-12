import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / 'var'
DATA_DIR.mkdir(exist_ok=True)
# This local app has no sessions or persistent signed values.
SECRET_KEY = secrets.token_urlsafe(50)
DEBUG = False
ALLOWED_HOSTS = ['127.0.0.1', 'localhost', '[::1]']
INSTALLED_APPS = ['django.contrib.staticfiles', 'review']
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
]
ROOT_URLCONF = 'review.urls'
DATABASES = {'default': {
    'ENGINE': 'django.db.backends.sqlite3',
    'NAME': DATA_DIR / 'reviews.sqlite3',
    'OPTIONS': {'timeout': 20},
}}
TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'APP_DIRS': True,
}]
STATIC_URL = '/static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
USE_TZ = True
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
