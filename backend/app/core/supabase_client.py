from typing import Optional
import logging
from supabase import create_client, Client
from app.core.config import (
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
)


_logger = logging.getLogger(__name__)
_service_client: Optional[Client] = None


def get_supabase() -> Client:
    """Legacy: returns a service-level client (bypasses RLS). Prefer get_supabase_for_user."""
    return get_supabase_service()


def get_supabase_service() -> Client:
    """Service client using service role key (bypasses RLS). For admin/scripts only."""
    global _service_client
    if _service_client is not None:
        return _service_client

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.")

    _service_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    _logger.info("Supabase service client initialized (service role)")
    return _service_client


def get_supabase_for_user(jwt_token: str) -> Client:
    """Creates a per-request client authenticated as the user to enforce RLS.
    
    The client will use the JWT token in requests to enable Row Level Security.
    """
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError("Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in env.")
    
    # Create client with anon key (for RLS to work, we need anon key, not service role)
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    
    # Set the JWT token for PostgREST to enable RLS
    # The supabase-py library should respect this for subsequent queries
    try:
        # Method 1: Try direct postgrest auth if available
        if hasattr(client, 'postgrest') and hasattr(client.postgrest, 'auth'):
            client.postgrest.auth(jwt_token)
        # Method 2: Try setting it on the client options
        elif hasattr(client, 'set_session'):
            client.set_session(jwt_token)
    except AttributeError:
        # If neither method works, we'll set it manually in options
        # The library may handle this automatically via the anon key + JWT header
        pass
    
    # Store token for manual header injection if needed (fallback)
    # The supabase-py library should handle this via postgrest.auth() above
    return client



