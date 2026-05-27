import { expect, test } from '@playwright/test';

test('dashboard to browser to case and back works', async ({ page }) => {
  await page.goto('/');

  // Resilient to cold-start ("Kalibrasi FSRS") vs primed ("Master Clinical") dashboard variants:
  // both render a Browse Cases CTA tagged with data-testid="dashboard-browse-cases".
  await expect(page.getByTestId('dashboard-browse-cases')).toBeVisible();

  await page.getByTestId('dashboard-browse-cases').click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByPlaceholder('Search cases, prompts, options, diseases...')).toBeVisible();

  const firstCaseCard = page.getByTestId('case-card').first();
  await expect(firstCaseCard).toBeVisible();
  await firstCaseCard.click();

  await expect(page).toHaveURL(/\/case\/[^/?]+(\?.*)?$/);
  await expect(page.locator('h2').first()).toBeVisible();

  await page.getByTestId('case-player-back').click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByPlaceholder('Search cases, prompts, options, diseases...')).toBeVisible();
});
