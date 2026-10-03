export async function selectAsset(page,bundle,{keyboard=false}={}){
  const key=await page.evaluate(id=>window.mteLibrary.reveal(id),bundle);
  if(!await page.locator('.library').isVisible())await page.getByRole('button',{name:'Library',exact:true}).click();
  const button=page.locator(`[data-library-key="${key}"]`);
  if(keyboard){await button.focus();await page.keyboard.press('Enter');}else await button.click();
}
