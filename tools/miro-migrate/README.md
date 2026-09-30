# Miro migration tool

This tool exports boards from Miro and converts them to Miroclone board files. You run it on a machine
outside the PROTECTED environment, because only that machine can reach the Miro REST API. An administrator
then transfers the output folder through an approved path and imports it in the Miroclone admin page.

## Before you begin

You need the following:

- Node.js 22 or later, and the repository installed with `pnpm install`.
- A Miro access token with read access to the boards (`boards:read`).

## Export boards

To export boards, complete the following steps:

1. Set the token in an environment variable. The tool refuses a token on the command line, because other users can see it there.

   ```sh
   export MIRO_TOKEN=<your token>
   ```

2. Run the export for specific boards or for every board the token can read.

   ```sh
   pnpm --filter @miroclone/miro-migrate start export --out ./miro-export --board <board ID> --board <board ID>
   pnpm --filter @miroclone/miro-migrate start export --out ./miro-export --all
   ```

3. Read the report for each board, in `report.md`, before you import anything.

The following table describes the options.

| Option | Description | Default |
|---|---|---|
| `--out <folder>` | Where to write the output. Required. | None |
| `--board <id>` | A board to export. Repeat it for more boards. | None |
| `--all` | Export every board the token can read. | Off |
| `--team <id>` | With `--all`, limit the export to one team. | All teams |
| `--token-env <name>` | The environment variable that holds the token. | `MIRO_TOKEN` |
| `--api-base <url>` | The Miro API address, for a proxy. | `https://api.miro.com` |

## What the tool writes

The output folder holds a `manifest.json` file and one folder for each board. Each board folder holds the following files:

- `board.json`: The board in the Miroclone board file format.
- `report.md` and `report.json`: What converted, what changed, what became a placeholder, and what failed.
- `files/`: The board's images.

The tool never writes the token to disk.

## How items convert

The following table shows how each Miro item type converts.

| Miro item | Result | Notes |
|---|---|---|
| Sticky note | Sticky note | Keeps text, position, size, rotation, and colour. Named colours are approximate. |
| Shape | Shape | Rectangle, rounded rectangle, circle, triangle, and rhombus convert. Other shapes become rectangles, and the report says so. |
| Text | Text | Keeps size, colour, and alignment. |
| Card | Card | Keeps title, description, due date, and colour. The assignee name comes from the board members. Tags aren't migrated. |
| Frame | Frame | Items inside a frame keep their place in it. |
| Image | Image | The tool downloads the original file and checks its type by content. |
| Connector | Connector | Keeps both ends and the routing. Captions aren't migrated. |
| Anything else | Grey sticky note | The note names the original item type, such as "Unsupported Miro item: embed". |

## Import the output

To import the output, complete the following steps as a service administrator:

1. Transfer the output folder into the PROTECTED environment.
2. Open **Administration** and find **Import migrated boards**.
3. Choose the output folder.
4. For each board, check the owner email and choose the classification. The page fills the email from Miro when Miro provides it.
5. Select **Import**.

The import matches each owner's email address to an Entra ID user. If no one matches, you own the board, and you can transfer it later.
The import stores images through the same checks as a normal upload, and an image that fails a check becomes a placeholder.
Importing the same Miro board twice is refused.
