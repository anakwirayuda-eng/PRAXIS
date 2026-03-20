import { expect, test } from '@playwright/test';

test('dashboard to browser to case and back works', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /Master Clinical/i })).toBeVisible();

  await page.getByTestId('dashboard-browse-cases').click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByPlaceholder('Search cases, tags, diseases...')).toBeVisible();

  const firstCaseCard = page.getByTestId('case-card').first();
  await expect(firstCaseCard).toBeVisible();
  await firstCaseCard.click();

  await expect(page).toHaveURL(/\/case\/\d+$/);
  await expect(page.locator('h2').first()).toBeVisible();

  await page.getByTestId('case-player-back').click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByPlaceholder('Search cases, tags, diseases...')).toBeVisible();
});
