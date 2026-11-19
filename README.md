# Conference Bingo

_This website was created because having a silly conference bingo is fun and I wanted to try vibe-coding something that is low-stakes :)_

A static bingo site for a conference. Everyone gets a random 5x5 card built from a list of terms, taps squares as they spot them, and can share the result as a Wordle-style emoji grid or as an image of the whole card. Progress is saved in the browser on each person's own device: no accounts, no logins, no cookies. It is plain HTML, CSS and JavaScript with no build step, so it runs on GitHub Pages as it is.

## Set it up

| File | What to change |
| --- | --- |
| `terms.txt` | The bingo terms, one per line. You need at least 24 different ones. Blank lines and `#` comments are ignored. Aim for 50 characters or fewer, because longer terms get tiny text on a phone. |
| `config.js` | Everything specific to the conference: `edition`, `title` (page heading and shared results), `tabTitle` (browser tab text), `subtitle`, logos, `githubUrl`, `acknowledgements` and `goatcounterCode`. Each setting has a comment. |
| `favicon.png` | The browser tab icon (set in `index.html`): a square crop of `conference_bingo_icon.png`. Replace it with any square image. |
| `free_space_image.png` | The free centre square. A near-square image around 300 to 500 pixels works best. |
| `conference_bingo_logo.png` | The wide wordmark above the title and on shared images (`siteLogo` in `config.js`; set it to `""` for none). |

Check the terms with `node scripts/check-terms.js`, by adding `?check` to the site address, or in the "Check terms" GitHub Action, which runs when `terms.txt` changes. All three warn about terms over `maxTermLength`.

## Run it locally

Browsers won't let a page read `terms.txt` when opened straight from disk, so start a small server in this folder (needs Python 3) and open <http://localhost:8000>:

```
python3 -m http.server 8000
```

## Publish

Push the folder to a GitHub repository, then go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save. The site appears at `https://YOUR-NAME.github.io/REPOSITORY-NAME/` after a minute or two.

## Next conference

1. Change `edition` in `config.js` (for example `"abacbs-2026"` to `"abacbs-2027"`). The next time anyone opens the site, their old card, totals and completed cards on that device are deleted and they start from 0. The light/dark choice is kept, and a blank `edition` never resets anyone.
2. Create a new GoatCounter site and put its code in `goatcounterCode`, so the combined totals start from 0.
3. Update `title`, `terms.txt` and the logos, then commit and push.

Only change `edition` between conferences, because it wipes everyone's current card too.

## How it works

- **Bingos.** Every completed row, column or diagonal is a bingo, so a card can have several. Squares in a completed line show the word BINGO, and an orange banner shows "BINGO!" or "3 BINGOS!". A full card gets a green banner.
- **New card.** Unlimited rerolls, with a warning if the card has marked squares and a 10-second Undo. Totals are kept.
- **Completed cards.** A finished card is saved on the device and listed at the bottom, where it can be viewed and shared as an image or as an emoji grid.
- **Zoom.** Press and hold a square (about half a second) to see it enlarged; let go to close it. Letting go after a hold does not tick the square.
- **Clear all my cards.** A button at the bottom, after two confirmations, deletes the card, totals and completed cards from that device.
- **Saved data.** Everything is in the browser's `localStorage` (`conference-bingo:v1` and `conference-bingo:theme`). Clearing site data removes it, and Safari can clear it for sites not visited for about a week.
- **Theme.** The Theme button cycles Auto, Light and Dark.
- **Fonts.** Barlow Condensed is served from `fonts/` (SIL Open Font Licence, `fonts/OFL.txt`), so visitors never contact Google Fonts.

## Combined totals (optional)

The "Everyone so far" totals use [GoatCounter](https://www.goatcounter.com/), which is free for non-commercial use and sets no cookies. Leave `goatcounterCode` as `""` to turn counting off; the site works the same without it.

1. Create a GoatCounter site and put its code (the first part of `CODE.goatcounter.com`) in `goatcounterCode`.
2. In GoatCounter, turn on **Settings → Allow adding visitor counts on your website**.
3. After some play, check that `https://CODE.goatcounter.com/counter/card-started.json` returns a count. GoatCounter's documentation doesn't say outright that this works for event names, so check it before the conference. If it fails, the totals just stay hidden.

Four anonymous events are sent: `new-player`, `card-started`, `bingo` (one per completed line) and `full-card`. The counts are self-reported, "players" means devices, and totals can lag by up to four hours. If a browser sends Do Not Track or Global Privacy Control, nothing is loaded or sent for that visitor.
