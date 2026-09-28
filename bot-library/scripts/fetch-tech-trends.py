#!/usr/bin/env python3
"""
Zero-Cost Tech & AI Trends Scraper
Fetches realtime trending topics from HackerNews, GitHub, and arXiv using only Python standard library.
No API keys or paid subscriptions required.
"""

import argparse
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

HEADERS = {"User-Agent": "RakazoTrendScout/1.0 (Mozilla/5.0 compatible)"}


def fetch_json(url: str, timeout: int = 10):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_xml(url: str, timeout: int = 10):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def get_hackernews(limit: int = 5):
    items = []
    try:
        top_ids = fetch_json("https://hacker-news.firebaseio.com/v0/topstories.json")[:limit]
        for item_id in top_ids:
            try:
                story = fetch_json(f"https://hacker-news.firebaseio.com/v0/item/{item_id}.json")
                if story and story.get("type") == "story":
                    items.append({
                        "source": "HackerNews",
                        "title": story.get("title", ""),
                        "url": story.get("url") or f"https://news.ycombinator.com/item?id={item_id}",
                        "score": story.get("score", 0),
                        "comments": story.get("descendants", 0),
                        "timestamp": story.get("time", int(datetime.now(timezone.utc).timestamp())),
                    })
            except Exception:
                continue
    except Exception as e:
        sys.stderr.write(f"HN fetch error: {e}\n")
    return items


def get_arxiv_ai(limit: int = 5):
    items = []
    try:
        url = f"http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results={limit}"
        xml_data = fetch_xml(url)
        root = ET.fromstring(xml_data)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall("atom:entry", ns):
            title = entry.find("atom:title", ns)
            summary = entry.find("atom:summary", ns)
            link = entry.find("atom:id", ns)
            published = entry.find("atom:published", ns)
            title_text = " ".join(title.text.strip().split()) if title is not None and title.text else ""
            summary_text = " ".join(summary.text.strip().split()) if summary is not None and summary.text else ""
            items.append({
                "source": "arXiv CS.AI",
                "title": title_text,
                "url": link.text.strip() if link is not None and link.text else "",
                "summary": summary_text[:300] + ("..." if len(summary_text) > 300 else ""),
                "published": published.text.strip() if published is not None and published.text else "",
            })
    except Exception as e:
        sys.stderr.write(f"arXiv fetch error: {e}\n")
    return items


def get_github_trending(limit: int = 5):
    items = []
    try:
        # Query recently updated active repos with high stars
        url = f"https://api.github.com/search/repositories?q=stars:>1000+pushed:>2026-09-01&sort=updated&order=desc&per_page={limit}"
        data = fetch_json(url)
        for repo in data.get("items", [])[:limit]:
            items.append({
                "source": "GitHub",
                "title": repo.get("full_name", ""),
                "url": repo.get("html_url", ""),
                "description": repo.get("description") or "",
                "stars": repo.get("stargazers_count", 0),
                "language": repo.get("language") or "Other",
            })
    except Exception as e:
        sys.stderr.write(f"GitHub fetch error: {e}\n")
    return items


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Fetch zero-cost tech & AI trends")
    parser.add_argument("--limit", type=int, default=5, help="Number of items per source")
    parser.add_argument("--sources", type=str, default="hn,arxiv,github", help="Comma-separated sources")
    args = parser.parse_args()

    active_sources = [s.strip().lower() for s in args.sources.split(",")]
    results = {
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "trends": {},
    }

    if "hn" in active_sources:
        results["trends"]["hackernews"] = get_hackernews(args.limit)

    if "arxiv" in active_sources:
        results["trends"]["arxiv"] = get_arxiv_ai(args.limit)

    if "github" in active_sources:
        results["trends"]["github"] = get_github_trending(args.limit)

    print(json.dumps(results, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
