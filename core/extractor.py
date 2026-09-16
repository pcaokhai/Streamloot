from abc import ABC, abstractmethod
from typing import Optional, List
from urllib.parse import urlparse
from .models import VideoInfo

class BaseExtractor(ABC):
    """
    Abstract base class for all Extractors and Plugins.
    Child classes must implement the extract logic.
    """
    SUPPORTED_DOMAINS: List[str] = []
    
    @classmethod
    def matches(cls, url: str) -> bool:
        """
        Check if this extractor supports the given URL.
        Defaults to checking if any SUPPORTED_DOMAINS string is present in the netloc.
        Child classes can override this method for custom routing.
        """
        if not cls.SUPPORTED_DOMAINS:
            return False
        domain = urlparse(url).netloc.lower()
        return any(d.lower() in domain for d in cls.SUPPORTED_DOMAINS)
        
    @abstractmethod
    def extract(self, url: str) -> Optional[List[VideoInfo]]:
        """
        Extract video information from URL.
        :param url: The video page URL
        :return: List of VideoInfo or None if failed
        """
        pass
