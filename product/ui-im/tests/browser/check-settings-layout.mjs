/** Run with ego-browser nodejs; geometry comes from Chromium, never jsdom. */
const assert = (await import('node:assert/strict')).default
/** @param page - owned Ego page. @param options - fixture URL and optional evidence directory. */
export async function checkSettingsLayout(page, options) {
const { url, evidenceDirectory } = options
assert(url, 'url must name the isolated fixture server')

async function geometry() {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const scroll = document.querySelector('[data-im-settings-scroll]')
    const close = dialog?.querySelector('button[aria-label="关闭"]')
    if (dialog === null || scroll === null || close === null) throw new Error('Settings dialog chrome is missing')
    const box = element => {
      const value = element.getBoundingClientRect()
      return { top: value.top, left: value.left, bottom: value.bottom, right: value.right, width: value.width, height: value.height }
    }
    const closeBox = close.getBoundingClientRect()
    const hit = document.elementFromPoint(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2)
    return {
      viewport: { width: innerWidth, height: innerHeight }, dialog: box(dialog), close: box(close),
      closeHittable: hit === close || close.contains(hit),
      scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight,
      scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth,
    }
  })
}

function contained(value) {
  assert(value.dialog.top >= 0 && value.dialog.bottom <= value.viewport.height, 'Dialog must fit the viewport vertically')
  assert(value.dialog.left >= 0 && value.dialog.right <= value.viewport.width, 'Dialog must fit the viewport horizontally')
  assert(value.close.top >= value.dialog.top && value.close.bottom <= value.dialog.bottom && value.closeHittable, 'Close button must remain reachable')
  assert(value.scrollWidth <= value.clientWidth + 1, 'Settings content must not overflow horizontally')
}

for (const [width, height] of [[731, 411], [340, 411], [1280, 900]]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await page.goto(url)
  await page.waitForSelector('loc=css:[role="dialog"]', { state: 'visible' })
  console.log(await page.snapshot())
  const initial = await geometry()
  contained(initial)
  await page.click("loc=role:button[name='选择测试目标']")
  await page.click("loc=role:button[name='目标 24 · 工作区配置']")
  const listEnd = await geometry()
  contained(listEnd)
  assert(listEnd.scrollHeight > listEnd.clientHeight && listEnd.scrollTop > 0, 'Long target lists must scroll inside the dialog')
  await page.click("loc=role:button[name='保存目标']")
  await page.waitForFunction(() => document.querySelector('[data-result]').textContent === '已选目标 24')
  await page.click("loc=role:button[name='清除目标']")
  await page.click("loc=role:button[name='取消清除']")
  await page.click("loc=role:button[name='清除目标']")
  await page.click("loc=role:button[name='确认清除']")
  await page.waitForFunction(() => document.querySelector('[data-result]').textContent === '已清除')
  const final = await geometry()
  contained(final)
  if (evidenceDirectory) await page.screenshot({ path: `${evidenceDirectory}/after-${width}x${height}.png` })
  await page.click('loc=css:button[aria-label="关闭"]')
  await page.waitForSelector('loc=css:[role="dialog"]', { state: 'hidden' })
  await page.click("loc=role:button[name='打开设置']")
  await page.keyboard.press('Escape')
  await page.waitForSelector('loc=css:[role="dialog"]', { state: 'hidden' })
  console.log(JSON.stringify({ width, height, initial, listEnd, final, semanticActions: 'target selection, save, confirm/cancel, close, Escape passed' }))
}
}
