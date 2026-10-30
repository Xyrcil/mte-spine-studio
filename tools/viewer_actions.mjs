export async function openViewerMenu(page){
  if(!await page.locator('#viewer-menu').evaluate(menu=>menu.classList.contains('is-open')))await page.locator('#menu-toggle').click();
}

export async function selectView(page,view){
  await openViewerMenu(page);await page.locator(`button[data-view="${view}"]`).click();
}

export async function togglePlayback(page){
  await openViewerMenu(page);await page.locator('#pause').click();
}
