import { test, expect, type Page } from "@playwright/test";

// The page clips horizontal overflow, so scrollWidth alone cannot see content pushed off-screen.
async function expectNoWideElements(page: Page) {
  const wide = await page.evaluate(() =>
    [...document.querySelectorAll("main *")]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 3)
      .map((element) => `${element.tagName}.${String(element.className).slice(0, 40)}`),
  );
  expect(wide).toEqual([]);
}
for (const width of [375, 768, 1440]) {
  for (const dark of [false, true]) {
    test(`${width}px ${dark ? "dark" : "light"}: key information, filters, inline details and no overflow`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => {
        errors.push(error.message);
        console.log("PAGE ERROR", error.message);
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((value) => {
        localStorage.setItem("valters-theme", value ? "dark" : "light");
      }, dark);
      await page.route("**/*chess-results.com/**", (route) => route.abort());
      await page.goto("/");
      await expect(page.locator("[data-hydrated=true]")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Valters Avotiņš", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: /^Rīgas turnīrs/ })).toBeVisible();
      await expect(page.getByText("Nākamā partija")).toBeVisible();
      await expect(page.getByText("Sākums", { exact: true })).toBeVisible();
      await expect(page.getByText("12:30", { exact: true })).toBeVisible();
      await expect(page.getByRole("main").getByText("pret Roberts Aleksandrs Kalniņš")).toBeVisible();
      await expect(page.getByText("Nākamā", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Atjaunot", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expectNoWideElements(page);
      await page.screenshot({ path: `screenshots/${width}-${dark ? "dark" : "light"}.png`, fullPage: true });
      await page.getByRole("button", { name: "Pretinieki", exact: true }).click();
      await expect(page.getByRole("button", { name: "Pretinieki", exact: true })).toHaveAttribute("aria-current", "page");
      await page.getByRole("button", { name: /Bērziņš, Jānis/ }).click();
      await expect(page.getByRole("heading", { name: "Bērziņš, Jānis" })).toBeVisible();
      await page.getByRole("button", { name: "Statistika", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Pēc krāsas" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Visas partijas" })).toBeVisible();
      await page.getByRole("button", { name: /1\. kārta pret Bērziņš, Jānis/ }).click();
      await expect(page.getByText(/1\. kārta: baltie pret Bērziņš, Jānis — uzvara/)).toBeVisible();
      await page.getByRole("button", { name: "2026", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Turnīri", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expectNoWideElements(page);
      await page.screenshot({ path: `screenshots/${width}-${dark ? "dark" : "light"}-stats.png`, fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}
test("manifest and all icons resolve locally", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const data = await manifest.json();
  for (const icon of data.icons) expect((await request.get(icon.src)).status()).toBe(200);
  expect((await request.get("/apple-touch-icon.png")).status()).toBe(200);
});
