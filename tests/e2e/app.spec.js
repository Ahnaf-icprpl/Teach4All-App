import { test, expect } from '@playwright/test';

test.describe('Teach4All E2E', () => {
  test('homepage loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /curiosity/i })).toBeVisible();
    await expect(page.getByPlaceholder(/what's on your mind/i)).toBeFocused();
  });

  test('send message', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder(/what's on your mind/i);
    await input.fill('Explain photosynthesis simply');
    await page.getByRole('button', { name: /send/i }).click();
    await expect(page.getByText('photosynthesis')).toBeVisible();
  });

  test('keyboard navigation', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /skip/i })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByPlaceholder(/what's on your mind/i)).toBeFocused();
  });

  test('sidebar toggle on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: /sidebar/i })).not.toBeVisible();
    await page.getByRole('button', { name: /open sidebar/i }).click();
    await expect(page.getByRole('navigation', { name: /sidebar/i })).toBeVisible();
    await page.getByRole('button', { name: /close sidebar/i }).click();
    await expect(page.getByRole('navigation', { name: /sidebar/i })).not.toBeVisible();
  });

  test('export workspace', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder(/what's on your mind/i);
    await input.fill('Test message for export');
    await page.getByRole('button', { name: /send/i }).click();
    
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /export/i }).click(),
    ]);
    
    expect(download.suggestedFilename()).toMatch(/teach4all-.*\.json/);
  });

  test('theme toggle', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /switch to dark/i }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: /switch to light/i }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('suggestion cards', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /explain it simply/i }).click();
    await expect(page.getByPlaceholder(/what's on your mind/i)).toHaveValue(/photosynthesis/);
  });
});
