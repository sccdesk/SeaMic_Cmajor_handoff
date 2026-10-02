// Visual QA: render the assembled HTML in the same engine used for printing and capture
// two regions (title page + the results table with symbols) so glyphs can be inspected.
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--no-first-run'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1150, deviceScaleFactor: 2 });
  await page.goto('file:///C:/Users/engcouce/Documents/Cmajor/report/SeaTime_DSP_Report.html', {
    waitUntil: 'networkidle0',
  });

  await page.screenshot({ path: 'qa_title.png' });

  const handle = await page.evaluateHandle(() => {
    const tables = [...document.querySelectorAll('table')];
    return tables.find((t) => t.textContent.includes('True peak'));
  });
  if (handle && handle.asElement()) {
    await handle.asElement().screenshot({ path: 'qa_table.png' });
    console.log('table captured');
  } else {
    console.log('table not found');
  }

  const fig = await page.evaluateHandle(() => {
    const figs = [...document.querySelectorAll('figure')];
    return figs.find((f) => f.textContent.includes('Figure 2'));
  });
  if (fig && fig.asElement()) {
    await fig.asElement().screenshot({ path: 'qa_fig2.png' });
    console.log('fig2 captured');
  } else console.log('fig2 not found');

  await browser.close();
  console.log('QA_SHOTS_DONE');
})().catch((e) => {
  console.error('QA_FAILED: ' + e.message);
  process.exit(1);
});
