import unittest
from utils.text import extract_title_from_html, clean_title_for_filename, format_speed

class TestTextUtils(unittest.TestCase):
    def test_format_speed_bytes(self):
        self.assertEqual(format_speed(500), "500.00B/s")

    def test_format_speed_kib(self):
        self.assertEqual(format_speed(2048), "2.00KiB/s")

    def test_format_speed_mib_matches_ytdlp_style(self):
        # 5.81 MiB/s, same convention yt-dlp itself uses (binary units)
        self.assertEqual(format_speed(5.81 * 1024 * 1024), "5.81MiB/s")

    def test_format_speed_gib(self):
        self.assertEqual(format_speed(2.5 * 1024 * 1024 * 1024), "2.50GiB/s")

    def test_format_speed_zero_or_none_returns_placeholder(self):
        self.assertEqual(format_speed(0), "--")
        self.assertEqual(format_speed(None), "--")
        self.assertEqual(format_speed(-5), "--")

    def test_clean_title_for_filename(self):
        # Test valid title
        self.assertEqual(clean_title_for_filename("Normal Title"), "Normal Title")
        
        # Test title with invalid characters
        self.assertEqual(clean_title_for_filename('Title with /\\:*?"<>| chars'), 'Title with  chars')
        
        # Test title with newlines and tabs
        self.assertEqual(clean_title_for_filename("Title\nwith\r\nnewlines\tand tabs"), "Titlewithnewlinesand tabs")
        
        # Test long title truncation
        long_title = "a" * 200
        self.assertEqual(len(clean_title_for_filename(long_title, max_length=150)), 150)

    def test_extract_title_from_html(self):
        html_with_og = '''
        <html>
            <head>
                <meta property="og:title" content="OG Title Here">
                <title>Title Tag Here</title>
            </head>
        </html>
        '''
        # Should prioritize og:title
        self.assertEqual(extract_title_from_html(html_with_og, "Default"), "OG Title Here")
        
        html_with_title = '''
        <html>
            <head>
                <title>Title Tag Here</title>
            </head>
        </html>
        '''
        # Should fallback to <title>
        self.assertEqual(extract_title_from_html(html_with_title, "Default"), "Title Tag Here")
        
        html_without_title = '''
        <html>
            <head>
            </head>
        </html>
        '''
        # Should use default name if no title found
        self.assertEqual(extract_title_from_html(html_without_title, "Default"), "Default")

if __name__ == '__main__':
    unittest.main()
