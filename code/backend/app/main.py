from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.artifacts import load_all_artifacts
from app.routers import forecast, shap, models, metadata, agent, auth

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_all_artifacts()
    yield

app = FastAPI(
    title="Rossmann Explainable DSS",
    description="Artefact-first backend for retail demand forecasting DSS",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,     prefix="/auth",     tags=["Auth"])
app.include_router(forecast.router, prefix="/forecast", tags=["Forecast"])
app.include_router(shap.router,     prefix="/shap",     tags=["SHAP"])
app.include_router(models.router,   prefix="/models",   tags=["Models"])
app.include_router(metadata.router, prefix="/metadata", tags=["Metadata"])
app.include_router(agent.router,    prefix="/agent",    tags=["Agent"])

@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok", "message": "Rossmann DSS backend is running"}
