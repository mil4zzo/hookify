from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import StreamingResponse
from typing import Dict, Any
import logging
import requests
import json
import asyncio
from app.services.graph_api import GraphAPI
from app.schemas import AdsRequestFrontend, VideoSourceRequest, ErrorResponse, FacebookTokenRequest
from app.core.config import FACEBOOK_CLIENT_ID, FACEBOOK_CLIENT_SECRET, FACEBOOK_TOKEN_URL, FACEBOOK_AUTH_BASE_URL
from fastapi import Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/facebook", tags=["facebook"])
@router.get("/auth/url")
def get_auth_url(redirect_uri: str = Query(..., description="Frontend OAuth redirect URI")):
    """Generate Facebook OAuth authorization URL."""
    try:
        if not FACEBOOK_CLIENT_ID:
            raise HTTPException(status_code=500, detail="Facebook OAuth not configured. Missing CLIENT_ID.")

        params = {
            "client_id": FACEBOOK_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            # scopes mínimos necessários podem ser ajustados conforme necessidade
            "scope": "public_profile,email,ads_read,ads_management",
        }
        # Montar URL
        from urllib.parse import urlencode

        auth_url = f"{FACEBOOK_AUTH_BASE_URL}?{urlencode(params)}"
        return {"auth_url": auth_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error generating auth URL")
        raise HTTPException(status_code=500, detail=str(e))

def get_graph_api(authorization: str = Header(..., alias="Authorization")) -> GraphAPI:
    """Extract Bearer token from Authorization header and create GraphAPI instance."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.replace("Bearer ", "")
    if not token:
        raise HTTPException(status_code=401, detail="Empty access token")
    return GraphAPI(token)

@router.get("/me")
def get_me(api: GraphAPI = Depends(get_graph_api)):
    """Get Facebook user account info."""
    try:
        result = api.get_account_info()
        if result["status"] != "success":
            raise HTTPException(status_code=400, detail=result["message"])
        return result["data"]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in /me endpoint")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/adaccounts")
def get_adaccounts(api: GraphAPI = Depends(get_graph_api)):
    """Get Facebook ad accounts."""
    try:
        result = api.get_adaccounts()
        if result["status"] != "success":
            raise HTTPException(status_code=400, detail=result["message"])
        return result["data"]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in /adaccounts endpoint")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ads-progress")
def get_ads_progress(request: AdsRequestFrontend, api: GraphAPI = Depends(get_graph_api)):
    """Start ads job and return job_id for progress tracking."""
    try:
        logger.info("=== ADS PROGRESS REQUEST DEBUG ===")
        logger.info(f"Request: {request}")
        
        # Converter formato do frontend para formato esperado pelo GraphAPI
        time_range_dict = {
            "since": request.date_start,
            "until": request.date_stop
        }
        filters_list = []
        
        # Converter filtros do frontend para o formato esperado pelo GraphAPI
        for filter_rule in request.filters:
            filters_list.append({
                "field": filter_rule.field,
                "operator": filter_rule.operator,
                "value": filter_rule.value
            })
        
        logger.info(f"Converted filters: {filters_list}")
        
        # Iniciar job e retornar job_id
        job_id = api.start_ads_job(request.adaccount_id, time_range_dict, filters_list)
        
        if isinstance(job_id, dict) and "status" in job_id:
            logger.error(f"GraphAPI returned error: {job_id}")
            raise HTTPException(status_code=502, detail=job_id["message"])
        
        return {"job_id": job_id, "status": "started", "message": "Job iniciado com sucesso"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in /ads-progress endpoint")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/ads-progress/{job_id}")
def get_job_progress(job_id: str, api: GraphAPI = Depends(get_graph_api)):
    """Get progress of ads job."""
    try:
        progress = api.get_job_progress(job_id)
        return progress
    except Exception as e:
        logger.exception("Error getting job progress")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/video-source")
def get_video_source(
    video_id: str, 
    actor_id: str, 
    api: GraphAPI = Depends(get_graph_api)
):
    """Get Facebook video source URL."""
    try:
        result = api.get_video_source_url(video_id, actor_id)
        
        # Check if result is an error dict
        if isinstance(result, dict) and "status" in result:
            raise HTTPException(status_code=400, detail=result["message"])
        
        return {"source_url": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in /video-source endpoint")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/auth/token")
def exchange_code_for_token(request: FacebookTokenRequest):
    """Exchange Facebook authorization code for access token."""
    try:
        # Validate required config
        if not FACEBOOK_CLIENT_ID or not FACEBOOK_CLIENT_SECRET:
            raise HTTPException(
                status_code=500, 
                detail="Facebook OAuth not configured. Missing CLIENT_ID or CLIENT_SECRET."
            )
        
        # Exchange code for token
        params = {
            'client_id': FACEBOOK_CLIENT_ID,
            'client_secret': FACEBOOK_CLIENT_SECRET,
            'redirect_uri': request.redirect_uri,
            'code': request.code
        }
        
        # Log dos parâmetros para debug
        logger.info(f"Token exchange params: client_id={FACEBOOK_CLIENT_ID}, redirect_uri={request.redirect_uri}")
        logger.info(f"Code length: {len(request.code) if request.code else 0}")
        
        response = requests.get(FACEBOOK_TOKEN_URL, params=params)
        
        # Log da resposta para debug
        logger.info(f"Facebook token exchange response: {response.status_code}")
        logger.info(f"Response content: {response.text}")
        
        if response.status_code != 200:
            logger.error(f"Facebook API error: {response.status_code} - {response.text}")
            raise HTTPException(
                status_code=502,
                detail=f"Facebook API error: {response.status_code} - {response.text}"
            )
        
        token_data = response.json()
        
        # Check for Facebook API errors
        if 'error' in token_data:
            raise HTTPException(
                status_code=400,
                detail=f"Facebook OAuth error: {token_data['error'].get('message', 'Unknown error')}"
            )
        
        access_token = token_data.get('access_token')
        if not access_token:
            raise HTTPException(
                status_code=400,
                detail="No access token received from Facebook"
            )
        
        # Validate the token by getting user info
        try:
            api = GraphAPI(access_token)
            user_info = api.get_account_info()
            if user_info["status"] != "success":
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid access token: {user_info['message']}"
                )
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Token validation failed: {str(e)}"
            )
        
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": token_data.get('expires_in'),
            "user_info": user_info["data"]
        }
        
    except HTTPException:
        raise
    except requests.exceptions.RequestException as e:
        logger.exception("Error exchanging code for token")
        raise HTTPException(status_code=502, detail=f"Facebook API error: {str(e)}")
    except Exception as e:
        logger.exception("Unexpected error in token exchange")
        raise HTTPException(status_code=500, detail=str(e))
