// Edit this file to customise the site. There is no build step:
// save it, commit it, and GitHub Pages will publish the change.
window.BINGO_CONFIG = {
  // Page heading before a card is dealt. Once there is a card, the heading is that list's own title
  // (see lists/lists.json), and shared results and images use it too.
  title: "Conference Bingo",
  // The text on the browser tab. Leave "" to use the title above.
  tabTitle: "Conference Bingo",
  subtitle: "Tap a square when you spot it. Complete a row, column or diagonal for a bingo!",

  // The Conference Bingo wordmark shown above the title (and at the top of shared images).
  // Leave siteLogo as "" to show no wordmark.
  siteLogo: "conference_bingo_logo.png",
  siteLogoAlt: "Conference Bingo",

  // Which conference this is. Saved cards, totals and completed cards are tagged with it, so changing it
  // (for example to "abacbs-2027") gives everyone a fresh start, with 0 cards completed, the next time they
  // open the site. Their old data on that device is deleted. Leave "" to never reset anyone.
  edition: "abacbs-2026",

  // Which premade list is dealt first, and what the premade lists are, lives in lists/lists.json
  // (one entry per conference: its terms file and its centre-square logo). See the README.

  // Heading and image title used for cards made from a list someone pasted in themselves.
  customTitle: "Conference Bingo",

  // Terms longer than this many characters trigger a warning, because they end up in small text
  // on a phone. Add ?check to the site address to see them listed, and see the README.
  maxTermLength: 50,

  // What the free square looks like in the emoji grid people share.
  freeEmoji: "⭐",

  // Link added to the bottom of shared results. Leave "" to use this page's own address.
  shareUrl: "",

  // Link to this project's page on GitHub, shown at the bottom of the site. Leave "" to hide it.
  githubUrl: "https://github.com/CalandraGrima/conference_bingo",

  // Extra thank-yous for the Acknowledgements section (Barlow Condensed and GoatCounter are already there).
  // Each one is plain text, or { text: "...", url: "https://..." } to make it a link. For example:
  //   acknowledgements: ["Bingo terms suggested by the ABACBS community", { text: "ABACBS 2026", url: "https://..." }]
  acknowledgements: ["Partners in bingo crimes: Caitlin Page and Zunair Khurram"],

  // Your GoatCounter code, e.g. "mybingo" for https://mybingo.goatcounter.com
  // Leave "" to switch all counting off (the combined totals are then hidden too).
  goatcounterCode: "conferencebingo"
};
