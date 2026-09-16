import os
import sys
import importlib
import inspect
from typing import List, Type, Optional
from core.extractor import BaseExtractor
from .ytdlp_default import YtDlpDefaultExtractor
from utils import paths
from utils.logger import Logger

class ExtractorFactory:
    """
    Dynamic Plugin-Based Factory.
    Discovers and loads site extractors dynamically from the root `plugins/` directory.
    Zero domain names or private logic are hardcoded in the core.
    """
    _plugins_loaded = False
    _plugin_classes: List[Type[BaseExtractor]] = []

    @classmethod
    def _discover_plugins(cls):
        """
        Dynamically scan and import all extractor plugins from the root `plugins/` folder.
        Safely ignores failed plugins without interrupting the core application.
        """
        if cls._plugins_loaded:
            return

        cls._plugin_classes = []
        project_root = str(paths.resource_dir())
        plugins_dir = str(paths.plugins_dir())

        if not os.path.isdir(plugins_dir):
            cls._plugins_loaded = True
            return

        # Ensure project root is in sys.path for clean plugin imports
        if project_root not in sys.path:
            sys.path.insert(0, project_root)

        for filename in os.listdir(plugins_dir):
            if filename.startswith("_") or not filename.endswith(".py"):
                continue

            module_name = f"plugins.{filename[:-3]}"
            try:
                # Dynamically load the plugin module
                mod = importlib.import_module(module_name)
                
                # Inspect module for BaseExtractor implementations
                for name, obj in inspect.getmembers(mod, inspect.isclass):
                    if issubclass(obj, BaseExtractor) and obj not in (BaseExtractor,) and not inspect.isabstract(obj):
                        # Avoid registering base intermediary classes like BaseBrowserExtractor
                        if name == "BaseBrowserExtractor":
                            continue
                        cls._plugin_classes.append(obj)
                        Logger.get_logger().debug(f"Loaded plugin extractor: {obj.__name__} from {module_name}")

            except Exception as e:
                Logger.warning(f"Failed to load plugin '{filename}': {e}. Skipping plugin.")

        cls._plugins_loaded = True

    @classmethod
    def get_extractor(cls, url: str) -> BaseExtractor:
        """
        Match URL against loaded plugins. If no plugin matches or plugins directory is absent,
        safely fallback to universal YtDlpDefaultExtractor.
        """
        cls._discover_plugins()

        for extractor_cls in cls._plugin_classes:
            try:
                if extractor_cls.matches(url):
                    Logger.get_logger().debug(f"Matched URL to plugin: {extractor_cls.__name__}")
                    return extractor_cls()
            except Exception as e:
                Logger.get_logger().debug(f"Error matching extractor {extractor_cls.__name__}: {e}")

        # Universal fallback for public codebase
        return YtDlpDefaultExtractor()
