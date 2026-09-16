#!/usr/bin/env python3
import argparse
import sys
import os
from pathlib import Path

# Add project root to sys.path so we can import modules
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from services.download_service import DownloadService
from utils.logger import Logger
from rich.progress import Progress, BarColumn, TextColumn, SpinnerColumn

def parse_args():
    parser = argparse.ArgumentParser(
        description="Modular CLI video download tool with dynamic plugin architecture.",
        epilog="Example: uv run main.py --url https://www.youtube.com/watch?v=example -c 4"
    )
    
    parser.add_argument(
        "--url", 
        "-u",
        required=True, 
        help="URL of the video page or playlist to download."
    )
    
    parser.add_argument(
        "--concurrency", 
        "-c",
        type=int, 
        default=4, 
        help="Number of concurrent download fragments (default: 4). Decrease if rate-limited."
    )
    
    parser.add_argument(
        "--output", 
        "-o",
        type=str, 
        default=None, 
        help="Directory to save the video. Defaults to the system's Downloads/downloader folder."
    )
    
    parser.add_argument(
        "--format", 
        "-f",
        type=str, 
        default=None, 
        help="Format ID to download (e.g. 'best', '720p', etc). If provided, skips interactive prompt."
    )
    
    parser.add_argument(
        "--no-interactive", 
        action="store_true", 
        help="Disable interactive mode completely."
    )
    
    parser.add_argument(
        "--debug",
        "-d",
        action="store_true",
        help="Enable full debug logging to file."
    )

    return parser.parse_args()

def main():
    args = parse_args()
    Logger.init(debug=args.debug)
    
    Logger.info(f"Processing URL: {args.url}")
    Logger.info(f"Configuration - Concurrency: {args.concurrency}")
    if args.output:
        Logger.info(f"Configuration - Output Dir: {args.output}")
    if args.format:
        Logger.info(f"Configuration - Target Format: {args.format}")
    if args.no_interactive:
        Logger.info(f"Configuration - Interactive Mode: DISABLED")
    
    interactive_mode = not args.no_interactive
    service = DownloadService()
    
    with Progress(
        SpinnerColumn(),
        TextColumn("[bold cyan]{task.description}[/bold cyan]"),
        BarColumn(bar_width=25, complete_style="green", finished_style="bold green"),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TextColumn("•"),
        TextColumn("[yellow]{task.fields[speed]}[/yellow]"),
        TextColumn("•"),
        TextColumn("[magenta]{task.fields[eta]}[/magenta]"),
        console=Logger._console,
        transient=True
    ) as progress_context:
        current_task = None
        
        def cli_progress_handler(data: dict):
            nonlocal current_task
            status = data.get("status")
            if status == "preparing" or status == "extracting" or current_task is None:
                if current_task is not None:
                    progress_context.remove_task(current_task)
                current_task = progress_context.add_task(
                    data.get("description", "Preparing..."), 
                    total=100, 
                    speed="--", 
                    eta="--"
                )
            else:
                progress_context.update(
                    current_task,
                    completed=data.get("completed", 0.0),
                    speed=data.get("speed", "--"),
                    eta=data.get("eta", "--"),
                    description=data.get("description", "")
                )

        success = service.process_url(
            url=args.url, 
            concurrency=args.concurrency, 
            output_dir=args.output,
            interactive=interactive_mode,
            format_id=args.format,
            progress_callback=cli_progress_handler
        )
    
    if not success:
        sys.exit(1)
        
if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        Logger.warning("\nProcess cancelled by user (Ctrl+C). Exiting...")
        sys.exit(130)
    except Exception as e:
        Logger.error(f"Unhandled exception: {e}", exc_info=True)
        sys.exit(1)
