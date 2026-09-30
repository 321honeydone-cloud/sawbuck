# photo_loader

Loads the job photos for a quote from the 321honeydone Google Drive
("1. Clients", folder ID 16ir823EsHr8XcFjxJcfacNZ36wPczak5) and works out which
round of photos belongs to which quote. Built 2026-09-30.

## Files

| File | Job |
|---|---|
| `address.ts` | Street address normalization. House number exact, St/Street, Cir/Circle, Dr/Drive, Ave, Blvd, Ct, Ln, unit/apt collapse. |
| `dates.ts` | Best date per photo: EXIF (`imageMediaMetadata.time`) > filename (`PXL_` UTC, `IMG_` local, `YYYY-MM-DD_` date only) > Drive upload time (LOW). Future dates thrown out and flagged. Eastern time helpers. `BA_` and `Small/` skipped. |
| `rounds.ts` | 12 hour gap = new round. Matching: job window (after approval, up to 7 days after job complete) wins and never starts a new quote; otherwise first quote created on or after the round within 14 days (Before); otherwise a quote created before the round and not yet approved (Before). Date folder pins a round to a quote. Anything unclear goes to Needs you. |
| `folders.ts` | Client folder by exact name, PM vs flat layout, address subfolder match, `YYYY-MM-DD` date folders, `Small/` pairing. |
| `loader.ts` | Orchestrates the above for one quote. Pure with respect to Drive (takes a `DriveReader`). |
| `context.ts` | Quote windows on the property: SawBUCK estimates (statusTimes.won = approved, complete/invoiced = job done) merged with Jobber quotes when configured. |
| `jobberApi.ts` | Optional Jobber GraphQL lookup. Not live-tested. Failure = loader runs without Jobber. |
| `drive.ts` | Drive v3 REST client (service account or OAuth refresh token). Reads, plus `createFolder` and `moveFile` for the one-tap actions only. |
| `server.ts` | App glue: `loadForEstimate`, manual assignments (AppSetting `photo_assign:*`), `beforeRoundAttachments`, `sortLoosePhotos`, `setUpQuoteFolder`. |

## Where it shows up

- Quote view: `components/PhotoGallery.tsx` at the top of the estimate sheet. Rounds labeled with date and Before / Progress / After, confidence dot (green = date folder or EXIF, yellow = filename, red = upload time). Needs you cards on top.
- Auto quote: `api/chat` loads the matched Before round on a fresh build with no attachments and hands it to the Vision employee.
- Jobber push: `JobberModal` lists the Before round and puts Drive links in the copied text. Progress and After never go on the quote.
- Property address lives under the client name in the top bar (`clientAddress` on the estimate).

## Drive writes

Only two, both behind a tap: "Sort photos into date folders" (`POST /api/photos/sort`, creates the `YYYY-MM-DD` folder if missing and moves files) and "Set up folder" (`POST /api/photos/setup`, creates the PM address folder and the quote's date folder). Nothing is ever renamed or deleted.

## Configure

See `.env.production.example` (GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_OAUTH_*, optional JOBBER_*). Without Drive credentials the gallery stays hidden and the auto quote path skips photos.

## Tests

`npm test` runs `tests/photo_loader/*.test.ts` (node:test through tsx). The fixtures in `tests/photo_loader/fixtures.ts` are the real folder listings and Jobber dates captured on 2026-09-30.
