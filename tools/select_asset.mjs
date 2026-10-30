import {openViewerMenu} from './viewer_actions.mjs';

export async function selectAsset(page,bundle,{keyboard=false}={}){
  const key=await page.evaluate(id=>window.mteLibrary.reveal(id),bundle);
  if(!await page.locator('.library').isVisible()){
    await openViewerMenu(page);
    await page.locator('#library-toggle').click();
  }
  const button=page.locator(`[data-library-key="${key}"]`);
  if(keyboard){await button.focus();await page.keyboard.press('Enter');}else await button.click();
}
