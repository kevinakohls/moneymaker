# Moneymaker!

*A BufferLogic Learning Experience*

**Five machines. Six months. Can you improve factory profitability?**

Play: https://kevinakohls.github.io/moneymaker/

Moneymaker is a free factory simulation. Five machines work in a line, each with hidden dice-like daily variation. You choose one report to manage by (average throughput, standalone throughput, or OEE), then run the plant week by week for six months. Watch where inventory piles up, find the constraint, buy the right improvements, and finish with the most net profit, scored with Throughput Accounting.

- Everything is in a single `index.html`: no build step, no server, no accounts.
- Scores are saved only in your browser.
- To play offline, download `index.html` and open it in any browser.

## Tests

`moneymaker-tests.mjs` is an automated Playwright test suite. It checks material conservation, that one month equals four one-week advances, the week-24 boundary, the report chooser, Undo, the replay modes, that the animation matches the simulation, and layouts from desktop to phone. Edit the two file paths at the top, then:

```
npm i playwright && npx playwright install chromium
node moneymaker-tests.mjs
```
