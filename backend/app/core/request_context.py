"""
Request-scoped context using ContextVar.

Set by FastAPI auth dependency (user_id) and a middleware (route path).
Read by deep services such as meta_usage_logger to attribute Meta API calls
without plumbing user_id/route through every function signature.

Background jobs that run outside an HTTP request simply read None, which is
the intended behavior — rows are still persisted with user_id NULL.
"""
from contextvars import ContextVar
from typing import Optional

current_user_id: ContextVar[Optional[str]] = ContextVar("current_user_id", default=None)
current_route: ContextVar[Optional[str]] = ContextVar("current_route", default=None)
current_page_route: ContextVar[Optional[str]] = ContextVar("current_page_route", default=None)


def get_current_user_id() -> Optional[str]:
    return current_user_id.get()


def get_current_route() -> Optional[str]:
    return current_route.get()


def get_current_page_route() -> Optional[str]:
    return current_page_route.get()
