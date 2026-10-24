import { test, expect } from "@playwright/test";
for (const width of [375, 768, 1440]) {
  for (const dark of [false,true]) {
    test(`${width}px ${dark ? "dark" : "light"}: key information, filters, inline details and no overflow`, async ({page}) => {
      const errors:string[]=[]; page.on("pageerror", e=>{errors.push(e.message);console.log("PAGE ERROR",e.message);});
      await page.setViewportSize({width,height:1000});
      await page.addInitScript(value=>{localStorage.setItem("valters-theme",value ? "dark" : "light");},dark);
      // Every upstream call in a browser test would be a defect.
      await page.route("**/*chess-results.com/**",route=>route.abort());
      await page.goto("/");
      await expect(page.locator("[data-hydrated=true]")).toBeVisible();
      await expect(page.getByRole("heading",{name:"Rīgas turnīrs",exact:true})).toBeVisible();
      await expect(page.getByRole("region",{name:"Nākamā partija"})).toContainText("sākums 12:30");
      await expect(page.getByRole("button",{name:"Atjaunot",exact:true})).toBeDisabled();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path:`screenshots/${width}-${dark ? "dark" : "light"}.png`,fullPage:true});
      await page.getByRole("button",{name:"Pretinieki",exact:true}).click();
      await expect(page.getByRole("button",{name:"Pretinieki",exact:true})).toHaveAttribute("aria-pressed","true");
      await page.getByRole("button",{name:/Bērziņš, Jānis/}).click();
      await expect(page.getByRole("heading",{name:"Bērziņš, Jānis"})).toBeVisible();
      await page.getByRole("button",{name:"Statistika",exact:true}).click();
      await expect(page.getByRole("heading",{name:"Punktu procents pēc krāsas"})).toBeVisible();
      await page.getByRole("button",{name:"Blics",exact:true}).click();
      await expect(page.getByText("Šajos filtros vēl nav nospēlētu partiju.")).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}
test("manifest and all icons resolve locally",async({request})=>{
  const manifest=await request.get('/manifest.webmanifest');expect(manifest.status()).toBe(200);
  const data=await manifest.json();for(const icon of data.icons) expect((await request.get(icon.src)).status()).toBe(200);
  expect((await request.get('/apple-touch-icon.png')).status()).toBe(200);
});
