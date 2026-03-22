# Romance Unzipped

Vertical content production application built on Paperclip.

## Overview

Romance Unzipped is a content production system that processes podcast/video content into multiple formats for various distribution channels.

## Structure

```
romance-unzipped/
├── pipeline/          # Content production pipeline
└── README.md          # This file
```

## Quick Start

See `pipeline/README.md` for pipeline setup and usage.

## Platform Integration

This solution uses:
- Paperclip API for content management
- Paperclip agents for automation
- Paperclip storage for assets

## Development

The pipeline can be developed independently of the platform:

```bash
cd pipeline
pip install -r requirements.txt
python run_latest_youtube_pipeline.py --dry-run
```
