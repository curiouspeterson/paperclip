# Romance Unzipped Static Homepage

This folder contains the single-file homepage for `romanceunzippedpodcast.com`.

## Files

- `index.html`: self-contained landing page with inline CSS and no build step
- `homepage-data.json`: pipeline-managed featured/recent episode data for the page

## Intent

This replaces the fragile SiteGround Website Builder flow with a repo-owned artifact that can be:

- previewed locally
- deployed directly to Vercel
- versioned like the rest of the automation stack

## Preview Locally

From the repo root:

```sh
python3 -m http.server 8787 --directory sites/romanceunzippedpodcast
```

Then open:

`http://127.0.0.1:8787`

## Live Hosting

The live site now runs through Vercel after the nameserver cutover for `romanceunzippedpodcast.com`.

Keep the page simple: one HTML file, no framework runtime, no broken external dependencies.

## Pipeline Content Sync

Completed YouTube-backed batch runs now update `homepage-data.json` automatically through:

- `bin/update_static_homepage.py`
- `bin/build_episode_batch.sh` when the batch source is a public YouTube URL
- `bin/run_latest_youtube_pipeline.py` when the latest channel upload is newly detected

The page reads that file at runtime to hydrate:

- featured episode
- embedded latest video
- recent episode list

To redeploy the live Vercel site as part of the same batch run, set:

```sh
RU_HOMEPAGE_DEPLOY=1
```

## Automatic Latest-Episode Kickoff

To resolve the latest YouTube upload and only run the batch when it is new:

```sh
python3 bin/run_latest_youtube_pipeline.py --paperclip-sync --paperclip-company-id <company-id>
```

The detector stores its last-processed state under:

`<runtime-root>/state/youtube-latest.json`
