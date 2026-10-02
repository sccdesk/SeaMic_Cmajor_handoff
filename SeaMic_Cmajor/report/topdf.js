// Print the assembled HTML report to PDF using the locally installed Edge (Chromium) build.
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--no-first-run'],
  });
  const page = await browser.newPage();
  await page.goto('file:///C:/Users/engcouce/Documents/Cmajor/report/SeaTime_DSP_Report.html', {
    waitUntil: 'networkidle0',
  });
  await page.pdf({
    path: 'C:\\Users\\engcouce\\Documents\\Cmajor\\report\\SeaTime_DSP_Report.pdf',
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="font-size:8px; color:#666; width:100%; text-align:center; font-family:Georgia,serif;">SeaTime / SeaMic - Cmajor DSP chain: specification, implementation and debugging - page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
  });
  await browser.close();
  console.log('PDF_WRITTEN');
})().catch((e) => {
  console.error('PRINT_FAILED: ' + e.message);
  process.exit(1);
});
