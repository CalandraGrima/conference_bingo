# Conference Bingo

_This website was created because having a silly conference bingo is fun and I wanted to try vibe-coding something that is low-stakes :)_

A static bingo site for a conference. Everyone gets a random 5x5 card built from a premade list of terms (or their own), taps squares as they spot them, and can share the result as a Wordle-style emoji grid or as an image of the whole card. Progress is saved in the browser on each person's own device: no accounts, no logins, no cookies. It is plain HTML, CSS and JavaScript with no build step, so it runs on GitHub Pages as it is.

## Choosing a list, seeds and printing

- **Premade lists.** Each conference has its own list of terms and its own centre-square logo. The "Choose your list" drop-down shows each list by its name, so earlier conferences stay available when new ones are added.
- **My own list.** Anyone can pick "My own list" at the bottom of that drop-down, type or paste squares (one per line, at least 24 different ones) and make a card from them. Cards from a typed list say FREE in the centre instead of a logo, and the page heading and shared images use `customTitle` from `config.js`.
- **Seed (optional).** The seed box is at the top of the page. Type any word and "New card" (and "New card from this list") gives the same card every time for that list and seed, so a group can type the same word to get matching cards. Leave it empty for a random card. The seed card is also card 1 of the same seed when printing.
- **Print bingo cards.** Pick how many cards (up to 100) and how many per page (1, 2, 4 or 6) and press "Create printable cards". The browser's print window opens: choose "Save as PDF" for a PDF or pick a printer. Every card is different and in plain black and white, with the list's title above the grid. If you leave the seed empty a random one is used and shown in a message when the print window opens; type it into the seed box later to make the same stack again.

## Set it up

| File | What to change |
| --- | --- |
| `lists/lists.json` | One entry per premade conference list: `id`, `name` (shown in the drop-down), `title` (page heading and shared images), `terms` (the terms file, inside `lists/`), `logo` (the centre-square image, inside `lists/`) and `logoAlt`. `default` is the list dealt to new visitors. |
| `lists/<id>.txt` | The bingo terms for that conference, one per line. You need at least 24 different ones. Blank lines and `#` comments are ignored. Aim for 50 characters or fewer, because longer terms get tiny text on a phone. |
| `lists/<id>.png` | The free centre square for that conference. A near-square image around 300 to 500 pixels works best. |
| `config.js` | Everything else specific to the site: `edition`, `title` (heading before a card is dealt), `customTitle` (heading for typed-in lists), `tabTitle` (browser tab text), `subtitle`, `siteLogo`, `githubUrl`, `acknowledgements` and `goatcounterCode`. Each setting has a comment. |
| `favicon.png` | The browser tab icon (set in `index.html`): a square crop of `conference_bingo_icon.png`. Replace it with any square image. |
| `conference_bingo_logo.png` | The wide wordmark above the title, on shared images and at the top of printed cards (`siteLogo` in `config.js`; set it to `""` for none). |

Check every list with `node scripts/check-terms.js`, by adding `?check` to the site address (it checks the list that loads), or in the "Check terms" GitHub Action, which runs when anything in `lists/` changes. All of them warn about terms over `maxTermLength`.

## Run it locally

Browsers won't let a page read the lists when opened straight from disk, so start a small server in this folder (needs Python 3) and open <http://localhost:8000>:

```
python3 -m http.server 8000
```

## Publish

Push the folder to a GitHub repository, then go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save. The site appears at `https://YOUR-NAME.github.io/REPOSITORY-NAME/` after a minute or two.

## Next conference

1. Add the new list: put `lists/<id>.txt` (the terms) and `lists/<id>.png` (the logo) in the `lists/` folder and add an entry for it to `lists/lists.json`. Old lists can stay, so people can still pick them, or you can delete them. Set `default` to the new one.
2. Change `edition` in `config.js` (for example `"abacbs-2026"` to `"abacbs-2027"`). The next time anyone opens the site, their old card, totals and completed cards on that device are deleted and they start from 0. The light/dark choice and any list they typed in are kept, and a blank `edition` never resets anyone.
3. Create a new GoatCounter site and put its code in `goatcounterCode`, so the combined totals start from 0.
4. Commit and push.

Only change `edition` between conferences, because it wipes everyone's current card too.

## How it works

- **Bingos.** Every completed row, column or diagonal is a bingo, so a card can have several. Squares in a completed line show the word BINGO, and an orange banner shows "BINGO!" or "3 BINGOS!". A full card gets a green banner.
- **New card.** Unlimited rerolls, with a warning if the card has marked squares and a 10-second Undo. Totals are kept.
- **Completed cards.** A finished card is saved on the device and listed at the bottom, where it can be viewed and shared as an image or as an emoji grid.
- **Zoom.** Press and hold a square (about half a second) to see it enlarged; let go to close it. Letting go after a hold does not tick the square.
- **Clear all my cards.** A button at the bottom, after two confirmations, deletes the card, totals and completed cards from that device.
- **Saved data.** Everything is in the browser's `localStorage` (`conference-bingo:v1`, `conference-bingo:prefs` for the chosen list, typed-in list and seed, and `conference-bingo:theme`). Clearing site data removes it, and Safari can clear it for sites not visited for about a week.
- **Theme.** The Theme button cycles Auto, Light and Dark.
- **Fonts.** Barlow Condensed is served from `fonts/` (SIL Open Font Licence, `fonts/OFL.txt`), so visitors never contact Google Fonts.

## Combined totals (optional)

The "Everyone so far" totals use [GoatCounter](https://www.goatcounter.com/), which is free for non-commercial use and sets no cookies. Leave `goatcounterCode` as `""` to turn counting off; the site works the same without it.

1. Create a GoatCounter site and put its code (the first part of `CODE.goatcounter.com`) in `goatcounterCode`.
2. In GoatCounter, turn on **Settings → Allow adding visitor counts on your website**.
3. After some play, check that `https://CODE.goatcounter.com/counter/card-started.json` returns a count. GoatCounter's documentation doesn't say outright that this works for event names, so check it before the conference. If it fails, the totals just stay hidden.

Anonymous events are sent for: `new-player`, `card-started`, `bingo` (one per completed line), `full-card`, and `squares-2` to `squares-25` (a card sends each one the first time it reaches that many marked squares, counting the free space as 1). The "Most squares on a card" total is the highest `squares-N` that has a count, so check that `https://CODE.goatcounter.com/counter/squares-2.json` returns a count after some play. The counts are self-reported, "players" means devices, and totals can lag by up to four hours. If a browser sends Do Not Track or Global Privacy Control, nothing is loaded or sent for that visitor.
