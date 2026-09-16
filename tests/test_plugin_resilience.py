import unittest
import os
import tempfile
from extractors.factory import ExtractorFactory
from extractors.ytdlp_default import YtDlpDefaultExtractor

class TestPluginResilience(unittest.TestCase):
    def test_broken_plugin_does_not_crash_factory(self):
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        plugins_dir = os.path.join(project_root, "plugins")
        
        # Create a temporary broken plugin
        broken_plugin_path = os.path.join(plugins_dir, "_test_temp_broken_plugin.py")
        try:
            with open(broken_plugin_path, "w") as f:
                f.write("this is invalid python syntax %%% @@@")
                
            # Reset loaded state
            ExtractorFactory._plugins_loaded = False
            
            # Discovery should not raise an exception
            extractor = ExtractorFactory.get_extractor("https://some-unknown-site.com/video")
            self.assertIsInstance(extractor, YtDlpDefaultExtractor)
        finally:
            if os.path.exists(broken_plugin_path):
                os.remove(broken_plugin_path)
            # Reset back to clean state
            ExtractorFactory._plugins_loaded = False

if __name__ == '__main__':
    unittest.main()
