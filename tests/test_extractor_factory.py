import unittest
from extractors.factory import ExtractorFactory
from extractors.ytdlp_default import YtDlpDefaultExtractor
from plugins.youtube import YoutubeExtractor

# Private, site-specific plugins (matched by .gitignore's plugins/*_private.py
# pattern) are gitignored and won't exist on a fresh clone, so they can't be
# imported here. Their factory-routing coverage lives in
# tests/test_extractor_factory_private.py, which is itself gitignored and
# only runs on a machine that also has the private plugins installed.

class TestExtractorFactory(unittest.TestCase):
    def test_factory_returns_youtube_extractor(self):
        url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        extractor = ExtractorFactory.get_extractor(url)
        self.assertIsInstance(extractor, YoutubeExtractor)

    def test_factory_returns_default_fallback_for_unknown_site(self):
        url = "https://vimeo.com/12345678"
        extractor = ExtractorFactory.get_extractor(url)
        self.assertIsInstance(extractor, YtDlpDefaultExtractor)

    def test_factory_case_insensitive(self):
        url = "HTTPS://WWW.YOUTUBE.COM/WATCH?V=DQW4W9WGXCQ"
        extractor = ExtractorFactory.get_extractor(url)
        self.assertIsInstance(extractor, YoutubeExtractor)

if __name__ == '__main__':
    unittest.main()
