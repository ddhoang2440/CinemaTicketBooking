import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/providers/AppProviders';
import { routes } from '@/app/router';
import { ErrorState } from '@/components/feedback/ErrorState';
import { LoadingState } from '@/components/feedback/LoadingState';

describe('Frontend Application Shell Smoke Test', () => {
  it('renders the home page with "Cinema Ticket Booking System"', () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ['/'],
    });

    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(
      screen.getByRole('heading', { name: 'Cinema Ticket Booking System' }),
    ).toBeInTheDocument();
  });

  it('renders the Not Found page for unknown routes', () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ['/unknown-route-404'],
    });

    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(
      screen.getByRole('heading', { name: /Không tìm thấy trang yêu cầu/i }),
    ).toBeInTheDocument();
  });

  it('renders reusable LoadingState and ErrorState feedback patterns', () => {
    render(
      <div>
        <LoadingState message="Đang tải suất chiếu..." />
        <ErrorState title="Lỗi kết nối" message="Không thể tải dữ liệu." />
      </div>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Đang tải suất chiếu...');
    expect(screen.getByRole('alert')).toHaveTextContent('Lỗi kết nối');
  });
});

