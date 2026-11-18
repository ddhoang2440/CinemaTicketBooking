import { expect, test } from '@playwright/test';

test.describe('Cinema Ticket Booking System — Frontend Smoke E2E', () => {
  test('loads the home page shell and displays system title', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Cinema Ticket Booking System' })).toBeVisible();
  });
});

