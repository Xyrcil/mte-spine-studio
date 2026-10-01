export async function selectAsset(page,bundle){
  const key=await page.evaluate(id=>window.mteLibrary.reveal(id),bundle);
  if(!await page.locator('.library').isVisible())await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.locator(`[data-library-key="${key}"]`).click();
}
