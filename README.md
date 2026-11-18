# Conference Bingo

_This website was created because conference bingo is fun and I wanted to try vibe-coding something that is low-stakes :)_

A static bingo site for a conference. Everyone gets a random 5x5 card built from your list of terms, taps squares as they spot them, and can share their result as a Wordle-style emoji grid or as an image of their whole card. Progress is saved in the browser on each person's own device: no accounts, no logins, no cookies.

It is plain HTML, CSS and JavaScript with no build step, so it runs on GitHub Pages as it is.

## Files

| File | What it is |
| --- | --- |
| `terms.txt` | Your bingo terms, one per line. **Edit this.** |
| `logo.png` | The free centre square (your conference logo). |
| `conference_bingo_logo.png` | The wide Conference Bingo wordmark shown above the title and at the top of shared images. |
| `config.js` | Title, subtitle, logo file name, length limit for terms, share link, GitHub link, acknowledgements and GoatCounter code. |
| `index.html`, `style.css` | The page and its look (black and white with light green ticks, in light and dark). |
| `fonts/` | The Barlow Condensed font files (regular, medium, semibold, bold, extra bold), served from the site itself, plus its licence (`OFL.txt`). |
| `core.js` | Card generation, bingo detection and the emoji share text. |
| `card-image.js` | Draws the card as a PNG for "Share as image". |
| `app.js` | Saving, buttons, theme, counting and sharing. |
| `scripts/check-terms.js` | Checks `terms.txt` (see "Checking your terms"). |
| `.github/workflows/check-terms.yml` | Runs that check on GitHub whenever `terms.txt` changes. |

### Setting it up for a conference

Everything specific to one conference is in `config.js`: `edition` (the conference ID, see "Starting a new conference"), `title` (shown as the page heading, the tab title and on shared images; currently "ABACBS 2026 Bingo"), `subtitle`, `logo` and `logoAlt` (the free square), `siteLogo` and `siteLogoAlt` (the wordmark above the title; leave `siteLogo` as `""` for none), `shareUrl` (the link added to shared text), `githubUrl`, `acknowledgements` and `goatcounterCode`. Change those and `terms.txt` and `logo.png` and you have a bingo for another event.

- `githubUrl` is the address of this project's GitHub page. When it is set, a "Conference Bingo on GitHub" link appears in the footer. Leave it as `""` and the link stays hidden.
- `acknowledgements` is a list shown in an Acknowledgements section at the bottom of the page. Each entry is either plain text or `{ text: "Name", url: "https://example.org" }`. Only `http` and `https` addresses become links. Barlow Condensed (and GoatCounter, when counting is on) are credited automatically.

### Writing terms

- One term per line. Blank lines and lines starting with `#` are ignored, and duplicates are removed.
- You need at least 24 different terms. 40 or more makes cards more varied.
- Aim for 50 characters or fewer. Longer terms still work, but their text is shrunk to fit a small square, so a very long term ends up with tiny text on a phone. Very long single words shrink the text too, whatever the length of the term.

### Checking your terms

Terms longer than `maxTermLength` (50 characters by default, set in `config.js`) trigger a warning in three places:

1. **On the site itself.** Add `?check` to the address, for example `https://your-name.github.io/conference-bingo/?check`. A "Term check" box at the top lists every term that is too long, longest first, or confirms that they are all fine. Nobody sees it unless the address ends in `?check`. The browser console also lists them on every load.
2. **On your computer.** Run `node scripts/check-terms.js` in this folder. It lists too-long terms and duplicates with their line numbers, and exits with an error if there are fewer than 24 different terms.
3. **On GitHub.** The "Check terms" workflow runs the same script whenever you commit changes to `terms.txt` or `config.js`. Too-long terms show as yellow warnings on the commit (open the **Actions** tab, or look for the warning marker next to the commit). It never blocks the site from publishing.

### The logo

Replace `logo.png` with your logo, keeping the same name, or point `logo` in `config.js` at another file. A square or near-square image with a transparent or plain background, around 300 to 500 pixels across, works best. The free square always has a white background so a dark-outlined logo stays readable in dark mode, and the shared card image uses the same. If you use an SVG, give it `width` and `height` attributes, because some browsers can't draw an SVG without them into the card image.

## Starting a new conference

To give everyone a fresh start, with 0 cards completed, for the next conference:

1. **Change `edition` in `config.js`**, for example from `"abacbs-2026"` to `"abacbs-2027"`. Saved data is tagged with the edition. The next time anyone opens the site on a device that holds data from the old edition, that data (their card, personal totals and completed cards) is deleted and they get a fresh card, with a short message explaining why. Leave `edition` as `""` and nobody is ever reset.
2. **Use a new GoatCounter site** for the combined "Everyone so far" totals: create another site in your GoatCounter account and put its code in `goatcounterCode`. It starts at 0, and the old site keeps last year's numbers. (I haven't checked whether GoatCounter can clear the counts on an existing site, so a new site is the safe route.)
3. Update `title`, `logoAlt`, `terms.txt` and `logo.png` as needed, then commit and push.

Things to know:

- The reset happens on each device the next time it opens the site, so people who don't come back keep their old data (only on their own device, which nobody else can see).
- Changing `edition` also clears a card someone was part-way through.
- The light/dark choice is kept, because it isn't tied to a conference.
- If you change `edition` while a conference is still running, everyone's current card and totals are wiped, so only change it between conferences.

## Try it on your computer

Browsers block a page from reading `terms.txt` when you open `index.html` directly from disk, so start a tiny local server in this folder:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000> (add `?check` to check your terms) and press Ctrl+C in the terminal to stop it. This needs Python 3. GoatCounter ignores visits from localhost, so testing this way shouldn't affect your totals.

## Publish on GitHub Pages

1. Put this folder in a GitHub repository and push it.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick your main branch and the `/ (root)` folder, and save.
4. After a minute or so the site is live at `https://YOUR-NAME.github.io/REPOSITORY-NAME/`.

To change the terms later, edit `terms.txt` on GitHub (the pencil icon) and commit. Cards already in play don't change; the new terms appear on people's next new card.

## How it behaves

- **Cards.** Each card stores its actual terms, so editing `terms.txt` never changes a card someone is part-way through.
- **New card.** If the current card has any marked squares, a warning asks first. After a new card appears there is an Undo link for 10 seconds. Totals are kept when a card is replaced.
- **Bingos.** Every completed row, column or diagonal is a bingo, so one card can have several (up to 12). The squares in completed lines get the word BINGO beside their tick (borders stay thin), and an orange banner above the card shows "BINGO!" or "3 BINGOS!" (the shared image has the same orange bar). Each line is counted once per card: unticking a square and re-ticking it doesn't count the line again.
- **Look.** Square corners and a clean black and white design on a near-white background, with ticked squares in light green (and a tick mark, so marking never relies on colour alone). Buttons and squares react when the pointer is over them. The font is Barlow Condensed, served from the site's own `fonts/` folder, so visitors' browsers never contact Google Fonts. Barlow Condensed is under the SIL Open Font Licence (`fonts/OFL.txt`).
- **Theme.** The "Theme" button at the top cycles Auto, Light and Dark. Auto follows the device's setting, and Dark inverts the black and white. The choice is remembered on the device.
- **Completed cards.** When every square on a card is ticked, the card is saved on the device and listed under "Completed cards" with the date. "View" shows it again and offers "Share as image". Getting a new card after finishing one doesn't need a warning about losing progress: the dialog and the message afterwards say the finished card still counts and stays saved.
- **Sharing as emoji.** The result looks like this:

  ```
  ABACBS 2026 Bingo 14/25
  2 BINGOS!

  ⬜🟩⬜⬜⬜
  ⬜⬜🟩⬜⬜
  🟩🟩⭐🟩🟩
  ⬜⬜🟩⬜⬜
  ⬜⬜⬜⬜⬜

  My cards: 3 played · 5 bingos · 1 full
  Everyone so far: 140 players · 200 cards played · 312 bingos · 41 full cards
  your-name.github.io/conference-bingo/
  ```

  The "My cards" line appears once someone has played two or more cards. The "Everyone so far" line appears only when the combined totals could be fetched.
- **Sharing as an image.** "Share as image" draws the whole card, with every term, the marked squares, the logo and the bingo count, as a PNG. On a phone it opens the share sheet with the picture attached; on a computer (or if the share sheet isn't available) it downloads the file. The image is always drawn in the light look (white squares, light green ticks) so it reads well in any chat app. It shows the terms, so it gives away what was on the card.
- **Clearing everything.** The "Clear all my cards" button at the bottom of the page (after two confirmations: "Clear everything", then "Are you sure?") deletes the current card, personal totals and completed cards from that device and deals a fresh card. The light/dark choice is kept, and so is a single "this device has played" marker so the combined players count doesn't count the device twice. Anonymous counts already sent to GoatCounter can't be taken back.
- **Saved data.** Everything is in the browser's `localStorage`: the current card, totals and completed cards under `conference-bingo:v1`, and the theme choice under `conference-bingo:theme`. It stays on that browser and device. Clearing site data removes it, and Safari can clear it for sites not visited for about a week.

## Combined totals with GoatCounter (optional)

The "Everyone so far" totals use [GoatCounter](https://www.goatcounter.com/): free for non-commercial use, no cookies, and nothing that identifies a person. If you skip this (leave `goatcounterCode` as `""` in `config.js`), the site works exactly the same and simply doesn't show combined totals.

1. Create a free account at goatcounter.com and pick a site code. The code is the first part of your address: for `https://conferencebingo.goatcounter.com` it is `conferencebingo`.
2. In GoatCounter, open **Settings** and turn on **Allow adding visitor counts on your website**. It is off by default, and the combined totals can't be read without it.
3. Put the code in `config.js`: `goatcounterCode: "conferencebingo"`. Commit and push. (You don't need GoatCounter's own `<script>` snippet; the site loads it for you.)
4. Play a card, get a bingo, then (GoatCounter caches counts for up to four hours) check that `https://conferencebingo.goatcounter.com/counter/card-started.json` returns something like `{"count":"3"}`.

What gets counted. Each of these is sent as a GoatCounter event:

| Event | Sent when | Shown as |
| --- | --- | --- |
| `new-player` | The first time a device marks any square | Players |
| `card-started` | The first time each card gets a marked square (so a player with several cards counts for each) | Cards played |
| `bingo` | Each time a line is completed for the first time on a card | Bingos |
| `full-card` | The first time every square on a card is marked | Full cards |

Things to know:

- **Honour system.** The counts are self-reported and anyone technical could inflate them. They are indicative, not exact.
- **Players are devices, not people.** Someone who clears their browser data, or uses two devices, counts again.
- **Delays.** GoatCounter caches the public counts for up to four hours, so the totals lag behind.
- **Privacy.** If a browser sends "Do Not Track" or Global Privacy Control, the GoatCounter script is never loaded, nothing is sent, and the combined totals are not fetched for that visitor.
- **Please check this one.** GoatCounter's documentation describes the public counter for pages. It doesn't say outright that it works for event names such as `card-started`, so do step 4 above before the conference. If it returns an error, the rest of the site is unaffected and the combined totals just stay hidden.
