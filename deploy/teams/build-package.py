#!/usr/bin/env python3
"""Builds the Miroclone Teams app package (miroclone-teams.zip) from manifest.template.json.

Usage:
  python3 build-package.py --app-url https://board.example.internal --entra-client-id <GUID> \
      --organisation "Example Agency" [--teams-app-id <GUID>] [--out miroclone-teams.zip]

The package holds the manifest and two generated icons. It uses only the Python standard library.
"""
import argparse, json, re, struct, sys, uuid, zipfile, zlib
from pathlib import Path
from urllib.parse import urlparse

GUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def png(size, pixels):
    """Writes a PNG. `pixels(x, y)` returns an (r, g, b, a) tuple."""
    raw = b"".join(b"\x00" + b"".join(bytes(pixels(x, y)) for x in range(size)) for y in range(size))
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def colour_icon(x, y, n=192):
    # A blue square with a white board outline, in a margin of one eighth of the size.
    m = n // 8
    edge = m <= x < n - m and m <= y < n - m and (x < m + 6 or x >= n - m - 6 or y < m + 6 or y >= n - m - 6)
    return (255, 255, 255, 255) if edge else (21, 101, 192, 255)


def outline_icon(x, y, n=32):
    # Teams wants a white outline on a transparent background.
    edge = 4 <= x < n - 4 and 4 <= y < n - 4 and (x < 6 or x >= n - 6 or y < 6 or y >= n - 6)
    return (255, 255, 255, 255) if edge else (0, 0, 0, 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app-url", required=True, help="The address people use to open Miroclone, such as https://board.example.internal")
    ap.add_argument("--entra-client-id", required=True, help="The Entra app registration's client ID, as in the chart's entra.clientId")
    ap.add_argument("--organisation", required=True)
    ap.add_argument("--teams-app-id", help="A GUID for the Teams app. Keep the same one for every later version. A new one is made if you leave it out.")
    ap.add_argument("--out", default="miroclone-teams.zip")
    a = ap.parse_args()

    url = urlparse(a.app_url)
    if url.scheme != "https" or not url.hostname:
        sys.exit("--app-url must be an https:// address.")
    if not GUID.match(a.entra_client_id):
        sys.exit("--entra-client-id must be a GUID.")
    if a.teams_app_id and not GUID.match(a.teams_app_id):
        sys.exit("--teams-app-id must be a GUID.")
    teams_id = a.teams_app_id or str(uuid.uuid4())

    values = {"TEAMS_APP_ID": teams_id, "ORGANISATION": a.organisation, "APP_URL": a.app_url.rstrip("/"), "APP_HOST": url.hostname, "ENTRA_CLIENT_ID": a.entra_client_id}
    text = (Path(__file__).parent / "manifest.template.json").read_text()
    for k, v in values.items():
        text = text.replace("{{" + k + "}}", v)
    json.loads(text)  # Fails here, not in Teams, if a value broke the JSON.

    with zipfile.ZipFile(a.out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", text)
        z.writestr("color.png", png(192, colour_icon))
        z.writestr("outline.png", png(32, outline_icon))
    print(f"Wrote {a.out}. Teams app ID: {teams_id}")


if __name__ == "__main__":
    main()
