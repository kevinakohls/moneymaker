# Moneymaker!

*A BufferLogic Learning Experience*

**Five machines. Twenty days. Can you improve factory profitability?**

Play: https://kevinakohls.github.io/moneymaker/

Moneymaker is a free factory simulation. Five machines work in a line, each with hidden dice-like variation. Watch where inventory piles up, find the constraint, choose the right improvement, and finish day 20 with the most net profit (Throughput Accounting).

- Everything is in a single `index.html`: no build step, no server, no accounts.
- Scores are saved only in your browser.
- To play offline, download `index.html` and open it in any browser.

## Tests

`tests/moneymaker-tests.mjs` is an automated Playwright test suite. It checks material conservation, that one 7-day advance equals seven 1-day advances, the day-20 boundary, the replay modes, that the animation matches the simulation, and layouts from desktop to phone. Edit the two file paths at the top, then:

```
npm i playwright && npx playwright install chromium
node tests/moneymaker-tests.mjs
```
