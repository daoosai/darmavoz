import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import admin, app_version, auth, clients, drivers, orders, products, webhooks
from app.core.config import settings
from app.db.seed import seed_data

logger = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).resolve().parent / 'static'
WEB_DIR = Path(__file__).resolve().parent / 'web'


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        'llm_initializing',
        extra={
            'base_url': settings.LLM_BASE_URL,
            'model': settings.LLM_MODEL,
        },
    )
    if not settings.LLM_API_KEY:
        logger.warning('LLM_API_KEY is not set. AI processing will fail!')
    await seed_data()
    yield


app = FastAPI(title='Дармавоз.рф API', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        'https://darmavoz.ru',
        'https://www.darmavoz.ru',
        'http://localhost:8000',
        'http://127.0.0.1:8000',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
    ],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(auth.router, prefix='/api/v1/auth', tags=['auth'])
app.include_router(admin.router, prefix='/api/v1/admin', tags=['admin'])
app.include_router(clients.router, prefix='/api/v1/clients', tags=['clients'])
app.include_router(drivers.router, prefix='/api/v1/drivers', tags=['drivers'])
app.include_router(orders.router, prefix='/api/v1/orders', tags=['orders'])
app.include_router(products.router, prefix='/api/v1/products', tags=['products'])
app.include_router(app_version.router, prefix='/api/v1/app-version', tags=['system'])
app.include_router(webhooks.router, prefix='/api/v1/webhooks')


@app.get('/ping')
async def ping():
    return {'status': 'ok'}


@app.get('/demo', include_in_schema=False)
async def demo_page():
    return FileResponse(STATIC_DIR / 'index.html')


app.mount('/demo', StaticFiles(directory=STATIC_DIR, html=True), name='static')


@app.get('/', include_in_schema=False)
async def root():
    return FileResponse(WEB_DIR / 'index.html')


@app.get('/health')
async def health_check():
    return {
        'status': 'online',
        'project': 'Darmavoz Core API',
        'version': '0.1.0',
        'message': 'Server is running',
        'llm_configured': bool(settings.LLM_API_KEY),
    }


app.mount('/', StaticFiles(directory=WEB_DIR, html=True), name='web')
